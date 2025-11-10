export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { parseDateOnlyToUTC } from '@/helpers/date-helper';
import storageClient from '@/app/api/_utils/storageClient';
import { parseRequestBody, findFileInBody } from '@/app/api/_utils/requestBody';
import { sendNotification } from '@/app/utils/services/notificationService';

const APPROVE_STATUSES = new Set(['disetujui', 'ditolak', 'pending']); // ❗ tanpa 'menunggu'
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

export async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const payload = verifyAuthToken(auth.slice(7).trim());
      const id = payload?.sub || payload?.id_user || payload?.userId || payload?.id;
      if (id) {
        return { actor: { id, role: payload?.role, source: 'bearer' } };
      }
    } catch {}
  }

  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;

  const id = sessionOrRes?.user?.id || sessionOrRes?.user?.id_user;
  if (!id) return NextResponse.json({ ok: false, message: 'Unauthorized.' }, { status: 401 });

  return { actor: { id, role: sessionOrRes?.user?.role, source: 'session' } };
}

export const izinInclude = {
  user: { select: { id_user: true, nama_pengguna: true, email: true, role: true } },
  handover_users: {
    include: {
      user: { select: { id_user: true, nama_pengguna: true, email: true, role: true, foto_profil_user: true } },
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
    },
  },
  pairs: {
    select: { id_izin_tukar_hari_pair: true, hari_izin: true, hari_pengganti: true, catatan_pair: true },
    orderBy: { hari_izin: 'asc' },
  },
};

