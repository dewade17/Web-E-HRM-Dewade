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

function toApprovalObject(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      return parsed;
    } catch (err) {
      const error = new Error('Format data approvals harus berupa JSON yang valid.');
      error.status = 400;
      throw error;
    }
  }
  if (typeof value === 'object') {
    return value;
  }
  const error = new Error('Format data approvals tidak dikenal.');
  error.status = 400;
  throw error;
}

function collectStructuredApprovals(body) {
  const items = {};
  const patternSquare = /^approvals\[(\d+)\]\[(.+)\]$/;
  const patternDot = /^approvals\[(\d+)\]\.(.+)$/;
  const patternDotAlt = /^approvals\.(\d+)\.(.+)$/;

  for (const key of Object.keys(body || {})) {
    let match = key.match(patternSquare);
    if (!match) match = key.match(patternDot);
    if (!match) match = key.match(patternDotAlt);
    if (!match) continue;

    const index = Number.parseInt(match[1], 10);
    if (!Number.isFinite(index)) continue;
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

  const idRaw = raw.id_approval_pengajuan_cuti ?? raw.id ?? raw.approval_id;
  const id = idRaw ? String(idRaw).trim() : null;

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

  const approverUserRaw = raw.approver_user_id ?? raw.approverUserId ?? raw.user_id ?? raw.userId;
  const approver_user_id = approverUserRaw ? String(approverUserRaw).trim() : null;

  const approverRoleRaw = raw.approver_role ?? raw.approverRole ?? raw.role;
  const approver_role = approverRoleRaw ? normalizeRoleValue(approverRoleRaw) : null;

  const noteRaw = raw.note ?? raw.catatan ?? raw.remark;
  const note = isNullLike(noteRaw) ? null : String(noteRaw).trim();

  if (!approver_user_id && !approver_role) {
    const error = new Error(`Approval pada indeks ${index} harus memiliki approver_user_id atau approver_role.`);
    error.status = 400;
    throw error;
  }

  return {
    id,
    level,
    approver_user_id: approver_user_id || null,
    approver_role,
    note: note || null,
  };
}

export function parseApprovalsFromBody(body) {
  if (!body || typeof body !== 'object') return undefined;

  const rawDirect = body.approvals ?? body['approvals[]'] ?? body.approval_list;
  const candidates = [];
  let directProvided = false;

  const pushCandidate = (value) => {
    const parsed = toApprovalObject(value);
    if (!parsed) return;
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        candidates.push(item);
      }
    } else {
      candidates.push(parsed);
    }
  };

  if (rawDirect !== undefined) {
    directProvided = true;
    if (Array.isArray(rawDirect)) {
      for (const value of rawDirect) {
        if (value === undefined || value === null) continue;
        pushCandidate(value);
      }
    } else {
      pushCandidate(rawDirect);
    }
  }

  const structured = collectStructuredApprovals(body);
  if (structured.length) {
    directProvided = true;
    candidates.push(...structured);
  }

  if (!directProvided) {
    return undefined;
  }

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

  return sanitized;
}

export async function syncApprovalRecords(tx, pengajuanId, desiredApprovals) {
  if (!tx || !pengajuanId) return;
  const approvals = Array.isArray(desiredApprovals) ? desiredApprovals : [];

  const existing = await tx.approvalPengajuanCuti.findMany({
    where: { id_pengajuan_cuti: pengajuanId, deleted_at: null },
  });

  const existingById = new Map();
  for (const item of existing) {
    existingById.set(item.id_approval_pengajuan_cuti, item);
  }

  const desiredIds = new Set();
  const creations = [];

  for (const approval of approvals) {
    if (approval.id) {
      const existingRecord = existingById.get(approval.id);
      if (!existingRecord) {
        const error = new Error(`Approval dengan ID ${approval.id} tidak ditemukan.`);
        error.status = 400;
        throw error;
      }
      desiredIds.add(approval.id);

      const normalizedRole = approval.approver_role ? normalizeRoleValue(approval.approver_role) : null;
      const data = {
        level: approval.level,
        approver_user_id: approval.approver_user_id || null,
        approver_role: normalizedRole,
        note: approval.note || null,
      };

      const metadataChanged =
        existingRecord.level !== data.level || (existingRecord.approver_user_id || null) !== data.approver_user_id || normalizeRoleValue(existingRecord.approver_role) !== normalizedRole || (existingRecord.note || null) !== data.note;

      if (metadataChanged) {
        await tx.approvalPengajuanCuti.update({
          where: { id_approval_pengajuan_cuti: approval.id },
          data: {
            ...data,
            decision: 'pending',
            decided_at: null,
          },
        });
      }
    } else {
      creations.push({
        id_pengajuan_cuti: pengajuanId,
        level: approval.level,
        approver_user_id: approval.approver_user_id || null,
        approver_role: approval.approver_role ? normalizeRoleValue(approval.approver_role) : null,
        note: approval.note || null,
        decision: 'pending',
      });
    }
  }

  const deletions = existing.filter((item) => !desiredIds.has(item.id_approval_pengajuan_cuti)).map((item) => item.id_approval_pengajuan_cuti);

  if (deletions.length) {
    await tx.approvalPengajuanCuti.deleteMany({
      where: { id_approval_pengajuan_cuti: { in: deletions } },
    });
  }

  if (creations.length) {
    await tx.approvalPengajuanCuti.createMany({ data: creations, skipDuplicates: true });
  }
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

export { normalizeRoleValue };
