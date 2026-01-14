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
import { sendReimburseEmailNotifications } from './_utils/emailNotifications';

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
  const raw = body?.items ?? body?.reimburse_items ?? body?.detail_items ?? body?.detail;
  if (raw === undefined) return undefined; // tidak disupply
  let arr = raw;
  if (typeof arr === 'string') {
    const trimmed = arr.trim();
    if (!trimmed) return [];
    try {
      arr = JSON.parse(trimmed);
    } catch (_) {
      // fallback: single line not supported
    }
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
//export sync
function sumItemsMoney(items) {
  if (!Array.isArray(items) || !items.length) return '0.00';
  const total = items.reduce((acc, it) => acc + Number.parseFloat(it.harga), 0);
  return (Number.isFinite(total) ? total : 0).toFixed(2);
}

export const reimburseInclude = {
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
      id_reimburse_item: true,
      nama_item_reimburse: true,
      harga: true,
    },
  },
  approvals: {
    where: { deleted_at: null },
    orderBy: { level: 'asc' },
    select: {
      id_approval_reimburse: true,
      id_reimburse: true,
      level: true,
      approver_user_id: true,
      approver_role: true,
      decision: true,
      decided_at: true,
      note: true,
      bukti_approval_reimburse_url: true,
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

//fallback
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

    if (tanggalFrom && !isNullLike(tanggalFrom)) {
      const parsed = parseDateOnlyToUTC(tanggalFrom);
      if (!parsed) return NextResponse.json({ ok: false, message: 'tanggal_from tidak valid.' }, { status: 400 });
      where.tanggal = { ...(where.tanggal || {}), gte: parsed };
    }
    if (tanggalTo && !isNullLike(tanggalTo)) {
      const parsed = parseDateOnlyToUTC(tanggalTo);
      if (!parsed) return NextResponse.json({ ok: false, message: 'tanggal_to tidak valid.' }, { status: 400 });
      where.tanggal = { ...(where.tanggal || {}), lte: parsed };
    }

    const [total, rows] = await Promise.all([
      db.reimburse.count({ where }),
      db.reimburse.findMany({
        where,
        include: reimburseInclude,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
    ]);

    return NextResponse.json({
      ok: true,
      data: rows,
      meta: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
      },
    });
  } catch (err) {
    console.error('GET /mobile/reimburse error:', err);
    return NextResponse.json({ ok: false, message: 'Gagal mengambil data reimburse.' }, { status: 500 });
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

    const id_departement_input = !isNullLike(body.id_departement) ? String(body.id_departement).trim() : null;
    const id_departement = isAdminRole(actorRole) && id_departement_input ? id_departement_input : actor.id_departement;

    if (!id_departement) {
      return NextResponse.json({ ok: false, message: "Field 'id_departement' wajib diisi (atau akun harus punya departement)." }, { status: 400 });
    }

    const departement = await db.departement.findFirst({
      where: { id_departement, deleted_at: null },
      select: { id_departement: true, nama_departement: true, id_supervisor: true },
    });
    if (!departement) return NextResponse.json({ ok: false, message: 'Departement tidak ditemukan.' }, { status: 404 });

    const id_kategori_keperluan = !isNullLike(body.id_kategori_keperluan) ? String(body.id_kategori_keperluan).trim() : null;
    if (id_kategori_keperluan) {
      const kategori = await db.kategoriKeperluan.findFirst({
        where: { id_kategori_keperluan, deleted_at: null },
        select: { id_kategori_keperluan: true },
      });
      if (!kategori) return NextResponse.json({ ok: false, message: 'Kategori keperluan tidak ditemukan.' }, { status: 404 });
    }

    const tanggal = parseDateOnlyToUTC(body.tanggal);
    if (!tanggal) return NextResponse.json({ ok: false, message: "Field 'tanggal' wajib diisi dan harus valid (YYYY-MM-DD)." }, { status: 400 });

    const metode_pembayaran = String(body.metode_pembayaran || '').trim();
    if (!metode_pembayaran) return NextResponse.json({ ok: false, message: "Field 'metode_pembayaran' wajib diisi." }, { status: 400 });

    const keterangan = !isNullLike(body.keterangan) ? String(body.keterangan) : null;

    const itemsInput = parseItemsInput(body);
    if (itemsInput !== undefined && itemsInput.length === 0) {
      return NextResponse.json({ ok: false, message: 'items tidak boleh kosong jika disupply.' }, { status: 400 });
    }

    const items = itemsInput && itemsInput.length ? itemsInput : [];
    const totalFromItems = sumItemsMoney(items);
    const total_pengeluaran = normalizeMoney(body.total_pengeluaran, 'total_pengeluaran') ?? totalFromItems;

    let buktiUrl = null;
    let uploadMeta = null;

    const buktiFile = findFileInBody(body, ['bukti_pembayaran', 'bukti', 'bukti_pembayaran_url', 'bukti_url']);
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
            message: 'Gagal mengunggah bukti pembayaran.',
            detail: e?.message || String(e),
            errors: e?.errors,
          },
          { status: e?.status || 502 }
        );
      }
    } else if (!isNullLike(body.bukti_pembayaran_url)) {
      buktiUrl = String(body.bukti_pembayaran_url).trim() || null;
    }

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
      const reimburse = await tx.reimburse.create({
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
        select: { id_reimburse: true },
      });

      if (items.length) {
        await tx.reimburseItem.createMany({
          data: items.map((it) => ({
            id_reimburse: reimburse.id_reimburse,
            nama_item_reimburse: it.nama_item_reimburse,
            harga: it.harga,
          })),
          skipDuplicates: false,
        });
      }

      if (approvalsInput !== undefined) {
        await syncApprovalRecords(tx, reimburse.id_reimburse, approvalsInput);
      }

      return tx.reimburse.findUnique({
        where: { id_reimburse: reimburse.id_reimburse },
        include: reimburseInclude,
      });
    });

    try {
      await sendReimburseEmailNotifications(req, created);
    } catch (emailErr) {
      console.warn('POST /mobile/reimburse: email notification failed:', emailErr?.message || emailErr);
    }

    // Notifikasi: konfirmasi ke pembuat + ke approver_user_id jika ada
    const notified = new Set();
    const notifPromises = [];

    const basePayload = {
      nama_departement: departement.nama_departement || '-',
      id_departement: departement.id_departement,
      id_user: actor.id_user,
      tanggal: tanggal.toISOString().slice(0, 10),
      total_pengeluaran,
      metode_pembayaran,
      related_table: 'reimburse',
      related_id: created?.id_reimburse,
      deeplink: '/reimburse',
    };

    if (!notified.has(actorId)) {
      notifPromises.push(
        sendNotification(
          'REIMBURSE_CREATED',
          actorId,
          {
            ...basePayload,
            overrideTitle: 'Reimburse berhasil dibuat',
            overrideBody: `Reimburse untuk departement ${basePayload.nama_departement} pada ${basePayload.tanggal} telah dibuat.`,
          },
          { deeplink: '/reimburse' }
        )
      );
      notified.add(actorId);
    }

    if (Array.isArray(created?.approvals) && created.approvals.length) {
      const approverIds = created.approvals.map((a) => a.approver_user_id).filter(Boolean);
      for (const id of approverIds) {
        if (notified.has(id) || id === actorId) continue;
        notifPromises.push(
          sendNotification(
            'REIMBURSE_APPROVAL_REQUESTED',
            id,
            {
              ...basePayload,
              is_approver: true,
              overrideTitle: 'Permintaan approval reimburse',
              overrideBody: `Ada reimburse baru dari departement ${basePayload.nama_departement} pada ${basePayload.tanggal} yang membutuhkan approval Anda.`,
            },
            { deeplink: '/reimburse' }
          )
        );
        notified.add(id);
      }
    }

    if (notifPromises.length) await Promise.allSettled(notifPromises);

    return NextResponse.json({
      ok: true,
      message: 'Reimburse berhasil dibuat.',
      data: created,
      upload: uploadMeta,
    });
  } catch (err) {
    console.error('POST /mobile/reimburse error:', err);
    return NextResponse.json({ ok: false, message: err?.message || 'Gagal membuat reimburse.' }, { status: err?.status || 500 });
  }
}
