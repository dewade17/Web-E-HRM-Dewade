import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { ensureAuth, izinInclude } from '../route';
import { parseRequestBody, findFileInBody } from '@/app/api/_utils/requestBody';
import storageClient from '@/app/api/_utils/storageClient';
import { parseDateOnlyToUTC } from '@/helpers/date-helper';

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
const isAdmin = (role) => ADMIN_ROLES.has(normRole(role));

function formatDateISO(value) {
  if (!value) return '-';
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return '-';
  }
}
function formatDateDisplay(value) {
  if (!value) return '-';
  try {
    return dateDisplayFormatter.format(new Date(value));
  } catch {
    return formatDateISO(value);
  }
}
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

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

/** Parser universal untuk pairs di PUT */
function parsePairsFromBody(body) {
  if (!body) return undefined; // bedakan "tidak dikirim" vs "array kosong"
  // 1) JSON langsung
  if (Array.isArray(body.pairs)) {
    return body.pairs.map((p) => (typeof p === 'string' ? safeJson(p) : p || {}));
  }
  // 2) pairs[] dari form-data
  if (body['pairs[]'] !== undefined) {
    const list = Array.isArray(body['pairs[]']) ? body['pairs[]'] : [body['pairs[]']];
    return list.map((s) => safeJson(s));
  }
  // 3) dua array paralel
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
  return undefined; // benar-benar tidak ada input pairs di PUT
}

/** Validasi & normalisasi pairs untuk UPDATE (exclude pengajuan yang sedang diubah) */
async function validateAndNormalizePairsForUpdate({ userId, currentId, pairsRaw }) {
  if (!Array.isArray(pairsRaw)) {
    return { ok: false, status: 400, message: 'pairs harus berupa array.' };
  }
  if (pairsRaw.length === 0) {
    return { ok: false, status: 400, message: 'pairs wajib diisi minimal 1 pasangan hari.' };
  }

  const normalized = [];
  const seenIzin = new Set();
  const seenGanti = new Set();

  for (let i = 0; i < pairsRaw.length; i++) {
    const p = pairsRaw[i] || {};
    const izin = parseDateOnlyToUTC(p.hari_izin ?? p.izin ?? p.date_izin);
    const ganti = parseDateOnlyToUTC(p.hari_pengganti ?? p.pengganti ?? p.date_pengganti);
    const note = p.catatan_pair === undefined || p.catatan_pair === null ? null : String(p.catatan_pair);

    if (!izin || !ganti) {
      return { ok: false, status: 400, message: `Pair #${i + 1} tidak valid: 'hari_izin' dan 'hari_pengganti' wajib tanggal valid (YYYY-MM-DD).` };
    }
    if (izin.getTime() === ganti.getTime()) {
      return { ok: false, status: 400, message: `Pair #${i + 1} tidak valid: 'hari_izin' tidak boleh sama dengan 'hari_pengganti'.` };
    }

    const kI = formatDateISO(izin);
    const kG = formatDateISO(ganti);
    if (seenIzin.has(kI)) return { ok: false, status: 400, message: `Tanggal 'hari_izin' ${kI} duplikat dalam pengajuan ini.` };
    if (seenGanti.has(kG)) return { ok: false, status: 400, message: `Tanggal 'hari_pengganti' ${kG} duplikat dalam pengajuan ini.` };
    seenIzin.add(kI);
    seenGanti.add(kG);

    normalized.push({ hari_izin: izin, hari_pengganti: ganti, catatan_pair: note });
  }

  const izinDates = normalized.map((p) => p.hari_izin);
  const gantiDates = normalized.map((p) => p.hari_pengganti);

  // Cek bentrok dengan pengajuan tukar-hari lain (exclude currentId)
  const existingPairs = await db.izinTukarHariPair.findMany({
    where: {
      OR: [{ hari_izin: { in: izinDates } }, { hari_pengganti: { in: gantiDates } }],
      izin_tukar_hari: {
        id_user: userId,
        deleted_at: null,
        status: { in: ['pending', 'disetujui'] }, // ❗ tanpa 'menunggu'
        NOT: { id_izin_tukar_hari: currentId },
      },
    },
    select: { hari_izin: true, hari_pengganti: true },
  });
  if (existingPairs.length) {
    const details = existingPairs.map((p) => `(${formatDateISO(p.hari_izin)} ↔ ${formatDateISO(p.hari_pengganti)})`).join(', ');
    return { ok: false, status: 409, message: `Terdapat pasangan yang sudah diajukan di pengajuan lain: ${details}.` };
  }

  // Cek bentrok cuti disetujui
  const cutiBentrok = await db.pengajuanCutiTanggal.findMany({
    where: {
      tanggal_cuti: { in: [...izinDates, ...gantiDates] },
      pengajuan_cuti: { id_user: userId, deleted_at: null, status: 'disetujui' },
    },
    select: { tanggal_cuti: true },
  });
  if (cutiBentrok.length) {
    const list = Array.from(new Set(cutiBentrok.map((x) => formatDateISO(x.tanggal_cuti)))).join(', ');
    return { ok: false, status: 409, message: `Tanggal berikut sudah tercatat sebagai cuti disetujui: ${list}.` };
  }

  return { ok: true, value: normalized };
}

