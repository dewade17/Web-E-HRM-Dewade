export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { parseDateOnlyToUTC } from '@/helpers/date-helper';
import { uploadMediaWithFallback } from '@/app/api/_utils/uploadWithFallback';
import { parseRequestBody, findFileInBody } from '@/app/api/_utils/requestBody';
import { sendPengajuanIzinTukarHariEmailNotifications } from './_utils/emailNotifications';

const APPROVE_STATUSES = new Set(['disetujui', 'ditolak', 'pending']);
const ADMIN_ROLES = new Set(['HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN', 'SUBADMIN', 'SUPERVISI']);

const dateDisplayFormatter = new Intl.DateTimeFormat('id-ID', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

const normRole = (role) =>
  String(role || '')
    .trim()
    .toUpperCase();
const canManageAll = (role) => ADMIN_ROLES.has(normRole(role));

function normalizeStatus(value) {
  if (!value) return null;
  const raw = String(value).trim().toLowerCase();
  return APPROVE_STATUSES.has(raw) ? raw : null;
}

function formatDateISO(value) {
  if (!value) return '-';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toISOString().slice(0, 10);
  } catch {
    return '-';
  }
}

function formatDateDisplay(value) {
  if (!value) return '-';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '-';
    return dateDisplayFormatter.format(d);
  } catch {
    return '-';
  }
}

function isNullLike(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === '' || v === 'null' || v === 'undefined' || v === '-';
  }
  return false;
}

function normalizeStringOrNull(value) {
  if (isNullLike(value)) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function normalizeStringOrUndefined(value) {
  if (value === undefined) return undefined;
  if (isNullLike(value)) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function parseJsonMaybe(value) {
  if (typeof value !== 'string') return value;
  const s = value.trim();
  if (!s) return value;
  try {
    return JSON.parse(s);
  } catch {
    return value;
  }
}

function parseSafeDateOnly(value) {
  if (value === undefined) return undefined;
  if (isNullLike(value)) return null;
  const s = String(value).trim();
  if (!s) return null;
  return parseDateOnlyToUTC(s);
}

function sanitizeHandoverIds(ids) {
  if (ids === undefined) return undefined;
  if (typeof ids === 'string' && ids.trim() === '[]') return [];
  const arr = Array.isArray(ids) ? ids : [ids];
  const unique = new Set();
  for (const raw of arr) {
    const val = String(raw || '').trim();
    if (!val) continue;
    unique.add(val);
  }
  return Array.from(unique);
}

function parsePairsFromBody(body) {
  const raw = body?.pairs ?? body?.pair ?? body?.pairs_json ?? body?.pairsData ?? body?.data_pairs;
  if (raw === undefined) return [];

  if (typeof raw === 'string') {
    const parsed = parseJsonMaybe(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  }

  if (Array.isArray(raw)) return raw;

  if (typeof raw === 'object' && raw) {
    const maybe = raw?.data ?? raw?.items;
    if (Array.isArray(maybe)) return maybe;
  }

  return [];
}

function normalizePair(p, index) {
  const hariIzin = parseSafeDateOnly(p?.hari_izin ?? p?.hariIzin ?? p?.tanggal_izin ?? p?.tanggalIzin);
  const hariPengganti = parseSafeDateOnly(p?.hari_pengganti ?? p?.hariPengganti ?? p?.tanggal_pengganti ?? p?.tanggalPengganti);
  const catatan = normalizeStringOrNull(p?.catatan_pair ?? p?.catatanPair ?? p?.catatan);

  if (!hariIzin || !(hariIzin instanceof Date)) {
    return { ok: false, message: `Hari izin tidak valid pada pair #${index + 1}` };
  }
  if (!hariPengganti || !(hariPengganti instanceof Date)) {
    return { ok: false, message: `Hari pengganti tidak valid pada pair #${index + 1}` };
  }

  return {
    ok: true,
    value: {
      hari_izin: hariIzin,
      hari_pengganti: hariPengganti,
      catatan_pair: catatan,
    },
  };
}

async function validateAndNormalizePairs(actorId, pairsRaw) {
  const list = Array.isArray(pairsRaw) ? pairsRaw : [];
  if (!list.length) {
    return { ok: false, status: 400, message: 'Pairs wajib diisi minimal 1 item.' };
  }

  const normalized = [];
  for (let i = 0; i < list.length; i += 1) {
    const result = normalizePair(list[i], i);
    if (!result.ok) return { ok: false, status: 400, message: result.message };
    normalized.push(result.value);
  }

  const dayKey = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d));
  const seenIzin = new Set();
  for (const p of normalized) {
    const k = dayKey(p.hari_izin);
    if (seenIzin.has(k)) {
      return { ok: false, status: 400, message: `Duplikasi hari_izin ditemukan: ${k}` };
    }
    seenIzin.add(k);
  }

  const userExists = await db.user.findFirst({
    where: { id_user: actorId, deleted_at: null },
    select: { id_user: true },
  });

  if (!userExists) {
    return { ok: false, status: 401, message: 'Unauthorized.' };
  }

  return { ok: true, value: normalized };
}

export async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || req.headers.get('Authorization') || '';

  // 1) Coba Bearer token dulu (kalau gagal, JANGAN return 401 — fallback ke session)
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    try {
      const payload = verifyAuthToken(token);
      const id = payload?.sub || payload?.id_user || payload?.userId || payload?.id;

      if (id) {
        return { actor: { id: String(id), role: payload?.role, source: 'bearer' } };
      }
      // payload valid tapi tidak ada id => lanjut fallback session
    } catch {
      // token invalid => fallback session
    }
  }

  // 2) Fallback ke NextAuth session
  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;

  const id = sessionOrRes?.user?.id || sessionOrRes?.user?.id_user;
  if (!id) return NextResponse.json({ ok: false, message: 'Unauthorized.' }, { status: 401 });

  return { actor: { id: String(id), role: sessionOrRes?.user?.role, source: 'session' } };
}

