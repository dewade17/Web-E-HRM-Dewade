export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { ensureAuth, reimburseInclude } from '../route';
import { uploadMediaWithFallback } from '@/app/api/_utils/uploadWithFallback';
import { parseRequestBody, findFileInBody } from '@/app/api/_utils/requestBody';
import { parseDateOnlyToUTC } from '@/helpers/date-helper';
import { parseApprovalsFromBody, ensureApprovalUsersExist, syncApprovalRecords } from '../_utils/approvals';

const ADMIN_ROLES = new Set(['HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN', 'SUBADMIN', 'SUPERVISI']);
const SUPER_ROLES = new Set(['HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN']);

function normalizeRole(role) {
  if (!role) return null;
  return String(role).trim().toUpperCase() || null;
}

function isAdminRole(role) {
  return ADMIN_ROLES.has(normalizeRole(role));
}

function isSuperAdmin(role) {
  return SUPER_ROLES.has(normalizeRole(role));
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
// function 
function normalizeMoney(value, fieldName) {
  if (isNullLike(value)) return null;
  const raw = typeof value === 'string' ? value.replace(/,/g, '').trim() : value;
  const num = typeof raw === 'number' ? raw : Number.parseFloat(String(raw));
  if (!Number.isFinite(num)) {
    const err = new Error(`${fieldName} harus berupa angka.`);
    err.status = 400;
    throw err;
  }
  if (num < 0) {
    const err = new Error(`${fieldName} tidak boleh negatif.`);
    err.status = 400;
    throw err;
  }
  return num.toFixed(2);
}

function parseItemsInput(body) {
  const raw = body?.items ?? body?.reimburse_items ?? body?.detail_items ?? body?.detail;
  if (raw === undefined) return undefined;
  let arr = raw;
  if (typeof arr === 'string') {
    const trimmed = arr.trim();
    if (!trimmed) return [];
    try {
      arr = JSON.parse(trimmed);
    } catch (_) {}
  }
  if (!Array.isArray(arr)) {
    const err = new Error('items harus berupa array.');
    err.status = 400;
    throw err;
  }
  return arr.map((it, idx) => {
    const nama = String(it?.nama_item_reimburse ?? it?.nama_item ?? it?.nama ?? '').trim();
    if (!nama) {
      const err = new Error(`items[${idx}].nama_item_reimburse wajib diisi.`);
      err.status = 400;
      throw err;
    }
    const harga = normalizeMoney(it?.harga, `items[${idx}].harga`);
    if (harga === null) {
      const err = new Error(`items[${idx}].harga wajib diisi.`);
      err.status = 400;
      throw err;
    }
    return { nama_item_reimburse: nama, harga };
  });
}

function sumItemsMoney(items) {
  if (!Array.isArray(items) || !items.length) return '0.00';
  const total = items.reduce((acc, it) => acc + Number.parseFloat(it.harga), 0);
  return (Number.isFinite(total) ? total : 0).toFixed(2);
}

async function getActorUser(actorId) {
  if (!actorId) return null;
  return db.user.findUnique({
    where: { id_user: actorId },
    select: { id_user: true, role: true, id_departement: true, deleted_at: true },
  });
}

async function getReimburseOr404(id) {
  if (!id) return null;
  return db.reimburse.findFirst({
    where: { id_reimburse: id, deleted_at: null },
    include: reimburseInclude,
  });
}

function canAccessReimburse(actor, reimburse) {
  if (!actor || !reimburse) return false;
  const role = normalizeRole(actor.role);
  if (isAdminRole(role)) return true;
  if (!actor.id_departement) return false;
  return actor.id_departement === reimburse.id_departement;
}

/* ============================ GET (Detail) ============================ */
export async function GET(req, ctx) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  const actorRole = normalizeRole(auth.actor?.role);
  const id = ctx?.params?.id ? String(ctx.params.id).trim() : null;
  if (!id) return NextResponse.json({ ok: false, message: 'id wajib diisi.' }, { status: 400 });
  if (!actorId) return NextResponse.json({ ok: false, message: 'Unauthorized.' }, { status: 401 });

  try {
    const [actor, reimburse] = await Promise.all([getActorUser(actorId), getReimburseOr404(id)]);
    if (!actor || actor.deleted_at) return NextResponse.json({ ok: false, message: 'User tidak ditemukan.' }, { status: 404 });
    if (!reimburse) return NextResponse.json({ ok: false, message: 'Reimburse tidak ditemukan.' }, { status: 404 });

    if (!canAccessReimburse(actor, reimburse)) {
      return NextResponse.json({ ok: false, message: 'Forbidden.' }, { status: 403 });
    }

    return NextResponse.json({ ok: true, data: reimburse });
  } catch (err) {
    console.error('GET /mobile/reimburse/[id] error:', err);
    return NextResponse.json({ ok: false, message: 'Gagal mengambil detail reimburse.' }, { status: 500 });
  }
}