function parseDateQuery(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
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

/**
 * Parser serbaguna untuk input pairs. Mendukung:
 * - JSON body: { pairs: [{ hari_izin, hari_pengganti, catatan_pair? }, ...] }
 * - Form-data: pairs[]=<json-string> atau field terpisah: hari_izin[], hari_pengganti[]
 */
function parsePairsFromBody(body) {
  if (!body) return [];
  // 1) Bentuk JSON langsung
  if (Array.isArray(body.pairs)) {
    return body.pairs.map((p) => {
      if (typeof p === 'string') {
        try {
          return JSON.parse(p);
        } catch {
          return {};
        }
      }
      return p || {};
    });
  }
  // 2) pairs[] dengan string JSON
  const arr = body['pairs[]'];
  if (arr !== undefined) {
    const list = Array.isArray(arr) ? arr : [arr];
    return list.map((s) => {
      try {
        return JSON.parse(s);
      } catch {
        return {};
      }
    });
  }
  // 3) dua array paralel: hari_izin[], hari_pengganti[]
  const izinArr = body['hari_izin[]'] ?? body.hari_izin;
  const gantiArr = body['hari_pengganti[]'] ?? body.hari_pengganti;
  if (izinArr !== undefined && gantiArr !== undefined) {
    const ia = Array.isArray(izinArr) ? izinArr : [izinArr];
    const ga = Array.isArray(gantiArr) ? gantiArr : [gantiArr];
    const n = Math.max(ia.length, ga.length);
    const res = [];
    for (let i = 0; i < n; i++) {
      res.push({ hari_izin: ia[i], hari_pengganti: ga[i] });
    }
    return res;
  }
  return [];
}

/** Validasi & normalisasi pairs → array {hari_izin: Date, hari_pengganti: Date, catatan_pair?: string} */
async function validateAndNormalizePairs(userId, pairsRaw) {
  if (!Array.isArray(pairsRaw) || pairsRaw.length === 0) {
    return { ok: false, status: 400, message: 'pairs wajib diisi minimal 1 pasangan hari.' };
  }

  const normalized = [];
  const seenIzin = new Set();
  const seenGanti = new Set();
  const dateKey = (d) => formatDateISO(d);

  for (let i = 0; i < pairsRaw.length; i++) {
    const p = pairsRaw[i] || {};
    const izin = parseDateOnlyToUTC(p.hari_izin ?? p.izin ?? p.date_izin);
    const ganti = parseDateOnlyToUTC(p.hari_pengganti ?? p.pengganti ?? p.date_pengganti);
    const note = p.catatan_pair === undefined || p.catatan_pair === null ? null : String(p.catatan_pair);

    if (!izin || !ganti) {
      return { ok: false, status: 400, message: `Pair #${i + 1} tidak valid: 'hari_izin' dan 'hari_pengganti' wajib berupa tanggal valid (YYYY-MM-DD).` };
    }
    if (izin.getTime() === ganti.getTime()) {
      return { ok: false, status: 400, message: `Pair #${i + 1} tidak valid: 'hari_izin' tidak boleh sama dengan 'hari_pengganti'.` };
    }

    const kI = dateKey(izin);
    const kG = dateKey(ganti);
    if (seenIzin.has(kI)) {
      return { ok: false, status: 400, message: `Tanggal 'hari_izin' ${kI} duplikat dalam pengajuan ini.` };
    }
    if (seenGanti.has(kG)) {
      return { ok: false, status: 400, message: `Tanggal 'hari_pengganti' ${kG} duplikat dalam pengajuan ini.` };
    }
    seenIzin.add(kI);
    seenGanti.add(kG);

    normalized.push({ hari_izin: izin, hari_pengganti: ganti, catatan_pair: note });
  }

  // Cek tabrakan dengan pengajuan tukar-hari lain milik user (status pending/disetujui)
  const izinDates = normalized.map((p) => p.hari_izin);
  const gantiDates = normalized.map((p) => p.hari_pengganti);

  const existingPairs = await db.izinTukarHariPair.findMany({
    where: {
      OR: [{ hari_izin: { in: izinDates } }, { hari_pengganti: { in: gantiDates } }],
      izin_tukar_hari: {
        id_user: userId,
        deleted_at: null,
        status: { in: ['pending', 'disetujui'] }, // ❗ tanpa 'menunggu'
      },
    },
    select: { hari_izin: true, hari_pengganti: true },
  });

  if (existingPairs.length) {
    const details = existingPairs.map((p) => `(${formatDateISO(p.hari_izin)} ↔ ${formatDateISO(p.hari_pengganti)})`).join(', ');
    return { ok: false, status: 409, message: `Terdapat pasangan yang sudah diajukan sebelumnya: ${details}.` };
  }

  // Cek bentrok cuti disetujui
  const cutiBentrok = await db.pengajuanCutiTanggal.findMany({
    where: {
      tanggal_cuti: { in: [...izinDates, ...gantiDates] },
      pengajuan_cuti: {
        id_user: userId,
        deleted_at: null,
        status: 'disetujui',
      },
    },
    select: { tanggal_cuti: true },
  });
  if (cutiBentrok.length) {
    const list = Array.from(new Set(cutiBentrok.map((x) => formatDateISO(x.tanggal_cuti)))).join(', ');
    return { ok: false, status: 409, message: `Tanggal berikut sudah tercatat sebagai cuti disetujui: ${list}.` };
  }

  return { ok: true, value: normalized };
}

/* ============================ GET (List) ============================ */
export async function GET(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;
  const actorId = auth.actor?.id;
  if (!actorId) return NextResponse.json({ ok: false, message: 'Unauthorized.' }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);

    const rawPage = parseInt(searchParams.get('page') || '1', 10);
    const page = Number.isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
    const perRaw = parseInt(searchParams.get('perPage') || searchParams.get('pageSize') || '20', 10);
    const perPage = Math.min(Math.max(Number.isNaN(perRaw) ? 20 : perRaw, 1), 100);

    const statusParam = searchParams.get('status');
    const status = normalizeStatus(statusParam);
    if (statusParam && !status) {
      return NextResponse.json({ ok: false, message: 'Parameter status tidak valid.' }, { status: 400 });
    }

    const kategori = (searchParams.get('kategori') || '').trim();
    const targetUser = (searchParams.get('id_user') || '').trim();

    // Filter tanggal pada pair:
    const hariIzinEq = searchParams.get('hari_izin');
    const hariIzinFrom = searchParams.get('hari_izin_from');
    const hariIzinTo = searchParams.get('hari_izin_to');
    const hariPenggantiEq = searchParams.get('hari_pengganti');
    const hariPenggantiFrom = searchParams.get('hari_pengganti_from');
    const hariPenggantiTo = searchParams.get('hari_pengganti_to');

    const where = { deleted_at: null, jenis_pengajuan: 'tukar_hari' };

    // Scope akses
    if (canManageAll(auth.actor?.role)) {
      if (targetUser) where.id_user = targetUser;
    } else {
      where.id_user = actorId;
    }

    if (status) {
      where.status = status; // 'pending' | 'disetujui' | 'ditolak'
    }
    if (kategori) where.kategori = kategori;

    // Filter lewat relasi pairs
    const pairFilter = {};
    // hari_izin
    if (hariIzinEq) {
      const eq = parseDateQuery(hariIzinEq);
      if (!eq) return NextResponse.json({ ok: false, message: 'Parameter hari_izin tidak valid.' }, { status: 400 });
      pairFilter.hari_izin = eq;
    } else if (hariIzinFrom || hariIzinTo) {
      const gte = parseDateQuery(hariIzinFrom);
      const lte = parseDateQuery(hariIzinTo);
      if (hariIzinFrom && !gte) return NextResponse.json({ ok: false, message: 'Parameter hari_izin_from tidak valid.' }, { status: 400 });
      if (hariIzinTo && !lte) return NextResponse.json({ ok: false, message: 'Parameter hari_izin_to tidak valid.' }, { status: 400 });
      pairFilter.hari_izin = { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
    }
    // hari_pengganti
    if (hariPenggantiEq) {
      const eq = parseDateQuery(hariPenggantiEq);
      if (!eq) return NextResponse.json({ ok: false, message: 'Parameter hari_pengganti tidak valid.' }, { status: 400 });
      pairFilter.hari_pengganti = eq;
    } else if (hariPenggantiFrom || hariPenggantiTo) {
      const gte = parseDateQuery(hariPenggantiFrom);
      const lte = parseDateQuery(hariPenggantiTo);
      if (hariPenggantiFrom && !gte) return NextResponse.json({ ok: false, message: 'Parameter hari_pengganti_from tidak valid.' }, { status: 400 });
      if (hariPenggantiTo && !lte) return NextResponse.json({ ok: false, message: 'Parameter hari_pengganti_to tidak valid.' }, { status: 400 });
      pairFilter.hari_pengganti = { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
    }

    if (Object.keys(pairFilter).length) {
      where.pairs = { some: pairFilter };
    }

    const [total, items] = await Promise.all([
      db.izinTukarHari.count({ where }),
      db.izinTukarHari.findMany({
        where,
        orderBy: [{ created_at: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
        include: izinInclude,
      }),
    ]);

    return NextResponse.json({
      ok: true,
      data: items,
      meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
    });
  } catch (err) {
    console.error('GET /mobile/izin-tukar-hari error:', err);
    return NextResponse.json({ ok: false, message: 'Gagal mengambil data izin tukar hari.' }, { status: 500 });
  }
}

/* ============================ POST (Create) ============================ */
export async function POST(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  if (!actorId) {
    return NextResponse.json({ ok: false, message: 'Unauthorized.' }, { status: 401 });
  }

  let parsed;
  try {
    parsed = await parseRequestBody(req);
  } catch (err) {
    const status = err?.status || 400;
    return NextResponse.json({ ok: false, message: err?.message || 'Body request tidak valid.' }, { status });
  }
  const body = parsed.body || {};

  try {
    const kategori = String(body?.kategori || '').trim();
    const keperluan = body?.keperluan === undefined || body?.keperluan === null ? null : String(body.keperluan);
    const handover = body?.handover === undefined || body?.handover === null ? null : String(body.handover);

    if (!kategori) {
      return NextResponse.json({ ok: false, message: 'kategori wajib diisi.' }, { status: 400 });
    }

    // jenis_pengajuan harus "tukar_hari"
    const jenis_pengajuan_input = (body?.jenis_pengajuan ?? 'tukar_hari')
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[-\s]+/g, '_');
    if (jenis_pengajuan_input !== 'tukar_hari') {
      return NextResponse.json({ ok: false, message: "jenis_pengajuan harus bernilai 'tukar_hari'." }, { status: 400 });
    }
    const jenis_pengajuan = 'tukar_hari';

    // Handover tags
    const handoverIdsInput = body?.['handover_tag_user_ids[]'] ?? body?.handover_tag_user_ids;
    const handoverIds = sanitizeHandoverIds(handoverIdsInput);
    if (handoverIds && handoverIds.length) {
      const users = await db.user.findMany({
        where: { id_user: { in: handoverIds }, deleted_at: null },
        select: { id_user: true },
      });
      const found = new Set(users.map((u) => u.id_user));
      const missing = handoverIds.filter((id) => !found.has(id));
      if (missing.length) {
        return NextResponse.json({ ok: false, message: 'Beberapa handover_tag_user_ids tidak valid.' }, { status: 400 });
      }
    }

    // Lampiran (opsional)
    let uploadMeta = null;
    let lampiranUrl = null;
    const lampiranFile = findFileInBody(body, ['lampiran_izin_tukar_hari', 'lampiran', 'lampiran_file', 'file']);
    if (lampiranFile) {
      try {
        const res = await storageClient.uploadBufferWithPresign(lampiranFile, { folder: 'izin-tukar-hari' });
        lampiranUrl = res.publicUrl || null;
        uploadMeta = { key: res.key, publicUrl: res.publicUrl, etag: res.etag, size: res.size };
      } catch (e) {
        return NextResponse.json({ ok: false, message: 'Gagal mengunggah lampiran.', detail: e?.message || String(e) }, { status: 502 });
      }
    }

    // Pairs
    const pairsRaw = parsePairsFromBody(body);
    const pairsCheck = await validateAndNormalizePairs(actorId, pairsRaw);
    if (!pairsCheck.ok) {
      return NextResponse.json({ ok: false, message: pairsCheck.message }, { status: pairsCheck.status || 400 });
    }
    const pairs = pairsCheck.value;

    // Approvals (opsional)
    // --- PERBAIKAN DI SINI ---
    // Baca dari body.approvals (untuk JSON) atau body['approvals[]'] (untuk form-data)
    const rawApprovals = body.approvals ?? body['approvals[]'];
    let approvals = [];
    if (rawApprovals !== undefined) {
      const list = Array.isArray(rawApprovals) ? rawApprovals : [rawApprovals];
      // --- AKHIR PERBAIKAN ---
      approvals = list.map((a) => {
        if (typeof a === 'string') {
          try {
            return JSON.parse(a);
          } catch {
            return {};
          }
        }
        return a || {};
      });
      // validasi user id kalau ada
      const approverIds = approvals.map((a) => a.approver_user_id).filter(Boolean);
      if (approverIds.length) {
        const users = await db.user.findMany({
          where: { id_user: { in: approverIds }, deleted_at: null },
          select: { id_user: true },
        });
        const okIds = new Set(users.map((u) => u.id_user));
        const notFound = approverIds.filter((x) => !okIds.has(x));
        if (notFound.length) {
          return NextResponse.json({ ok: false, message: 'Beberapa approver_user_id tidak ditemukan.' }, { status: 400 });
        }
      }
    }

    // Transaksi pembuatan
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
            decision: 'pending', // ❗ default enum
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

    // Notifikasi sederhana (pemohon & handover)
    if (full) {
      const deeplink = `/izin-tukar-hari/${full.id_izin_tukar_hari}`;
      const firstPair = (full.pairs || [])[0];
      const hariIzinDisplay = formatDateDisplay(firstPair?.hari_izin);
      const bodyBase = {
        kategori: full.kategori,
        hari_izin: firstPair?.hari_izin ? formatDateISO(firstPair.hari_izin) : undefined,
        hari_izin_display: hariIzinDisplay,
        related_table: 'izin_tukar_hari',
        related_id: full.id_izin_tukar_hari,
        deeplink,
      };

      const promises = [];

      // notif ke pemohon
      promises.push(
        sendNotification(
          'SWAP_CREATE_SUCCESS',
          full.id_user,
          {
            ...bodyBase,
            title: 'Pengajuan izin tukar hari terkirim',
            body: `Pengajuan tukar hari kategori ${full.kategori} telah dibuat (mulai ${hariIzinDisplay}).`,
            overrideTitle: 'Pengajuan izin tukar hari terkirim',
            overrideBody: `Pengajuan tukar hari kategori ${full.kategori} telah dibuat (mulai ${hariIzinDisplay}).`,
          },
          { deeplink }
        )
      );

      // notif ke handover tags
      if (Array.isArray(full.handover_users)) {
        const sent = new Set();
        for (const h of full.handover_users) {
          const uid = h?.id_user_tagged;
          if (!uid || sent.has(uid)) continue;
          sent.add(uid);
          promises.push(
            sendNotification(
              'SWAP_HANDOVER_TAGGED',
              uid,
              {
                ...bodyBase,
                nama_penerima: h?.user?.nama_pengguna || undefined,
                title: `${full.user?.nama_pengguna || 'Rekan'} mengajukan tukar hari`,
                body: `${full.user?.nama_pengguna || 'Rekan'} menandai Anda untuk pengajuan tukar hari pada ${hariIzinDisplay}.`,
                overrideTitle: `${full.user?.nama_pengguna || 'Rekan'} mengajukan tukar hari`,
                overrideBody: `${full.user?.nama_pengguna || 'Rekan'} menandai Anda pada ${hariIzinDisplay}.`,
              },
              { deeplink }
            )
          );
        }
      }

      await Promise.allSettled(promises);
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
