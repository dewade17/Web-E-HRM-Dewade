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
import { sendPocketMoneyEmailNotifications } from './_utils/emailNotifications';

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

/** ✅ UPDATED: include user agar FE dapat nama/foto */
export const pocketMoneyInclude = {
  user: {
    select: {
      id_user: true,
      nama_pengguna: true,
      email: true,
      role: true,
      foto_profil_user: true,
    },
  },
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
  items: {
    where: { deleted_at: null },
    orderBy: { created_at: 'asc' },
    select: {
      id_pocket_money_item: true,
      nama_item_pocket_money: true,
      harga: true,
    },
  },
  approvals: {
    where: { deleted_at: null },
    orderBy: { level: 'asc' },
    select: {
      id_approval_pocket_money: true,
      id_pocket_money: true,
      level: true,
      approver_user_id: true,
      approver_role: true,
      decision: true,
      decided_at: true,
      note: true,
      bukti_approval_pocket_money_url: true,
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
      db.pocketMoney.count({ where }),
      db.pocketMoney.findMany({
        where,
        include: pocketMoneyInclude,
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
    console.error('GET /mobile/pocket-money error:', err);
    return NextResponse.json({ ok: false, message: 'Gagal mengambil data pocket money.' }, { status: 500 });
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

    // items
    let itemsInput;
    try {
      itemsInput = parseItemsInput(body);
    } catch (err) {
      return NextResponse.json({ ok: false, message: err?.message || 'Items tidak valid.' }, { status: err?.status || 400 });
    }
    const items = Array.isArray(itemsInput) ? itemsInput : [];
    const totalFromItems = items.reduce((sum, it) => sum + Number.parseFloat(String(it.harga)), 0).toFixed(2);

    // total (optional, default sum items)
    const total_pengeluaran = normalizeMoney(body.total_pengeluaran, 'total_pengeluaran') ?? totalFromItems;

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
            message: 'Gagal upload bukti pembayaran.',
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
      const pocketMoney = await tx.pocketMoney.create({
        data: {
          id_user: actor.id_user,
          id_departement,
          id_kategori_keperluan,
          tanggal,
          keterangan,
          total_pengeluaran,
          metode_pembayaran,
          nomor_rekening: !isNullLike(body.nomor_rekening) ? String(body.nomor_rekening).trim() : null,
          nama_pemilik_rekening: !isNullLike(body.nama_pemilik_rekening) ? String(body.nama_pemilik_rekening).trim() : null,
          jenis_bank: !isNullLike(body.jenis_bank) ? String(body.jenis_bank).trim() : null,
          bukti_pembayaran_url: buktiUrl,
          status: 'pending',
          current_level: null,
        },
        select: { id_pocket_money: true },
      });

      if (items.length) {
        await tx.pocketMoneyItem.createMany({
          data: items.map((it) => ({
            id_pocket_money: pocketMoney.id_pocket_money,
            nama_item_pocket_money: it.nama_item_pocket_money,
            harga: it.harga,
          })),
        });
      }

      if (approvalsInput !== undefined) {
        await syncApprovalRecords(tx, pocketMoney.id_pocket_money, approvalsInput);
      }

      return pocketMoney;
    });

    const full = await db.pocketMoney.findUnique({
      where: { id_pocket_money: created.id_pocket_money },
      include: pocketMoneyInclude,
    });

    // Notifikasi
    const notified = new Set();
    const notifPromises = [];
    const basePayload = {
      id_departement: departement.id_departement,
      id_user: actor.id_user,
      tanggal: tanggal.toISOString().slice(0, 10),
      total_pengeluaran,
      metode_pembayaran,
      related_table: 'pocket_money',
      related_id: created.id_pocket_money,
      deeplink: '/pocket-money',
    };

    if (departement.id_supervisor && !notified.has(departement.id_supervisor)) {
      notified.add(departement.id_supervisor);
      notifPromises.push(sendNotification('POCKET_MONEY_CREATED', departement.id_supervisor, basePayload));
    }

    if (Array.isArray(full?.approvals)) {
      for (const ap of full.approvals) {
        const uid = ap?.approver_user_id;
        if (uid && !notified.has(uid)) {
          notified.add(uid);
          notifPromises.push(sendNotification('POCKET_MONEY_APPROVAL_REQUESTED', uid, basePayload));
        }
      }
    }

    if (!notified.has(actorId)) {
      notified.add(actorId);
      notifPromises.push(sendNotification('POCKET_MONEY_CREATED', actorId, basePayload));
    }

    Promise.allSettled(notifPromises).catch(() => {});
    if (full) {
      try {
        await sendPocketMoneyEmailNotifications(req, full);
      } catch (emailErr) {
        console.warn('POST /mobile/pocket-money: email notification failed:', emailErr?.message || emailErr);
      }
    }

    return NextResponse.json({ ok: true, message: 'Pocket money berhasil dibuat.', data: full, upload: uploadMeta }, { status: 201 });
  } catch (err) {
    console.error('POST /mobile/pocket-money error:', err);
    return NextResponse.json({ ok: false, message: err?.message || 'Gagal membuat pocket money.' }, { status: err?.status || 500 });
  }
}