/* ============================ GET (Detail) ============================ */
export async function GET(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;
  const actorId = auth.actor?.id;
  if (!actorId) return NextResponse.json({ ok: false, message: 'Unauthorized.' }, { status: 401 });

  const id = params?.id;
  if (!id) return NextResponse.json({ ok: false, message: 'id wajib diisi.' }, { status: 400 });

  try {
    const data = await db.izinTukarHari.findUnique({
      where: { id_izin_tukar_hari: id },
      include: izinInclude,
    });
    if (!data || data.deleted_at) {
      return NextResponse.json({ ok: false, message: 'Data tidak ditemukan.' }, { status: 404 });
    }

    if (!isAdmin(auth.actor?.role) && data.id_user !== actorId) {
      return NextResponse.json({ ok: false, message: 'Forbidden.' }, { status: 403 });
    }

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error('GET /mobile/izin-tukar-hari/[id] error:', err);
    return NextResponse.json({ ok: false, message: 'Gagal mengambil detail pengajuan.' }, { status: 500 });
  }
}

/* ============================ PUT (Update) ============================ */
export async function PUT(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  const role = auth.actor?.role;
  if (!actorId) return NextResponse.json({ ok: false, message: 'Unauthorized.' }, { status: 401 });

  const id = params?.id;
  if (!id) return NextResponse.json({ ok: false, message: 'id wajib diisi.' }, { status: 400 });

  let parsed;
  try {
    parsed = await parseRequestBody(req);
  } catch (err) {
    const status = err?.status || 400;
    return NextResponse.json({ ok: false, message: err?.message || 'Body request tidak valid.' }, { status });
  }
  const body = parsed.body || {};

  try {
    const existing = await db.izinTukarHari.findUnique({
      where: { id_izin_tukar_hari: id },
      include: { pairs: true, approvals: true, handover_users: true },
    });
    if (!existing || existing.deleted_at) {
      return NextResponse.json({ ok: false, message: 'Data tidak ditemukan.' }, { status: 404 });
    }

    // Akses
    const owner = existing.id_user === actorId;
    if (!owner && !isAdmin(role)) {
      return NextResponse.json({ ok: false, message: 'Forbidden.' }, { status: 403 });
    }
    // Hanya status 'pending' yang bisa diubah
    if (existing.status !== 'pending') {
      return NextResponse.json({ ok: false, message: 'Pengajuan yang sudah diputus tidak dapat diubah.' }, { status: 409 });
    }

    const kategori = body?.kategori === undefined ? undefined : String(body.kategori || '').trim();
    const keperluan = body?.keperluan === undefined ? undefined : body.keperluan === null ? null : String(body.keperluan);
    const handover = body?.handover === undefined ? undefined : body.handover === null ? null : String(body.handover);

    // Lampiran (opsional pengganti)
    let lampiranUrlUpdate = undefined;
    const lampiranFile = findFileInBody(body, ['lampiran_izin_tukar_hari', 'lampiran', 'lampiran_file', 'file']);
    if (lampiranFile) {
      try {
        const res = await storageClient.uploadBufferWithPresign(lampiranFile, { folder: 'izin-tukar-hari' });
        lampiranUrlUpdate = res.publicUrl || null;
      } catch (e) {
        return NextResponse.json({ ok: false, message: 'Gagal mengunggah lampiran.', detail: e?.message || String(e) }, { status: 502 });
      }
    }

    // Pairs (replace full) — hanya jika dikirim
    const pairsRaw = parsePairsFromBody(body);
    let normalizedPairs = undefined;
    if (pairsRaw !== undefined) {
      const check = await validateAndNormalizePairsForUpdate({ userId: existing.id_user, currentId: existing.id_izin_tukar_hari, pairsRaw });
      if (!check.ok) return NextResponse.json({ ok: false, message: check.message }, { status: check.status || 400 });
      normalizedPairs = check.value;
    }

    // Handover tags (replace full) — hanya jika dikirim
    const handoverIdsInput = body?.['handover_tag_user_ids[]'] ?? body?.handover_tag_user_ids;
    let handoverIds = undefined;
    if (handoverIdsInput !== undefined) {
      handoverIds = sanitizeHandoverIds(handoverIdsInput);
      if (handoverIds.length) {
        const users = await db.user.findMany({
          where: { id_user: { in: handoverIds }, deleted_at: null },
          select: { id_user: true },
        });
        const ok = new Set(users.map((u) => u.id_user));
        const missing = handoverIds.filter((x) => !ok.has(x));
        if (missing.length) {
          return NextResponse.json({ ok: false, message: 'Beberapa handover_tag_user_ids tidak valid.' }, { status: 400 });
        }
      }
    }

    // Approvals (replace full) — hanya jika dikirim
    let approvalsReplace = undefined;
    if (body.approvals !== undefined) {
      const raw = Array.isArray(body.approvals) ? body.approvals : [body.approvals];
      const rows = raw
        .flatMap((a) => {
          if (typeof a === 'string') {
            try {
              const parsed = safeJson(a);
              return Array.isArray(parsed) ? parsed : [parsed];
            } catch {
              return [{}];
            }
          }
          return [a || {}];
        })
        .map((a, idx) => ({
          level: Number.isFinite(+a.level) ? +a.level : idx + 1,
          approver_user_id: a.approver_user_id ? String(a.approver_user_id) : null,
          approver_role: a.approver_role ? String(a.approver_role) : null,
        }))
        .sort((x, y) => x.level - y.level);

      const approverIds = rows.map((r) => r.approver_user_id).filter(Boolean);
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
      approvalsReplace = rows;
    }

    const updated = await db.$transaction(async (tx) => {
      // Update kolom sederhana
      const data = {};
      if (kategori !== undefined) data.kategori = kategori;
      if (keperluan !== undefined) data.keperluan = keperluan;
      if (handover !== undefined) data.handover = handover;
      if (lampiranUrlUpdate !== undefined) data.lampiran_izin_tukar_hari_url = lampiranUrlUpdate;

      if (Object.keys(data).length) {
        await tx.izinTukarHari.update({ where: { id_izin_tukar_hari: id }, data });
      }

      // Replace pairs
      if (normalizedPairs !== undefined) {
        await tx.izinTukarHariPair.deleteMany({ where: { id_izin_tukar_hari: id } });
        await tx.izinTukarHariPair.createMany({
          data: normalizedPairs.map((p) => ({
            id_izin_tukar_hari: id,
            hari_izin: p.hari_izin,
            hari_pengganti: p.hari_pengganti,
            catatan_pair: p.catatan_pair || null,
          })),
          skipDuplicates: true,
        });
      }

      // Replace handover tags
      if (handoverIds !== undefined) {
        await tx.handoverTukarHari.deleteMany({ where: { id_izin_tukar_hari: id } });
        if (handoverIds.length) {
          await tx.handoverTukarHari.createMany({
            data: handoverIds.map((uid) => ({ id_izin_tukar_hari: id, id_user_tagged: uid })),
            skipDuplicates: true,
          });
        }
      }

      // Replace approvals
      if (approvalsReplace !== undefined) {
        await tx.approvalIzinTukarHari.deleteMany({ where: { id_izin_tukar_hari: id } });
        if (approvalsReplace.length) {
          await tx.approvalIzinTukarHari.createMany({
            data: approvalsReplace.map((a) => ({
              id_izin_tukar_hari: id,
              level: a.level,
              approver_user_id: a.approver_user_id,
              approver_role: a.approver_role,
              decision: 'pending', // ❗ default sesuai enum
            })),
            skipDuplicates: true,
          });
        }
      }

      return tx.izinTukarHari.findUnique({ where: { id_izin_tukar_hari: id }, include: izinInclude });
    });

    return NextResponse.json({ ok: true, message: 'Pengajuan izin tukar hari diperbarui.', data: updated });
  } catch (err) {
    console.error('PUT /mobile/izin-tukar-hari/[id] error:', err);
    return NextResponse.json({ ok: false, message: 'Gagal memperbarui pengajuan.' }, { status: 500 });
  }
}

