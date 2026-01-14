export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { parseDateOnlyToUTC } from '@/helpers/date-helper';
import { uploadMediaWithFallback } from '@/app/api/_utils/uploadWithFallback';
import { parseRequestBody, findFileInBody } from '@/app/api/_utils/requestBody';
import { parseApprovalsFromBody, ensureApprovalUsersExist, syncApprovalRecords } from './_utils/approvals';
import { sendNotification } from '@/app/utils/services/notificationService';
import { sendPaymentEmailNotifications } from './_utils/emailNotifications';

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

export const paymentInclude = {
  departement: {
    select: { id_departement: true, nama_departement: true },
  },
  kategori_keperluan: {
    select: { id_kategori_keperluan: true, nama_keperluan: true },
  },
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
      id_approval_payment: true,
      id_payment: true,
      level: true,
      approver_user_id: true,
      approver_role: true,
      decision: true,
      decided_at: true,
      note: true,
      bukti_approval_payment_url: true,
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
};

export async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const payload = verifyAuthToken(auth.slice(7).trim());
      const id = payload?.sub || payload?.id_user || payload?.userId || payload?.id;
      if (id) {
        return {
          actor: {
            id,
            role: payload?.role,
            email: payload?.email,
          },
        };
      }
    } catch (_) {}
  }

  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;

  const actorId = sessionOrRes?.user?.id || sessionOrRes?.user?.id_user;
  if (!actorId) {
    return NextResponse.json({ ok: false, message: 'Unauthorized.' }, { status: 401 });
  }

  return {
    actor: {
      id: actorId,
      role: sessionOrRes.user?.role,
      email: sessionOrRes.user?.email,
    },
    session: sessionOrRes,
  };
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

