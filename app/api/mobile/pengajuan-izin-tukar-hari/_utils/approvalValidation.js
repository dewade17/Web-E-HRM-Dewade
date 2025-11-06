import { NextResponse } from 'next/server';
import { hasOwn, isNullLike } from '@/app/api/_utils/requestBody';

const APPROVAL_KEYS = ['approvals', 'approval_flows', 'approvalFlow', 'approval_levels', 'approvalLevels'];

function normalizeApproverUserId(value) {
  if (isNullLike(value)) return null;
  const str = String(value ?? '').trim();
  if (!str) return null;
  return str;
}

export function normalizeApprovalRole(role) {
  if (isNullLike(role)) return null;
  const str = String(role ?? '').trim();
  if (!str) return null;
  return str.toUpperCase();
}

function parseSingleApproval(raw, index) {
  let source = raw;
  if (typeof source === 'string') {
    const trimmed = source.trim();
    if (!trimmed) {
      throw NextResponse.json({ message: `Data approval pada indeks ${index} tidak boleh kosong.` }, { status: 400 });
    }
    try {
      source = JSON.parse(trimmed);
    } catch (err) {
      throw NextResponse.json({ message: `Format approval pada indeks ${index} harus berupa objek JSON yang valid.` }, { status: 400 });
    }
  }

  if (!source || typeof source !== 'object') {
    throw NextResponse.json({ message: `Data approval pada indeks ${index} harus berupa objek.` }, { status: 400 });
  }

  const idRaw = source.id_approval_izin_tukar_hari ?? source.id_approval ?? source.id ?? source.approval_id ?? null;
  const id = idRaw ? String(idRaw).trim() : null;

  const levelSource = source.level ?? source.approval_level ?? source.sequence ?? source.urutan ?? source.order ?? source.step ?? source.pos ?? null;

  if (levelSource === null || levelSource === undefined || levelSource === '') {
    throw NextResponse.json({ message: `Approval pada indeks ${index} wajib memiliki level.` }, { status: 400 });
  }

  const level = Number(levelSource);
  if (!Number.isInteger(level) || level < 1) {
    throw NextResponse.json({ message: `Level approval pada indeks ${index} tidak valid.` }, { status: 400 });
  }

  const approverUserId = normalizeApproverUserId(source.approver_user_id ?? source.id_user ?? source.user_id ?? source.approverId ?? source.approver_userId ?? source.approverUserId);
  const approverRole = normalizeApprovalRole(source.approver_role ?? source.role ?? source.approverRole ?? source.approver_role_name);

  if (!approverUserId && !approverRole) {
    throw NextResponse.json({ message: `Approval pada indeks ${index} harus memiliki approver_user_id atau approver_role.` }, { status: 400 });
  }

  return {
    id,
    level,
    approver_user_id: approverUserId || null,
    approver_role: approverRole || null,
  };
}

function coerceApprovalsInput(raw, keyName) {
  if (raw === undefined) return undefined;
  if (raw === null) return [];

  let input = raw;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return [];
    try {
      input = JSON.parse(trimmed);
    } catch (err) {
      throw NextResponse.json({ message: `${keyName || 'approvals'} harus berupa array JSON yang valid.` }, { status: 400 });
    }
  }

  if (!Array.isArray(input)) {
    if (typeof input === 'object') {
      return [parseSingleApproval(input, 0)];
    }
    throw NextResponse.json({ message: `${keyName || 'approvals'} harus berupa array atau objek.` }, { status: 400 });
  }

  return input.map((entry, idx) => parseSingleApproval(entry, idx));
}

export function extractApprovalsFromBody(body, keys = APPROVAL_KEYS) {
  if (!body || typeof body !== 'object') return undefined;
  for (const key of keys) {
    if (hasOwn(body, key)) {
      return coerceApprovalsInput(body[key], key);
    }
  }
  return undefined;
}

export async function validateApprovalEntries(approvals, prisma) {
  if (approvals === undefined) return undefined;

  const normalized = approvals.map((item) => ({
    id: item.id ? String(item.id).trim() : null,
    level: item.level,
    approver_user_id: item.approver_user_id || null,
    approver_role: item.approver_role || null,
  }));

  const seenLevels = new Set();
  const seenIds = new Set();
  for (const approval of normalized) {
    if (seenLevels.has(approval.level)) {
      throw NextResponse.json({ message: `Level approval ${approval.level} tidak boleh duplikat.` }, { status: 400 });
    }
    seenLevels.add(approval.level);

    if (approval.id) {
      if (seenIds.has(approval.id)) {
        throw NextResponse.json({ message: 'ID approval tidak boleh duplikat.' }, { status: 400 });
      }
      seenIds.add(approval.id);
    }
  }

  const approverUserIds = Array.from(new Set(normalized.map((item) => item.approver_user_id).filter(Boolean)));
  if (approverUserIds.length) {
    const found = await prisma.user.findMany({
      where: { id_user: { in: approverUserIds }, deleted_at: null },
      select: { id_user: true },
    });
    const foundSet = new Set(found.map((item) => item.id_user));
    const missing = approverUserIds.filter((id) => !foundSet.has(id));
    if (missing.length) {
      throw NextResponse.json({ message: `Approver user berikut tidak ditemukan: ${missing.join(', ')}` }, { status: 400 });
    }
  }

  return normalized.sort((a, b) => {
    if (a.level === b.level) return 0;
    return a.level < b.level ? -1 : 1;
  });
}

export const approvalValidationKeys = APPROVAL_KEYS;