export const izinInclude = {
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
  approvals: {
    where: { deleted_at: null },
    orderBy: { level: 'asc' },
    select: {
      id_approval_izin_tukar_hari: true,
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
    include: {
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
    },
  },
  pairs: {
    select: { id_izin_tukar_hari_pair: true, hari_izin: true, hari_pengganti: true, catatan_pair: true },
    orderBy: { hari_izin: 'asc' },
  },
};

export async function GET(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  const role = auth.actor?.role;

  try {
    const { searchParams } = new URL(req.url);

    const statusParam = searchParams.get('status');
    const pageRaw = searchParams.get('page') || '1';
    const limitRaw = searchParams.get('limit') || '20';

    const page = Math.max(parseInt(pageRaw, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(limitRaw, 10) || 20, 1), 200);
    const skip = (page - 1) * limit;

    const where = { deleted_at: null };

    const userParam = searchParams.get('id_user');
    if (!canManageAll(role)) {
      where.id_user = actorId;
    } else if (userParam) {
      where.id_user = userParam;
    }

    if (statusParam !== null && statusParam !== undefined && statusParam !== '') {
      const normalized = normalizeStatus(statusParam);
      if (!normalized) return NextResponse.json({ ok: false, message: 'Parameter status tidak valid.' }, { status: 400 });
      where.status = normalized;
    }

    const [total, rows] = await Promise.all([
      db.izinTukarHari.count({ where }),
      db.izinTukarHari.findMany({
        where,
        include: izinInclude,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return NextResponse.json({
      ok: true,
      data: rows,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('GET /mobile/izin-tukar-hari error:', err);
    return NextResponse.json({ ok: false, message: 'Gagal mengambil data izin tukar hari.' }, { status: 500 });
  }
}

export async function POST(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;

  try {
    const parsed = await parseRequestBody(req);
    const body = parsed.body || {};

    const kategori = normalizeStringOrNull(body.kategori) || normalizeStringOrNull(body.nama_kategori) || normalizeStringOrNull(body.kategori_tukar_hari);
    if (!kategori) return NextResponse.json({ ok: false, message: 'Kategori wajib diisi.' }, { status: 400 });

    const keperluan = normalizeStringOrNull(body.keperluan) || null;
    const handover = normalizeStringOrNull(body.handover) || null;

    const jenis_pengajuan = normalizeStringOrNull(body.jenis_pengajuan) || 'izin_tukar_hari';

    const file = findFileInBody(body, ['lampiran', 'lampiran_izin_tukar_hari', 'file', 'attachment']);
    
    let uploadMeta = null;
    let lampiranUrl = normalizeStringOrNull(body.lampiran_izin_tukar_hari_url);

    if (file) {
      try {
        const uploaded = await uploadMediaWithFallback(file, { folder: 'izin-tukar-hari', public: true });
        lampiranUrl = uploaded.publicUrl || null;
        uploadMeta = {
          provider: uploaded.provider,
          publicUrl: uploaded.publicUrl || null,
          key: uploaded.key,
          etag: uploaded.etag,
          size: uploaded.size,
          bucket: uploaded.bucket,
          path: uploaded.path,
          fallbackFromStorageError: uploaded.errors?.storage || undefined,
        };
      } catch (e) {
        console.warn('POST /mobile/izin-tukar-hari: upload failed:', e?.message || e);
      }
    }

    const pairsRaw = parsePairsFromBody(body);
    const pairsCheck = await validateAndNormalizePairs(actorId, pairsRaw);
    if (!pairsCheck.ok) {
      return NextResponse.json({ ok: false, message: pairsCheck.message }, { status: pairsCheck.status || 400 });
    }
    const pairs = pairsCheck.value;

    const rawApprovals = body.approvals ?? body['approvals[]'];
    let approvals = [];
    if (rawApprovals !== undefined) {
      const list = Array.isArray(rawApprovals) ? rawApprovals : [rawApprovals];

      approvals = list.flatMap((a) => {
        if (typeof a === 'string') {
          try {
            const parsedA = JSON.parse(a);
            return Array.isArray(parsedA) ? parsedA : [parsedA];
          } catch {
            return [];
          }
        }
        if (Array.isArray(a)) return a;
        if (a && typeof a === 'object') return [a];
        return [];
      });
    }

    const handoverIds = sanitizeHandoverIds(body.handover_user_ids ?? body.handover_ids ?? body.id_user_tagged ?? body.tag_user_ids ?? body.tagged_user_ids);

    const full = await db.$transaction(async (tx) => {
      const created = await tx.izinTukarHari.create({
        data: {
          id_user: actorId,
          kategori,
          keperluan,
          handover,
          lampiran_izin_tukar_hari_url: lampiranUrl,
          jenis_pengajuan,
          status: 'pending',
        },
      });

      if (pairs.length) {
        await tx.izinTukarHariPair.createMany({
          data: pairs.map((p) => ({
            id_izin_tukar_hari: created.id_izin_tukar_hari,
            hari_izin: p.hari_izin,
            hari_pengganti: p.hari_pengganti,
            catatan_pair: p.catatan_pair || null,
          })),
          skipDuplicates: true,
        });
      }

      if (approvals.length) {
        const rows = approvals
          .map((a, idx) => ({
            id_izin_tukar_hari: created.id_izin_tukar_hari,
            level: Number.isFinite(+a.level) ? +a.level : idx + 1,
            approver_user_id: a.approver_user_id ? String(a.approver_user_id) : null,
            approver_role: a.approver_role ? String(a.approver_role) : null,
            decision: 'pending',
          }))
          .sort((x, y) => x.level - y.level);
        await tx.approvalIzinTukarHari.createMany({ data: rows, skipDuplicates: true });
      }

      if (handoverIds && handoverIds.length) {
        await tx.handoverTukarHari.createMany({
          data: handoverIds.map((id_user_tagged) => ({
            id_izin_tukar_hari: created.id_izin_tukar_hari,
            id_user_tagged,
          })),
          skipDuplicates: true,
        });
      }

      return tx.izinTukarHari.findUnique({
        where: { id_izin_tukar_hari: created.id_izin_tukar_hari },
        include: izinInclude,
      });
    });

    if (full) {
      try {
        await sendPengajuanIzinTukarHariEmailNotifications(req, full);
      } catch (emailErr) {
        console.warn('POST /mobile/izin-tukar-hari: email notification failed:', emailErr?.message || emailErr);
      }
    }

    return NextResponse.json({
      ok: true,
      message: 'Pengajuan izin tukar hari berhasil dibuat.',
      data: full,
      upload: uploadMeta || undefined,
    });
  } catch (err) {
    console.error('POST /mobile/izin-tukar-hari error:', err);
    return NextResponse.json({ ok: false, message: 'Gagal membuat pengajuan izin tukar hari.' }, { status: 500 });
  }
}