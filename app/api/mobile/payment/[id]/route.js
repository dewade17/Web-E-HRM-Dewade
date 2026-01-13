export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { ensureAuth, paymentInclude } from '../route';
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

async function getPaymentOr404(id_payment) {
  if (!id_payment) return null;
  return db.payment.findUnique({
    where: { id_payment },
    include: paymentInclude,
  });
}

function canAccessPayment(actor, payment) {
  if (!actor || !payment) return false;
  const actorRole = normalizeRole(actor.role);
  if (isAdminRole(actorRole)) return true;
  if (!actor.id_departement) return false;
  return String(payment.id_departement) === String(actor.id_departement);
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

    const payment = await getPaymentOr404(id);
    if (!payment || payment.deleted_at) return NextResponse.json({ ok: false, message: 'Payment tidak ditemukan.' }, { status: 404 });

    if (!canAccessPayment(actor, payment)) {
      return NextResponse.json({ ok: false, message: 'Forbidden.' }, { status: 403 });
    }

    return NextResponse.json({ ok: true, data: payment });
  } catch (err) {
    console.error('GET /mobile/payment/[id] error:', err);
    return NextResponse.json({ ok: false, message: 'Gagal mengambil detail payment.' }, { status: 500 });
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

    const existing = await getPaymentOr404(id);
    if (!existing) return NextResponse.json({ ok: false, message: 'Payment tidak ditemukan.' }, { status: 404 });

    if (!canAccessPayment(actor, existing)) {
      return NextResponse.json({ ok: false, message: 'Forbidden.' }, { status: 403 });
    }

    // default: hanya pending yang bisa diedit. super admin boleh bypass.
    if (existing.status !== 'pending' && !isSuperAdmin(actorRole)) {
      return NextResponse.json({ ok: false, message: 'Payment sudah diproses dan tidak dapat diubah.' }, { status: 409 });
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

    if (Object.prototype.hasOwnProperty.call(body, 'nominal_pembayaran') || Object.prototype.hasOwnProperty.call(body, 'nominal')) {
      const nominal = normalizeMoney(body.nominal_pembayaran ?? body.nominal, 'nominal_pembayaran');
      if (nominal === null) return NextResponse.json({ ok: false, message: 'nominal_pembayaran wajib berupa angka jika disupply.' }, { status: 400 });
      updateData.nominal_pembayaran = nominal;
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
            message: 'Ga...mbayaran.',
            detail: e?.message || String(e),
            errors: e?.errors,
          },
          { status: e?.status || 502 }
        );
      }
      updateData.bukti_pembayaran_url = buktiUrl;
    } else if (Object.prototype.hasOwnProperty.call(body, 'bukti_pembayaran_url')) {
      updateData.bukti_pembayaran_url = isNullLike(body.bukti_pembayaran_url) ? null : String(body.bukti_pembayaran_url).trim();
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
        await tx.payment.update({ where: { id_payment: id }, data: updateData });
      }

      if (approvalsInput !== undefined) {
        await syncApprovalRecords(tx, id, approvalsInput);
      }

      return tx.payment.findUnique({ where: { id_payment: id }, include: paymentInclude });
    });

    return NextResponse.json({ ok: true, message: 'Payment berhasil diperbarui.', data: updated, upload: uploadMeta });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    console.error('UPDATE /mobile/payment/[id] error:', err);
    return NextResponse.json({ ok: false, message: err?.message || 'Gagal memperbarui payment.' }, { status: err?.status || 500 });
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

    const existing = await db.payment.findUnique({ where: { id_payment: id }, select: { id_payment: true, id_departement: true, status: true } });
    if (!existing) return NextResponse.json({ ok: false, message: 'Payment tidak ditemukan.' }, { status: 404 });

    const canDelete = isAdminRole(actorRole) || (actor.id_departement && String(existing.id_departement) === String(actor.id_departement));
    if (!canDelete) {
      return NextResponse.json({ ok: false, message: 'Forbidden.' }, { status: 403 });
    }

    if (existing.status !== 'pending' && !isSuperAdmin(actorRole)) {
      return NextResponse.json({ ok: false, message: 'Payment sudah diproses dan tidak dapat dihapus.' }, { status: 409 });
    }

    await db.payment.delete({ where: { id_payment: id } });

    return NextResponse.json({ ok: true, message: 'Payment berhasil dihapus.' });
  } catch (err) {
    console.error('DELETE /mobile/payment/[id] error:', err);
    return NextResponse.json({ ok: false, message: 'Gagal menghapus payment.' }, { status: 500 });
  }
}
