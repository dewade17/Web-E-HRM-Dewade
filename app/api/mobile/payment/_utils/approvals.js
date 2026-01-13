function normalizeRoleValue(role) {
  const normalized = String(role || '')
    .trim()
    .toUpperCase();
  return normalized || null;
}

function isNullLike(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return true;
    const lowered = trimmed.toLowerCase();
    if (lowered === 'null' || lowered === 'undefined') return true;
  }
  return false;
}

function collectStructuredApprovals(body) {
  if (!body || typeof body !== 'object') return [];
  const items = {};
  const pattern = /^(?:approvals?|approval)(?:\[(\d+)\])?[._-]?(level|approver_user_id|approver_role|note|id|id_approval_payment)$/i;

  for (const key of Object.keys(body)) {
    const match = pattern.exec(key);
    if (!match) continue;
    const index = match[1] ? Number.parseInt(match[1], 10) : 0;
    const field = match[2];
    if (!items[index]) items[index] = {};
    items[index][field] = body[key];
  }

  return Object.keys(items)
    .map((key) => Number.parseInt(key, 10))
    .sort((a, b) => a - b)
    .map((index) => items[index]);
}

function sanitizeApprovalRecord(raw, index) {
  if (!raw || typeof raw !== 'object') {
    const error = new Error(`Item approval pada indeks ${index} tidak valid.`);
    error.status = 400;
    throw error;
  }

  const idRaw = raw.id_approval_payment ?? raw.id ?? raw.approval_id;
  const id = !isNullLike(idRaw) ? String(idRaw).trim() : null;

  const levelRaw = raw.level ?? raw.approval_level ?? raw.sequence ?? raw.order;
  const level = Number.parseInt(levelRaw, 10);
  if (!Number.isFinite(level)) {
    const error = new Error(`Field level pada approval indeks ${index} harus berupa angka.`);
    error.status = 400;
    throw error;
  }
  if (level < 0) {
    const error = new Error(`Field level pada approval indeks ${index} tidak boleh bernilai negatif.`);
    error.status = 400;
    throw error;
  }

  const approver_user_id = !isNullLike(raw.approver_user_id) ? String(raw.approver_user_id).trim() : null;
  const approver_role = !isNullLike(raw.approver_role) ? normalizeRoleValue(raw.approver_role) : null;
  const note = !isNullLike(raw.note) ? String(raw.note) : null;

  if (!approver_user_id && !approver_role) {
    const error = new Error(`Approval indeks ${index} harus memiliki approver_user_id atau approver_role.`);
    error.status = 400;
    throw error;
  }

  return { id, level, approver_user_id, approver_role, note };
}

function toApprovalObject(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch (_) {
      return null;
    }
  }
  return null;
}

export function parseApprovalsFromBody(body) {
  if (!body || typeof body !== 'object') return undefined;

  const rawDirect = body.approvals ?? body.approval ?? body.approvers ?? body.approver_chain;
  const candidates = [];
  let directProvided = false;

  const pushCandidate = (value) => {
    const parsed = toApprovalObject(value);
    if (!parsed) return;
    if (Array.isArray(parsed)) {
      for (const item of parsed) candidates.push(item);
    } else {
      candidates.push(parsed);
    }
  };

  if (rawDirect !== undefined) {
    directProvided = true;
    if (Array.isArray(rawDirect)) {
      for (const value of rawDirect) pushCandidate(value);
    } else {
      pushCandidate(rawDirect);
    }
  }

  const structured = collectStructuredApprovals(body);
  if (structured.length) {
    directProvided = true;
    candidates.push(...structured);
  }

  if (!directProvided) return undefined;
  if (!candidates.length) return [];

  const sanitized = [];
  const seenIds = new Set();
  candidates.forEach((item, idx) => {
    const sanitizedItem = sanitizeApprovalRecord(item, idx);
    if (sanitizedItem.id) {
      if (seenIds.has(sanitizedItem.id)) {
        const error = new Error(`ID approval duplikat ditemukan: ${sanitizedItem.id}.`);
        error.status = 400;
        throw error;
      }
      seenIds.add(sanitizedItem.id);
    }
    sanitized.push(sanitizedItem);
  });

  // Pastikan level unik di payload
  const levels = new Set();
  for (const it of sanitized) {
    if (levels.has(it.level)) {
      const error = new Error(`Level approval duplikat ditemukan: ${it.level}.`);
      error.status = 400;
      throw error;
    }
    levels.add(it.level);
  }

  return sanitized;
}

export async function ensureApprovalUsersExist(dbClient, approvals) {
  if (!dbClient) return;
  const approvalsArray = Array.isArray(approvals) ? approvals : [];
  const userIds = Array.from(new Set(approvalsArray.map((item) => (item?.approver_user_id ? String(item.approver_user_id).trim() : null)).filter(Boolean)));
  if (!userIds.length) return;

  const found = await dbClient.user.findMany({
    where: { id_user: { in: userIds }, deleted_at: null },
    select: { id_user: true },
  });

  const foundIds = new Set(found.map((item) => item.id_user));
  const missing = userIds.filter((id) => !foundIds.has(id));
  if (missing.length) {
    const error = new Error(`Beberapa approver_user_id tidak ditemukan: ${missing.join(', ')}.`);
    error.status = 400;
    throw error;
  }
}

export async function syncApprovalRecords(tx, reimburseId, desiredApprovals) {
  if (!tx || !reimburseId) return;

  const approvals = Array.isArray(desiredApprovals) ? desiredApprovals : [];

  const existing = await tx.approvalPayment.findMany({
    where: { id_payment: reimburseId, deleted_at: null },
  });

  const existingById = new Map();
  for (const item of existing) existingById.set(item.id_approval_payment, item);

  const desiredIds = new Set();
  const creations = [];

  for (const approval of approvals) {
    const incomingId = approval.id ? String(approval.id).trim() : null;

    if (incomingId && existingById.has(incomingId)) {
      desiredIds.add(incomingId);
      const existingRecord = existingById.get(incomingId);

      const nextUser = approval.approver_user_id || null;
      const nextRole = approval.approver_role ? normalizeRoleValue(approval.approver_role) : null;

      const changed = String(existingRecord.approver_user_id || '') !== String(nextUser || '') || normalizeRoleValue(existingRecord.approver_role) !== nextRole || String(existingRecord.note || '') !== String(approval.note || '');

      if (changed) {
        await tx.approvalPayment.update({
          where: { id_approval_payment: incomingId },
          data: {
            approver_user_id: nextUser,
            approver_role: nextRole,
            note: approval.note || null,
            // reset state jika chain diubah
            decision: 'pending',
            decided_at: null,
          },
        });
      }
    } else {
      creations.push({
        id_payment: reimburseId,
        level: approval.level,
        approver_user_id: approval.approver_user_id || null,
        approver_role: approval.approver_role ? normalizeRoleValue(approval.approver_role) : null,
        note: approval.note || null,
        decision: 'pending',
      });
    }
  }

  const deletions = existing.filter((item) => !desiredIds.has(item.id_approval_payment)).map((item) => item.id_approval_payment);

  if (deletions.length) {
    await tx.approvalPayment.deleteMany({
      where: { id_approval_payment: { in: deletions } },
    });
  }

  if (creations.length) {
    await tx.approvalPayment.createMany({ data: creations });
  }
}

export { normalizeRoleValue };
