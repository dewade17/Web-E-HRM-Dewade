export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { ensureAuth, pocketMoneyInclude } from '../route';
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
  const raw = body?.items ?? body?.pocket_money_items ?? body?.detail_items ?? body?.detail;
  if (raw === undefined) return undefined; // tidak disupply
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
    const nama = String(it?.nama_item_pocket_money ?? it?.nama_item ?? it?.nama ?? '').trim();
    if (!nama) {
      const err = new Error(`items[${idx}].nama_item_pocket_money wajib diisi.`);
      err.status = 400;
      throw err;
    }
    const harga = normalizeMoney(it?.harga, `items[${idx}].harga`);
    if (harga === null) {
      const err = new Error(`items[${idx}].harga wajib diisi.`);
      err.status = 400;
      throw err;
    }
    return { nama_item_pocket_money: nama, harga };
  });
}

async function getActorUser(actorId) {
  if (!actorId) return null;
  return db.user.findUnique({
    where: { id_user: actorId },
    select: {
      id_user: true,
      nama_pengguna: true,
      role: true,
      id_departement: true,
      deleted_at: true,
      departement: { select: { id_departement: true, nama_departement: true, id_supervisor: true } },
    },
  });
}

async function getPocketMoneyOr404(id_pocket_money) {
  if (!id_pocket_money) return null;
  return db.pocketMoney.findUnique({
    where: { id_pocket_money },
    include: pocketMoneyInclude,
  });
}

function canAccessPocketMoney(actor, pocketMoney) {
  if (!actor || !pocketMoney) return false;
  const actorRole = normalizeRole(actor.role);
  if (isAdminRole(actorRole)) return true;
  if (!actor.id_departement) return false;
  return String(pocketMoney.id_departement) === String(actor.id_departement);
}

/* ============================ GET (Detail) ============================ */
export async function GET(req, ctx) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  const id = ctx?.params?.id ? String(ctx.params.id).trim() : null;
  if (!id) return NextResponse.json({ ok: false, message: 'id wajib diisi.' }, { status: 400 });
  if (!actorId) return NextResponse.json({ ok: false, message: 'Unauthorized.' }, { status: 401 });

  try {
    const actor = await getActorUser(actorId);
    if (!actor || actor.deleted_at) return NextResponse.json({ ok: false, message: 'User tidak ditemukan.' }, { status: 404 });

    const pocketMoney = await getPocketMoneyOr404(id);
    if (!pocketMoney || pocketMoney.deleted_at) return NextResponse.json({ ok: false, message: 'Pocket money tidak ditemukan.' }, { status: 404 });

    if (!canAccessPocketMoney(actor, pocketMoney)) {
      return NextResponse.json({ ok: false, message: 'Forbidden.' }, { status: 403 });
    }

    return NextResponse.json({ ok: true, data: pocketMoney });
  } catch (err) {
    console.error('GET /mobile/pocket-money/[id] error:', err);
    return NextResponse.json({ ok: false, message: 'Gagal mengambil detail pocket money.' }, { status: 500 });
  }
}