/* ============================ GET (List) ============================ */
export async function GET(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  const actorRole = normalizeRole(auth.actor?.role);
  if (!actorId) return NextResponse.json({ ok: false, message: 'Unauthorized.' }, { status: 401 });

  try {
    const actor = await getActorUser(actorId);
    if (!actor || actor.deleted_at) return NextResponse.json({ ok: false, message: 'User tidak ditemukan.' }, { status: 404 });

    const { searchParams } = new URL(req.url);
    const rawPage = Number.parseInt(searchParams.get('page') || '1', 10);
    const page = Number.isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;

    const perPageRaw = Number.parseInt(searchParams.get('perPage') || searchParams.get('pageSize') || '20', 10);
    const perPageBase = Number.isNaN(perPageRaw) || perPageRaw < 1 ? 20 : perPageRaw;
    const perPage = Math.min(Math.max(perPageBase, 1), 100);

    const status = searchParams.get('status');
    const idDepartementParam = searchParams.get('id_departement') || searchParams.get('departement_id');
    const idUserParam = searchParams.get('id_user');
    const q = searchParams.get('q') || searchParams.get('search');

    const allParam = String(searchParams.get('all') || '')
      .trim()
      .toLowerCase();
    const wantAll = allParam === '1' || allParam === 'true' || allParam === 'yes';

    const where = { deleted_at: null };

    if (status && ['pending', 'disetujui', 'ditolak'].includes(status)) {
      where.status = status;
    }

    if (isAdminRole(actorRole)) {
      if (!wantAll) {
        if (idUserParam && String(idUserParam).trim()) {
          where.id_user = String(idUserParam).trim();
        } else if (idDepartementParam && String(idDepartementParam).trim()) {
          where.id_departement = String(idDepartementParam).trim();
        }
      }
    } else {
      where.id_user = actor.id_user;
    }

    const tanggalFrom = searchParams.get('tanggal_from') || searchParams.get('from');
    const tanggalTo = searchParams.get('tanggal_to') || searchParams.get('to');

    if (tanggalFrom) {
      const fromDate = parseDateOnlyToUTC(String(tanggalFrom));
      if (!fromDate) return NextResponse.json({ ok: false, message: 'tanggal_from tidak valid (format: YYYY-MM-DD).' }, { status: 400 });
      where.tanggal = { ...(where.tanggal || {}), gte: fromDate };
    }
    if (tanggalTo) {
      const toDate = parseDateOnlyToUTC(String(tanggalTo));
      if (!toDate) return NextResponse.json({ ok: false, message: 'tanggal_to tidak valid (format: YYYY-MM-DD).' }, { status: 400 });
      where.tanggal = { ...(where.tanggal || {}), lte: toDate };
    }

    if (q && String(q).trim()) {
      const query = String(q).trim();
      where.OR = [{ keterangan: { contains: query } }];
    }

    const [total, rows] = await Promise.all([
      db.payment.count({ where }),
      db.payment.findMany({
        where,
        include: paymentInclude,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
    ]);

    return NextResponse.json({
      ok: true,
      data: rows,
      meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
    });
  } catch (err) {
    console.error('GET /mobile/payment error:', err);
    return NextResponse.json({ ok: false, message: 'Gagal mengambil data payment.' }, { status: 500 });
  }
}

/* ============================ POST (Create) ============================ */
export async function POST(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  const actorRole = normalizeRole(auth.actor?.role);
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

    // departement
    let id_departement = null;
    if (isAdminRole(actorRole) && !isNullLike(body.id_departement)) {
      id_departement = String(body.id_departement).trim();
    } else {
      id_departement = actor.id_departement;
    }
    if (!id_departement) return NextResponse.json({ ok: false, message: 'id_departement wajib diisi.' }, { status: 400 });

    const departement = await db.departement.findFirst({
      where: { id_departement, deleted_at: null },
      select: { id_departement: true, nama_departement: true, id_supervisor: true },
    });
    if (!departement) return NextResponse.json({ ok: false, message: 'Departement tidak ditemukan.' }, { status: 404 });

    // kategori
    const id_kategori_keperluan = !isNullLike(body.id_kategori_keperluan) ? String(body.id_kategori_keperluan).trim() : null;
    if (id_kategori_keperluan) {
      const kategori = await db.kategoriKeperluan.findFirst({
        where: { id_kategori_keperluan, deleted_at: null },
        select: { id_kategori_keperluan: true },
      });
      if (!kategori) return NextResponse.json({ ok: false, message: 'Kategori keperluan tidak ditemukan.' }, { status: 404 });
    }

    // tanggal
    const tanggalRaw = body.tanggal || body.date;
    const tanggal = parseDateOnlyToUTC(String(tanggalRaw || ''));
    if (!tanggal) return NextResponse.json({ ok: false, message: 'tanggal wajib diisi (format: YYYY-MM-DD).' }, { status: 400 });

    const keterangan = !isNullLike(body.keterangan) ? String(body.keterangan).trim() : null;

    // nominal & metode
    const nominal_pembayaran = normalizeMoney(body.nominal_pembayaran ?? body.nominal, 'nominal_pembayaran');
    if (nominal_pembayaran === null) {
      return NextResponse.json({ ok: false, message: 'nominal_pembayaran wajib diisi.' }, { status: 400 });
    }

    const metode_pembayaran = String(body.metode_pembayaran || body.metode || '').trim();
    if (!metode_pembayaran) return NextResponse.json({ ok: false, message: 'metode_pembayaran wajib diisi.' }, { status: 400 });

    // upload bukti
    let buktiUrl = null;
    let uploadMeta = null;
    const buktiFile = findFileInBody(body, ['bukti_pembayaran', 'bukti', 'file', 'bukti_pembayaran_file']);
    if (buktiFile) {
      try {
        const uploaded = await uploadMediaWithFallback(buktiFile, {
          storageFolder: 'financial',
          supabasePrefix: 'financial',
          pathSegments: [String(actor.id_user)],
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
    } else if (!isNullLike(body.bukti_pembayaran_url)) {
      buktiUrl = String(body.bukti_pembayaran_url).trim() || null;
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

    const created = await db.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          id_user: actor.id_user,
          id_departement,
          id_kategori_keperluan,
          tanggal,
          keterangan,
          nominal_pembayaran,
          metode_pembayaran,
          nomor_rekening: !isNullLike(body.nomor_rekening) ? String(body.nomor_rekening).trim() : null,
          nama_pemilik_rekening: !isNullLike(body.nama_pemilik_rekening) ? String(body.nama_pemilik_rekening).trim() : null,
          jenis_bank: !isNullLike(body.jenis_bank) ? String(body.jenis_bank).trim() : null,
          bukti_pembayaran_url: buktiUrl,
          status: 'pending',
          current_level: null,
        },
        select: { id_payment: true },
      });

      if (approvalsInput !== undefined) {
        await syncApprovalRecords(tx, payment.id_payment, approvalsInput);
      }

      return payment;
    });

    const full = await db.payment.findUnique({
      where: { id_payment: created.id_payment },
      include: paymentInclude,
    });
    if (full) {
      try {
        await sendPaymentEmailNotifications(req, full);
      } catch (emailErr) {
        console.warn('POST /mobile/payment: email notification failed:', emailErr?.message || emailErr);
      }
    }

    // Notifikasi: supervisor departement + approver(s) + actor
    const notified = new Set();
    const notifPromises = [];
    const basePayload = {
      id_departement: departement.id_departement,
      tanggal: tanggal.toISOString().slice(0, 10),
      nominal_pembayaran,
      metode_pembayaran,
      related_table: 'payment',
      related_id: created.id_payment,
      deeplink: '/payment',
    };

    if (departement.id_supervisor && !notified.has(departement.id_supervisor)) {
      notified.add(departement.id_supervisor);
      notifPromises.push(sendNotification('PAYMENT_CREATED', departement.id_supervisor, basePayload));
    }

    if (Array.isArray(full?.approvals)) {
      for (const ap of full.approvals) {
        const uid = ap?.approver_user_id;
        if (uid && !notified.has(uid)) {
          notified.add(uid);
          notifPromises.push(sendNotification('PAYMENT_APPROVAL_REQUESTED', uid, basePayload));
        }
      }
    }

    if (!notified.has(actorId)) {
      notified.add(actorId);
      notifPromises.push(sendNotification('PAYMENT_CREATED', actorId, basePayload));
    }

    Promise.allSettled(notifPromises).catch(() => {});

    return NextResponse.json({ ok: true, message: 'Payment berhasil dibuat.', data: full, upload: uploadMeta }, { status: 201 });
  } catch (err) {
    console.error('POST /mobile/payment error:', err);
    return NextResponse.json({ ok: false, message: err?.message || 'Gagal membuat payment.' }, { status: err?.status || 500 });
  }
}
