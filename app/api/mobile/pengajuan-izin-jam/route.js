export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { parseDateOnlyToUTC, parseDateTimeToUTC, startOfUTCDay, endOfUTCDay } from '@/helpers/date-helper';
import { sendPengajuanIzinJamEmailNotifications } from './_utils/emailNotifications';
import { uploadMediaWithFallback } from '@/app/api/_utils/uploadWithFallback';
import { parseRequestBody, findFileInBody, hasOwn } from '@/app/api/_utils/requestBody';
import { readApprovalsFromBody } from './_utils/approvals';

const APPROVE_STATUSES = new Set(['disetujui', 'ditolak', 'pending']); // selaras Prisma
const ADMIN_ROLES = new Set(['HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN', 'SUBADMIN', 'SUPERVISI']);

// [PERBAIKAN] Tambahkan 'export' agar bisa di-impor file lain
export const baseInclude = {
  user: {
    select: {
      id_user: true,
      nama_pengguna: true,
      email: true,
      role: true,
      foto_profil_user: true,
      id_departement: true,
      departement: {
        select: {
          id_departement: true,
          nama_departement: true,
        },
      },
      jabatan: {
        select: {
          id_jabatan: true,
          nama_jabatan: true,
        },
      },
    },
  },
  kategori: { select: { id_kategori_izin_jam: true, nama_kategori: true } },
  approvals: {
    where: { deleted_at: null },
    orderBy: { level: 'asc' },
    select: {
      id_approval_pengajuan_izin_jam: true,
      level: true,
      approver_user_id: true,
      approver_role: true,
      decision: true,
      decided_at: true,
      note: true,
      approver: {
        select: {
          id_user: true,
          nama_pengguna: true,
          email: true,
          role: true,
          foto_profil_user: true,
        },
      },
    },
  },

  handover_users: {
    select: {
      id_handover_jam: true,
      id_user_tagged: true,
      user: {
        select: {
          id_user: true,
          nama_pengguna: true,
          email: true,
          role: true,
          foto_profil_user: true,
        },
      },
    },
  },
};

const dateDisplayFormatter = new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
const timeDisplayFormatter = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });

function formatDateISO(value) {
  if (!value) return '-';
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toISOString().slice(0, 10);
  } catch {
    return '-';
  }
}

function formatDateDisplay(value) {
  if (!value) return '-';
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '-';
    return dateDisplayFormatter.format(d);
  } catch {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '-' : dateDisplayFormatter.format(d);
  }
}

function formatTimeDisplay(value) {
  if (!value) return '-';
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '-';
    return timeDisplayFormatter.format(d);
  } catch {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '-' : timeDisplayFormatter.format(d);
  }
}

const normRole = (role) =>
  String(role || '')
    .trim()
    .toUpperCase();
const canManageAll = (role) => ADMIN_ROLES.has(normRole(role));

function isNullLike(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === '' || v === 'null' || v === 'undefined' || v === '-';
  }
  return false;
}

function normalizeStatusInput(raw) {
  if (raw === undefined || raw === null) return null;
  const v = String(raw).trim().toLowerCase();
  if (!v) return null;
  if (!APPROVE_STATUSES.has(v)) return null;
  return v;
}

// [PERBAIKAN] validasi tagged users agar tidak ada id_user yang tidak valid
export async function validateTaggedUsers(userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) return;

  const ids = userIds.map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean);

  if (!ids.length) return;

  const existing = await db.user.findMany({
    where: { id_user: { in: ids } },
    select: { id_user: true },
  });

  const existingSet = new Set(existing.map((u) => u.id_user));
  const invalid = ids.filter((id) => !existingSet.has(id));

  if (invalid.length) {
    throw NextResponse.json(
      {
        message: 'Tagged user tidak valid.',
        invalid_user_ids: invalid,
      },
      { status: 400 }
    );
  }
}

export async function ensureAuth(req) {
  // bearer first
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    try {
      const payload = verifyAuthToken(token);
      const actorId = payload?.sub || payload?.id_user || payload?.userId || payload?.id;
      const actorRole = payload?.role;

      if (!actorId) {
        // jangan langsung stop; masih boleh fallback ke session kalau ada
      } else {
        return { ok: true, actorId: String(actorId), actorRole, source: 'bearer' };
      }
    } catch {
      // fallback to session below
    }
  }

  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return { ok: false, response: sessionOrRes };

  const actorId = sessionOrRes?.user?.id || sessionOrRes?.user?.id_user;
  const actorRole = sessionOrRes?.user?.role;

  if (!actorId) {
    return { ok: false, response: NextResponse.json({ message: 'Unauthorized.' }, { status: 401 }) };
  }

  return { ok: true, actorId: String(actorId), actorRole, source: 'session' };
}