/* ============================ UPDATE (PUT/PATCH) ============================ */
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

    const existing = await getPocketMoneyOr404(id);
    if (!existing) return NextResponse.json({ ok: false, message: 'Pocket money tidak ditemukan.' }, { status: 404 });

    if (!canAccessPocketMoney(actor, existing)) {
      return NextResponse.json({ ok: false, message: 'Forbidden.' }, { status: 403 });
    }

    if (existing.status !== 'pending' && !isSuperAdmin(actorRole)) {
      return NextResponse.json({ ok: false, message: 'Pocket money sudah diproses dan tidak dapat diubah.' }, { status: 409 });
    }

    const updateData = {};

    if (Object.prototype.hasOwnProperty.call(body, 'tanggal')) {
      const tanggal = isNullLike(body.tanggal) ? null : parseDateOnlyToUTC(String(body.tanggal));
      if (!tanggal) return NextResponse.json({ ok: false, message: 'tanggal tidak valid (format: YYYY-MM-DD).' }, { status: 400 });
      updateData.tanggal = tanggal;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'keterangan')) {
      updateData.keterangan = isNullLike(body.keterangan) ? null : String(body.keterangan).trim();
    }

    if (Object.prototype.hasOwnProperty.call(body, 'id_kategori_keperluan')) {
      const id_kategori_keperluan = isNullLike(body.id_kategori_keperluan) ? null : String(body.id_kategori_keperluan).trim();
      if (id_kategori_keperluan) {
        const kategori = await db.kategoriKeperluan.findFirst({
          where: { id_kategori_keperluan, deleted_at: null },
          select: { id_kategori_keperluan: true },
        });
        if (!kategori) return NextResponse.json({ ok: false, message: 'Kategori keperluan tidak ditemukan.' }, { status: 404 });
      }
      updateData.id_kategori_keperluan = id_kategori_keperluan;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'metode_pembayaran')) {
      const metode = isNullLike(body.metode_pembayaran) ? '' : String(body.metode_pembayaran).trim();
      if (!metode) return NextResponse.json({ ok: false, message: 'metode_pembayaran wajib diisi jika disupply.' }, { status: 400 });
      updateData.metode_pembayaran = metode;
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

    // bukti pembayaran (file/url)
    let buktiUrl = null;
    let uploadMeta = null;
    const buktiFile = findFileInBody(body, ['bukti_pembayaran', 'bukti', 'file', 'bukti_pembayaran_file']);
    if (buktiFile) {
      try {
        const uploaded = await uploadMediaWithFallback(buktiFile, {
          storageFolder: 'financial',
          supabasePrefix: 'financial',
          pathSegments: [String(actorId)],
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
            message: 'Gagal upload bukti approval.',
            detail: e?.message || String(e),
            errors: e?.errors,
          },
          { status: e?.status || 502 }
        );
      }
    } else if (Object.prototype.hasOwnProperty.call(body, 'bukti_pembayaran_url')) {
      updateData.bukti_pembayaran_url = isNullLike(body.bukti_pembayaran_url) ? null : String(body.bukti_pembayaran_url).trim();
    }

    // items replace (optional)
    let itemsInput;
    let itemsProvided = false;
    try {
      itemsInput = parseItemsInput(body);
      itemsProvided = itemsInput !== undefined;
    } catch (err) {
      return NextResponse.json({ ok: false, message: err?.message || 'Items tidak valid.' }, { status: err?.status || 400 });
    }

    // approvals (optional)
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
      if (Object.keys(updateData).length) {
        await tx.pocketMoney.update({ where: { id_pocket_money: id }, data: updateData });
      }

      if (itemsProvided) {
        await tx.pocketMoneyItem.deleteMany({ where: { id_pocket_money: id } });
        const items = Array.isArray(itemsInput) ? itemsInput : [];
        if (items.length) {
          await tx.pocketMoneyItem.createMany({
            data: items.map((it) => ({
              id_pocket_money: id,
              nama_item_pocket_money: it.nama_item_pocket_money,
              harga: it.harga,
            })),
          });
        }

        // total recalculation: explicit total_pengeluaran jika ada, else sum items
        const totalExplicit = Object.prototype.hasOwnProperty.call(body, 'total_pengeluaran') ? normalizeMoney(body.total_pengeluaran, 'total_pengeluaran') : null;

        const totalFromItems = items.reduce((sum, it) => sum + Number.parseFloat(String(it.harga)), 0).toFixed(2);
        const totalRecalc = totalExplicit ?? totalFromItems;

        await tx.pocketMoney.update({ where: { id_pocket_money: id }, data: { total_pengeluaran: totalRecalc } });
      } else if (Object.prototype.hasOwnProperty.call(body, 'total_pengeluaran')) {
        const total = normalizeMoney(body.total_pengeluaran, 'total_pengeluaran');
        if (total === null) {
          return NextResponse.json({ ok: false, message: "Field 'total_pengeluaran' wajib berupa angka jika disupply." }, { status: 400 });
        }
        await tx.pocketMoney.update({ where: { id_pocket_money: id }, data: { total_pengeluaran: total } });
      }

      if (approvalsInput !== undefined) {
        await syncApprovalRecords(tx, id, approvalsInput);
      }

      return tx.pocketMoney.findUnique({ where: { id_pocket_money: id }, include: pocketMoneyInclude });
    });

    return NextResponse.json({ ok: true, message: 'Pocket money berhasil diperbarui.', data: updated, upload: uploadMeta });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    console.error('UPDATE /mobile/pocket-money/[id] error:', err);
    return NextResponse.json({ ok: false, message: err?.message || 'Gagal memperbarui pocket money.' }, { status: err?.status || 500 });
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

    const existing = await db.pocketMoney.findUnique({
      where: { id_pocket_money: id },
      select: { id_pocket_money: true, id_departement: true, status: true },
    });
    if (!existing) return NextResponse.json({ ok: false, message: 'Pocket money tidak ditemukan.' }, { status: 404 });

    const canDelete = isAdminRole(actorRole) || (actor.id_departement && String(existing.id_departement) === String(actor.id_departement));
    if (!canDelete) {
      return NextResponse.json({ ok: false, message: 'Forbidden.' }, { status: 403 });
    }

    if (existing.status !== 'pending' && !isSuperAdmin(actorRole)) {
      return NextResponse.json({ ok: false, message: 'Pocket money sudah diproses dan tidak dapat dihapus.' }, { status: 409 });
    }

    await db.pocketMoney.delete({ where: { id_pocket_money: id } });

    return NextResponse.json({ ok: true, message: 'Pocket money berhasil dihapus.' });
  } catch (err) {
    console.error('DELETE /mobile/pocket-money/[id] error:', err);
    return NextResponse.json({ ok: false, message: 'Gagal menghapus pocket money.' }, { status: 500 });
  }
}
