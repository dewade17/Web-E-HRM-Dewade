import { NextResponse } from 'next/server';

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
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

function parseMaybeJson(value, errorMessage) {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch (err) {
      throw NextResponse.json({ message: errorMessage || 'Format approvals tidak valid.' }, { status: 400 });
    }
  }

  return value;
}

function normalizeApprovalEntry(raw, index) {
  if (raw === null || raw === undefined) return null;

  let entry = raw;
  if (typeof entry === 'string') {
    entry = parseMaybeJson(entry, `Item approvals pada indeks ${index} harus berupa JSON yang valid.`);
  }

  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const idRaw = entry.id ?? entry.id_approval_pengajuan_izin_jam ?? entry.approval_id;
  const levelRaw = entry.level ?? entry.level_order ?? entry.order ?? entry.sequence;
  const userIdRaw = entry.approver_user_id ?? entry.approverUserId ?? entry.user_id ?? entry.userId;
  const roleRaw = entry.approver_role ?? entry.approverRole ?? entry.role;

  const id = isNullLike(idRaw) ? null : String(idRaw).trim();
  const hasLevelValue = !isNullLike(levelRaw);
  const approverUserId = isNullLike(userIdRaw) ? null : String(userIdRaw).trim();
  const approverRole = isNullLike(roleRaw) ? null : String(roleRaw).trim().toUpperCase();

  const isCompletelyEmpty = !hasLevelValue && !approverUserId && !approverRole;
  if (isCompletelyEmpty) {
    return null;
  }

  if (!hasLevelValue) {
    throw NextResponse.json({ message: `Field level pada approvals indeks ${index} wajib diisi.` }, { status: 400 });
  }

  const levelNumber = Number(levelRaw);
  if (!Number.isFinite(levelNumber) || !Number.isInteger(levelNumber)) {
    throw NextResponse.json({ message: `Field level pada approvals indeks ${index} harus berupa angka bulat.` }, { status: 400 });
  }

  if (!approverUserId && !approverRole) {
    throw NextResponse.json({ message: `Field approver_user_id atau approver_role harus diisi pada approvals indeks ${index}.` }, { status: 400 });
  }

  return {
    id: id || null,
    level: levelNumber,
    approver_user_id: approverUserId || null,
    approver_role: approverRole || null,
  };
}

export function normalizeApprovalsInput(raw) {
  if (raw === undefined) return undefined;

  let input = raw;
  if (typeof input === 'string') {
    const parsed = parseMaybeJson(input, 'approvals harus berupa array JSON yang valid.');
    input = parsed;
  }

  if (input === null) {
    return [];
  }

  const arr = Array.isArray(input) ? input : [input];
  const normalized = [];

  arr.forEach((item, idx) => {
    const normalizedEntry = normalizeApprovalEntry(item, idx);
    if (normalizedEntry) {
      normalized.push(normalizedEntry);
    }
  });

  return normalized;
}

export function readApprovalsFromBody(body) {
  if (!body || typeof body !== 'object') return undefined;

  const candidateKeys = ['approvals', 'approval', 'approval_list', 'approval_steps'];
  for (const key of candidateKeys) {
    if (hasOwn(body, key)) {
      return normalizeApprovalsInput(body[key]);
    }
  }

  return undefined;
}