/* ============================ PUT/PATCH (Update) ============================ */
async function handleUpdate(req, ctx) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  const actorRole = normalizeRole(auth.actor?.role);
  const id = ctx?.params?.id ? String(ctx.params.id).trim() : null;
  if (!id) return NextResponse.json({ ok: false, message: 'id wajib diisi.' }, { status: 400 });
  if (!actorId) return NextResponse.json({ ok: false, message: 'Unauthorized.' }, { status: 401 });

  let body;
  try {
    const result = await parseRequestBody(req);
    body = result.body;
  } catch (err) {
    return NextResponse.json({ ok: false, message: err?.message || 'Body tidak valid.' }, { status: err?.status || 400 });
  }

  try {
    const actor = await getActorUser(actorId);
    if (!actor || actor.deleted_at) return NextResponse.json({ ok: false, message: 'User tidak ditemukan.' }, { status: 404 });

    const existing = await getReimburseOr404(id);
    if (!existing) return NextResponse.json({ ok: false, message: 'Reimburse tidak ditemukan.' }, { status: 404 });

    if (!canAccessReimburse(actor, existing)) {
      return NextResponse.json({ ok: false, message: 'Forbidden.' }, { status: 403 });
    }

    // default: hanya pending yang bisa diedit. super admin boleh bypass.
    if (existing.status !== 'pending' && !isSuperAdmin(actorRole)) {
      return NextResponse.json({ ok: false, message: 'Reimburse sudah diproses dan tidak dapat diubah.' }, { status: 409 });
    }

    const updateData = {};

    if (Object.prototype.hasOwnProperty.call(body, 'tanggal') && !isNullLike(body.tanggal)) {
      const parsed = parseDateOnlyToUTC(body.tanggal);
      if (!parsed) return NextResponse.json({ ok: false, message: 'tanggal tidak valid.' }, { status: 400 });
      updateData.tanggal = parsed;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'keterangan')) {
      updateData.keterangan = isNullLike(body.keterangan) ? null : String(body.keterangan);
    }

    if (Object.prototype.hasOwnProperty.call(body, 'metode_pembayaran') && !isNullLike(body.metode_pembayaran)) {
      updateData.metode_pembayaran = String(body.metode_pembayaran).trim();
    }

    if (Object.prototype.hasOwnProperty.call(body, 'nomor_rekening')) {
      updateData.nomor_rekening = isNullLike(body.nomor_rekening) ? null : String(body.nomor_rekening).trim();
    }
    if (Object.prototype.hasOwnProperty.call(body, 'nama_pemilik_rekening')) {
      updateData.nama_pemilik_rekening = isNullLike(body.nama_pemilik_rekening) ? null : String(body.nama_pemilik_rekening).trim();
    }
    if (Object.prototype.hasOwnProperty.call(body, 'jenis_bank')) {
      updateData.jenis_bank = isNullLike(body.jenis_bank) ? null : String(body.jenis_bank).trim();
    }

    if (Object.prototype.hasOwnProperty.call(body, 'id_kategori_keperluan')) {
      const nextKategori = isNullLike(body.id_kategori_keperluan) ? null : String(body.id_kategori_keperluan).trim();
      if (nextKategori) {
        const kategori = await db.kategoriKeperluan.findFirst({
          where: { id_kategori_keperluan: nextKategori, deleted_at: null },
          select: { id_kategori_keperluan: true },
        });
        if (!kategori) return NextResponse.json({ ok: false, message: 'Kategori keperluan tidak ditemukan.' }, { status: 404 });
      }
      updateData.id_kategori_keperluan = nextKategori;
    }

    let buktiUrl = undefined;
    let uploadMeta = null;
    const buktiFile = findFileInBody(body, ['bukti_pembayaran', 'bukti', 'bukti_pembayaran_url', 'bukti_url']);
    if (buktiFile) {
      try {
        const uploaded = await uploadMediaWithFallback(buktiFile, {
          storageFolder: 'financial',
          supabasePrefix: 'financial',
          pathSegments: [String(existing.id_user)],
        });

        buktiUrl = uploaded.publicUrl || null;

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
        return NextResponse.json(
          {
            ok: false,
            message: 'Gagal mengunggah bukti pembayaran.',
            detail: e?.message || String(e),
            errors: e?.errors,
          },
          { status: e?.status || 502 }
        );
      }
    } else if (Object.prototype.hasOwnProperty.call(body, 'bukti_pembayaran_url')) {
      buktiUrl = isNullLike(body.bukti_pembayaran_url) ? null : String(body.bukti_pembayaran_url).trim();
    }
    if (buktiUrl !== undefined) updateData.bukti_pembayaran_url = buktiUrl;

    const itemsInput = parseItemsInput(body);
    const itemsProvided = itemsInput !== undefined;

    let approvalsInput;
    try {
      approvalsInput = parseApprovalsFromBody(body);
      if (approvalsInput !== undefined) {
        await ensureApprovalUsersExist(db, approvalsInput);
      }
    } catch (err) {
      return NextResponse.json({ ok: false, message: err?.message || 'Approval input tidak valid.' }, { status: err?.status || 400 });
    }

    const updated = await db.$transaction(async (tx) => {
      // update core
      if (Object.keys(updateData).length) {
        await tx.reimburse.update({ where: { id_reimburse: id }, data: updateData });
      }

      // items replace
      if (itemsProvided) {
        await tx.reimburseItem.deleteMany({ where: { id_reimburse: id } });
        const items = Array.isArray(itemsInput) ? itemsInput : [];
        if (items.length) {
          await tx.reimburseItem.createMany({
            data: items.map((it) => ({
              id_reimburse: id,
              nama_item_reimburse: it.nama_item_reimburse,
              harga: it.harga,
            })),
          });
        }
        // recalc total unless explicitly provided
        const totalExplicit = Object.prototype.hasOwnProperty.call(body, 'total_pengeluaran') ? normalizeMoney(body.total_pengeluaran, 'total_pengeluaran') : null;
        const totalRecalc = totalExplicit ?? sumItemsMoney(items);
        await tx.reimburse.update({ where: { id_reimburse: id }, data: { total_pengeluaran: totalRecalc } });
      } else if (Object.prototype.hasOwnProperty.call(body, 'total_pengeluaran')) {
        const total = normalizeMoney(body.total_pengeluaran, 'total_pengeluaran');
        if (total === null) {
          return NextResponse.json({ ok: false, message: "Field 'total_pengeluaran' wajib berupa angka jika disupply." }, { status: 400 });
        }
        await tx.reimburse.update({ where: { id_reimburse: id }, data: { total_pengeluaran: total } });
      }

      // approvals sync
      if (approvalsInput !== undefined) {
        await syncApprovalRecords(tx, id, approvalsInput);
      }

      return tx.reimburse.findUnique({ where: { id_reimburse: id }, include: reimburseInclude });
    });

    return NextResponse.json({ ok: true, message: 'Reimburse berhasil diperbarui.', data: updated, upload: uploadMeta });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    console.error('UPDATE /mobile/reimburse/[id] error:', err);
    return NextResponse.json({ ok: false, message: err?.message || 'Gagal memperbarui reimburse.' }, { status: err?.status || 500 });
  }
}