/* ============================ DELETE (Soft delete) ============================ */
export async function DELETE(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  const role = auth.actor?.role;
  if (!actorId) return NextResponse.json({ ok: false, message: 'Unauthorized.' }, { status: 401 });

  const id = params?.id;
  if (!id) return NextResponse.json({ ok: false, message: 'id wajib diisi.' }, { status: 400 });

  try {
    const existing = await db.izinTukarHari.findUnique({
      where: { id_izin_tukar_hari: id },
      select: { id_izin_tukar_hari: true, id_user: true, status: true, deleted_at: true },
    });
    if (!existing || existing.deleted_at) {
      return NextResponse.json({ ok: false, message: 'Data tidak ditemukan.' }, { status: 404 });
    }

    const owner = existing.id_user === actorId;
    if (!owner && !isAdmin(role)) {
      return NextResponse.json({ ok: false, message: 'Forbidden.' }, { status: 403 });
    }
    // Non-admin hanya boleh hapus yang 'pending'
    if (!isAdmin(role) && existing.status !== 'pending') {
      return NextResponse.json({ ok: false, message: 'Hanya pengajuan pending yang dapat dihapus.' }, { status: 409 });
    }

    await db.izinTukarHari.update({
      where: { id_izin_tukar_hari: id },
      data: { deleted_at: new Date() },
    });

    return NextResponse.json({ ok: true, message: 'Pengajuan izin tukar hari dihapus.' });
  } catch (err) {
    console.error('DELETE /mobile/izin-tukar-hari/[id] error:', err);
    return NextResponse.json({ ok: false, message: 'Gagal menghapus pengajuan.' }, { status: 500 });
  }
}