export async function GET(req) {
  const auth = await ensureAuth(req);
  if (!auth.ok) return auth.response;

  const actorId = auth.actorId;
  const actorRole = auth.actorRole;

  try {
    const { searchParams } = new URL(req.url);

    const idUserParam = searchParams.get('id_user');
    const statusRaw = searchParams.get('status');
    const tanggal = searchParams.get('tanggal');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const pageRaw = searchParams.get('page') || '1';
    const limitRaw = searchParams.get('limit') || '20';

    const page = Math.max(parseInt(pageRaw, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(limitRaw, 10) || 20, 1), 200);
    const skip = (page - 1) * limit;

    const where = { deleted_at: null };

    // Role-based access: non-admin can only see their own unless id_user matches
    if (!canManageAll(actorRole)) {
      where.id_user = actorId;
    } else if (idUserParam) {
      where.id_user = idUserParam;
    }

    if (statusRaw !== null) {
      const normalized = normalizeStatusInput(statusRaw);
      if (!normalized) return NextResponse.json({ message: 'Parameter status tidak valid.' }, { status: 400 });
      where.status = normalized; // 'pending' | 'disetujui' | 'ditolak'
    }

    const and = [];
    if (tanggal) {
      const parsed = parseDateOnlyToUTC(tanggal);
      if (parsed) and.push({ tanggal_izin: { gte: startOfUTCDay(parsed), lte: endOfUTCDay(parsed) } });
    } else {
      const parsedFrom = from ? parseDateOnlyToUTC(from) : null;
      const parsedTo = to ? parseDateOnlyToUTC(to) : null;
      if (parsedFrom || parsedTo) {
        and.push({
          tanggal_izin: {
            ...(parsedFrom ? { gte: startOfUTCDay(parsedFrom) } : {}),
            ...(parsedTo ? { lte: endOfUTCDay(parsedTo) } : {}),
          },
        });
      }
    }

    if (and.length) where.AND = and;

    const [total, rows] = await Promise.all([
      db.pengajuanIzinJam.count({ where }),
      db.pengajuanIzinJam.findMany({
        where,
        include: baseInclude,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return NextResponse.json({
      ok: true,
      data: rows,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('GET /mobile/pengajuan-izin-jam error:', err);
    return NextResponse.json({ ok: false, message: 'Server error.' }, { status: 500 });
  }
}

export async function POST(req) {
  const auth = await ensureAuth(req);
  if (!auth.ok) return auth.response;

  const actorId = auth.actorId;
  const actorRole = auth.actorRole;

  try {
    const parsed = await parseRequestBody(req); 
    const body = parsed.body || {};
    const file = findFileInBody(body, ['lampiran', 'lampiran_izin_jam', 'file', 'attachment']);

    const idUserRaw = body?.id_user;
    const tanggalIzinRaw = body?.tanggal_izin;
    const jamMulaiRaw = body?.jam_mulai;
    const jamSelesaiRaw = body?.jam_selesai;
    const tanggalPenggantiRaw = body?.tanggal_pengganti;
    const jamMulaiPenggantiRaw = body?.jam_mulai_pengganti;
    const jamSelesaiPenggantiRaw = body?.jam_selesai_pengganti;

    const idKategoriIzinJamRaw = body?.id_kategori_izin_jam;
    const keperluanRaw = body?.keperluan;
    const handoverRaw = body?.handover;
    const statusRaw = body?.status;
    const jenisPengajuanRaw = body?.jenis_pengajuan;

    // tagged user ids: accept multiple possible shapes
    const tagUserIdsRaw = body?.tag_user_ids ?? body?.tagged_user_ids ?? body?.handover_user_ids ?? body?.handover_ids ?? body?.id_user_tagged;

    const targetUserId = canManageAll(actorRole) && typeof idUserRaw === 'string' && idUserRaw.trim() ? idUserRaw.trim() : actorId;

    const tanggalIzin = parseDateOnlyToUTC(tanggalIzinRaw);
    if (!tanggalIzin) return NextResponse.json({ message: 'tanggal_izin wajib diisi (YYYY-MM-DD).' }, { status: 400 });

    const jamMulai = parseDateTimeToUTC(jamMulaiRaw);
    const jamSelesai = parseDateTimeToUTC(jamSelesaiRaw);
    if (!jamMulai || !jamSelesai) return NextResponse.json({ message: 'jam_mulai dan jam_selesai wajib diisi (ISO datetime).' }, { status: 400 });

    // Optional pengganti
    const tanggalPengganti = isNullLike(tanggalPenggantiRaw) ? null : parseDateOnlyToUTC(tanggalPenggantiRaw);
    const jamMulaiPengganti = isNullLike(jamMulaiPenggantiRaw) ? null : parseDateTimeToUTC(jamMulaiPenggantiRaw);
    const jamSelesaiPengganti = isNullLike(jamSelesaiPenggantiRaw) ? null : parseDateTimeToUTC(jamSelesaiPenggantiRaw);

    const idKategoriIzinJam = typeof idKategoriIzinJamRaw === 'string' ? idKategoriIzinJamRaw.trim() : '';
    if (!idKategoriIzinJam) return NextResponse.json({ message: 'id_kategori_izin_jam wajib diisi.' }, { status: 400 });

    const keperluan = isNullLike(keperluanRaw) ? null : String(keperluanRaw);
    const handover = isNullLike(handoverRaw) ? null : String(handoverRaw);

    // jenis pengajuan
    const jenis_pengajuan = String(jenisPengajuanRaw || '').trim() || 'izin_jam';

    // status: admin can set, non-admin default pending
    const normalizedStatus = canManageAll(actorRole) ? normalizeStatusInput(statusRaw) || 'pending' : 'pending';

    // approvals input
    let approvalsInput;
    if (hasOwn(body, 'approvals')) {
      approvalsInput = readApprovalsFromBody(body);
    }

    // tagUserIds normalize to array of strings
    let tagUserIds = [];
    if (Array.isArray(tagUserIdsRaw)) {
      tagUserIds = tagUserIdsRaw.map((v) => String(v).trim()).filter(Boolean);
    } else if (typeof tagUserIdsRaw === 'string') {
      // allow comma-separated
      tagUserIds = tagUserIdsRaw
        .split(',')
        .map((v) => String(v).trim())
        .filter(Boolean);
    }

    // validate tag users exist
    if (tagUserIds && tagUserIds.length) {
      await validateTaggedUsers(tagUserIds);
    }

    // handle upload
    let uploadMeta = null;
    let lampiranUrl = isNullLike(body?.lampiran_izin_jam_url) ? null : String(body?.lampiran_izin_jam_url || '');
    if (file) {
      try {
        uploadMeta = await uploadMediaWithFallback(file, {
          folder: 'izin-jam',
          public: true,
        });
        lampiranUrl = uploadMeta?.publicUrl || uploadMeta?.url || lampiranUrl;
      } catch (uploadErr) {
        console.warn('POST /mobile/pengajuan-izin-jam upload failed:', uploadErr?.message || uploadErr);
      }
    }

    const currentLevel = Array.isArray(approvalsInput) && approvalsInput.length ? Math.min(...approvalsInput.map((a) => a.level).filter((v) => Number.isFinite(v))) : null;

    const result = await db.$transaction(async (tx) => {
      const created = await tx.pengajuanIzinJam.create({
        data: {
          id_user: targetUserId,
          tanggal_izin: tanggalIzin,
          jam_mulai: jamMulai,
          jam_selesai: jamSelesai,
          tanggal_pengganti: tanggalPengganti,
          jam_mulai_pengganti: jamMulaiPengganti,
          jam_selesai_pengganti: jamSelesaiPengganti,
          id_kategori_izin_jam: idKategoriIzinJam,
          keperluan,
          handover,
          lampiran_izin_jam_url: lampiranUrl,
          status: normalizedStatus,
          current_level: currentLevel,
          jenis_pengajuan,
        },
      });

      if (tagUserIds && tagUserIds.length) {
        await tx.handoverIzinJam.createMany({
          data: tagUserIds.map((id) => ({ id_pengajuan_izin_jam: created.id_pengajuan_izin_jam, id_user_tagged: id })),
          skipDuplicates: true,
        });
      }

      if (approvalsInput && approvalsInput.length) {
        await tx.approvalPengajuanIzinJam.createMany({
          data: approvalsInput.map((approval) => ({
            id_pengajuan_izin_jam: created.id_pengajuan_izin_jam,
            level: approval.level,
            approver_user_id: approval.approver_user_id,
            approver_role: approval.approver_role,
            decision: 'pending', // default enum
          })),
        });
      }

      return tx.pengajuanIzinJam.findUnique({
        where: { id_pengajuan_izin_jam: created.id_pengajuan_izin_jam },
        include: baseInclude,
      });
    });

    if (result) {
      try {
        await sendPengajuanIzinJamEmailNotifications(req, result);
      } catch (emailErr) {
        console.warn('POST /mobile/pengajuan-izin-jam: email notification failed:', emailErr?.message || emailErr);
      }
    }

    return NextResponse.json({ message: 'Pengajuan izin jam berhasil dibuat.', data: result, upload: uploadMeta || undefined }, { status: 201 });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    if (err?.code === 'P2003') return NextResponse.json({ message: 'Data referensi tidak valid.' }, { status: 400 });
    console.error('POST /mobile/pengajuan-izin-jam error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}