export async function PUT(req, ctx) {
  return handleUpdate(req, ctx || {});
}

export async function PATCH(req, ctx) {
  return handleUpdate(req, ctx || {});
}

/* ============================ DELETE ============================ */
export async function DELETE(req, ctx) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  const actorRole = normalizeRole(auth.actor?.role);
  const id = ctx?.params?.id ? String(ctx.params.id).trim() : null;
  if (!id) return NextResponse.json({ ok: false, message: 'id wajib diisi.' }, { status: 400 });
  if (!actorId) return NextResponse.json({ ok: false, message: 'Unauthorized.' }, { status: 401 });

  try {
    const actor = await getActorUser(actorId);
    if (!actor || actor.deleted_at) return NextResponse.json({ ok: false, message: 'User tidak ditemukan.' }, { status: 404 });

    const existing = await getReimburseOr404(id);
    if (!existing) return NextResponse.json({ ok: false, message: 'Reimburse tidak ditemukan.' }, { status: 404 });

    if (!canAccessReimburse(actor, existing)) {
      return NextResponse.json({ ok: false, message: 'Forbidden.' }, { status: 403 });
    }

    if (existing.status !== 'pending' && !isSuperAdmin(actorRole)) {
      return NextResponse.json({ ok: false, message: 'Reimburse sudah diproses dan tidak dapat dihapus.' }, { status: 409 });
    }

    await db.reimburse.delete({ where: { id_reimburse: id } });

    return NextResponse.json({ ok: true, message: 'Reimburse berhasil dihapus.' });
  } catch (err) {
    console.error('DELETE /mobile/reimburse/[id] error:', err);
    return NextResponse.json({ ok: false, message: 'Gagal menghapus reimburse.' }, { status: 500 });
  }
}
