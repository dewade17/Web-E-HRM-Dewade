export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { parseDateOnlyToUTC } from '@/helpers/date-helper';
import { sendNotification } from '@/app/utils/services/notificationService';
import storageClient from '@/app/api/_utils/storageClient';
import { parseRequestBody, findFileInBody } from '@/app/api/_utils/requestBody';
import { parseApprovalsFromBody, ensureApprovalUsersExist, syncApprovalRecords } from './_utils/approvals';

const APPROVE_STATUSES = new Set(['disetujui', 'ditolak', 'pending']);
const ADMIN_ROLES = new Set(['HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN', 'SUBADMIN', 'SUPERVISI']);

/**
 * Relasi yang di-include.
 */
export const pengajuanInclude = {
  user: {
    select: {
      id_user: true,
      nama_pengguna: true,
      email: true,
      role: true,
    },
  },
  kategori_cuti: {
    select: {
      id_kategori_cuti: true,
      nama_kategori: true,
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
        },
      },
    },
  },
  approvals: {
    where: { deleted_at: null },
    orderBy: { level: 'asc' },
    select: {
      id_approval_pengajuan_cuti: true,
      level: true,
      approver_user_id: true,
      approver_role: true,
      decision: true,
      decided_at: true,
      note: true,
    },
  },
  // daftar tanggal cuti
  tanggal_list: {
    select: {
      tanggal_cuti: true,
    },
    orderBy: { tanggal_cuti: 'asc' },
  },
};

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

function formatDateISO(value) {
  if (!value) return '-';
  try {
    const asDate = new Date(value);
    if (Number.isNaN(asDate.getTime())) return '-';
    return asDate.toISOString().split('T')[0];
  } catch (_) {
    return '-';
  }
}

function formatDateDisplay(value) {
  if (!value) return '-';
  try {
    const asDate = new Date(value);
    if (Number.isNaN(asDate.getTime())) return '-';
    return dateDisplayFormatter.format(asDate);
  } catch (_) {
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
        return {
          actor: {
            id,
            role: payload?.role,
            source: 'bearer',
          },
        };
      }
    } catch (_) {
      /* fallback ke NextAuth */
    }
  }

  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;

  const id = sessionOrRes?.user?.id || sessionOrRes?.user?.id_user;
  if (!id) {
    return NextResponse.json({ ok: false, message: 'Unauthorized.' }, { status: 401 });
  }

  return {
    actor: {
      id,
      role: sessionOrRes?.user?.role,
      source: 'session',
    },
  };
}

/**
 * Normalisasi status: tidak ada lagi 'menunggu' (legacy dihapus).
 */
export function normalizeStatus(value) {
  if (!value) return null;
  const raw = String(value).trim().toLowerCase();
  return APPROVE_STATUSES.has(raw) ? raw : null;
}

export function parseDateQuery(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return parseDateOnlyToUTC(trimmed);
}

export function sanitizeHandoverIds(ids) {
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

function resolveJenisPengajuan(input, expected) {
  const fallback = expected;
  if (input === undefined || input === null) return { ok: true, value: fallback };

  const trimmed = String(input).trim();
  if (!trimmed) return { ok: true, value: fallback };

  const normalized = trimmed.toLowerCase().replace(/[-\s]+/g, '_');
  if (normalized !== expected) {
    return {
      ok: false,
      message: `jenis_pengajuan harus bernilai '${expected}'.`,
    };
  }
  return { ok: true, value: fallback };
}

/* ============================ GET (List) ============================ */
export async function GET(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;
  const actorRole = auth.actor?.role;
  const actorId = auth.actor?.id;
  if (!actorId) return NextResponse.json({ ok: false, message: 'Unauthorized.' }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);

    const rawPage = parseInt(searchParams.get('page') || '1', 10);
    const page = Number.isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
    const perPageRaw = parseInt(searchParams.get('perPage') || searchParams.get('pageSize') || '20', 10);
    const perPageBase = Number.isNaN(perPageRaw) || perPageRaw < 1 ? 20 : perPageRaw;
    const perPage = Math.min(Math.max(perPageBase, 1), 100);

    const statusParam = searchParams.get('status');
    const status = normalizeStatus(statusParam);
    if (statusParam && !status) {
      return NextResponse.json({ ok: false, message: 'Parameter status tidak valid.' }, { status: 400 });
    }

    const kategoriId = (searchParams.get('id_kategori_cuti') || '').trim();

    // Parameter tanggal (rename: tanggal_mulai* -> tanggal_cuti*)
    const tanggalCutiEqParam = searchParams.get('tanggal_cuti') ?? searchParams.get('tanggal_mulai');
    const tanggalCutiFromParam = searchParams.get('tanggal_cuti_from') ?? searchParams.get('tanggal_mulai_from');
    const tanggalCutiToParam = searchParams.get('tanggal_cuti_to') ?? searchParams.get('tanggal_mulai_to');

    // Filter field tunggal 'tanggal_masuk_kerja'
    const tanggalMasukEqParam = searchParams.get('tanggal_masuk_kerja');
    const tanggalMasukFromParam = searchParams.get('tanggal_masuk_kerja_from');
    const tanggalMasukToParam = searchParams.get('tanggal_masuk_kerja_to');

    const targetUserParam = searchParams.get('id_user');
    const targetUserFilter = targetUserParam ? String(targetUserParam).trim() : '';

    const where = { deleted_at: null, jenis_pengajuan: 'cuti' };

    if (!canManageAll(actorRole)) {
      where.id_user = actorId;
    } else if (targetUserFilter) {
      where.id_user = targetUserFilter;
    }

    if (status) {
      // ❌ tak ada lagi 'menunggu'
      where.status = status; // 'pending' | 'disetujui' | 'ditolak'
    }

    if (kategoriId) where.id_kategori_cuti = kategoriId;

    // Filter tanggal_cuti via relasi tanggal_list
    if (tanggalCutiEqParam) {
      const parsed = parseDateQuery(tanggalCutiEqParam);
      if (!parsed) {
        return NextResponse.json({ ok: false, message: 'Parameter tanggal_cuti tidak valid.' }, { status: 400 });
      }
      where.tanggal_list = { some: { tanggal_cuti: parsed } };
    } else if (tanggalCutiFromParam || tanggalCutiToParam) {
      const gte = parseDateQuery(tanggalCutiFromParam);
      const lte = parseDateQuery(tanggalCutiToParam);
      if (tanggalCutiFromParam && !gte) {
        return NextResponse.json({ ok: false, message: 'Parameter tanggal_cuti_from tidak valid.' }, { status: 400 });
      }
      if (tanggalCutiToParam && !lte) {
        return NextResponse.json({ ok: false, message: 'Parameter tanggal_cuti_to tidak valid.' }, { status: 400 });
      }
      where.tanggal_list = {
        some: {
          tanggal_cuti: {
            ...(gte ? { gte } : {}),
            ...(lte ? { lte } : {}),
          },
        },
      };
    }

    // Filter 'tanggal_masuk_kerja'
    if (tanggalMasukEqParam) {
      const parsed = parseDateQuery(tanggalMasukEqParam);
      if (!parsed) {
        return NextResponse.json({ ok: false, message: 'Parameter tanggal_masuk_kerja tidak valid.' }, { status: 400 });
      }
      where.tanggal_masuk_kerja = parsed;
    } else if (tanggalMasukFromParam || tanggalMasukToParam) {
      const gteMasuk = parseDateQuery(tanggalMasukFromParam);
      const lteMasuk = parseDateQuery(tanggalMasukToParam);
      if (tanggalMasukFromParam && !gteMasuk) {
        return NextResponse.json({ ok: false, message: 'Parameter tanggal_masuk_kerja_from tidak valid.' }, { status: 400 });
      }
      if (tanggalMasukToParam && !lteMasuk) {
        return NextResponse.json({ ok: false, message: 'Parameter tanggal_masuk_kerja_to tidak valid.' }, { status: 400 });
      }
      where.tanggal_masuk_kerja = {
        ...(gteMasuk ? { gte: gteMasuk } : {}),
        ...(lteMasuk ? { lte: lteMasuk } : {}),
      };
    }

    const [total, rawItems] = await Promise.all([
      db.pengajuanCuti.count({ where }),
      db.pengajuanCuti.findMany({
        where,
        orderBy: [{ created_at: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
        include: pengajuanInclude,
      }),
    ]);

    // Transformasi: kirim tanggal_cuti (awal turunan), tanggal_selesai (akhir turunan)
    const items = rawItems.map((item) => {
      const dates = (item.tanggal_list || []).map((d) => (d?.tanggal_cuti instanceof Date ? d.tanggal_cuti : new Date(d.tanggal_cuti))).sort((a, b) => a.getTime() - b.getTime());

      const tanggal_cuti_derived = dates.length ? dates[0] : null;
      const tanggal_selesai_derived = dates.length ? dates[dates.length - 1] : null;

      const { tanggal_list: _unused, ...rest } = item;

      return {
        ...rest,
        tanggal_cuti: tanggal_cuti_derived,
        tanggal_selesai: tanggal_selesai_derived,
        tanggal_list: dates,
      };
    });

    return NextResponse.json({
      ok: true,
      data: items,
      meta: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
      },
    });
  } catch (err) {
    console.error('GET /mobile/pengajuan-cuti error:', err);
    return NextResponse.json({ ok: false, message: 'Gagal mengambil data pengajuan cuti.' }, { status: 500 });
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
    const id_kategori_cuti = String(body?.id_kategori_cuti || '').trim();

    // Input: tanggal_cuti[] (prefer) / legacy tanggal_mulai[]
    const tanggalCutiInput =
      body?.['tanggal_cuti[]'] ??
      body?.tanggal_cuti ??
      body?.['tanggal_mulai[]'] ?? // legacy
      body?.tanggal_mulai; // legacy

    const tanggalMasukInput = body?.tanggal_masuk_kerja;

    const keperluan = body?.keperluan === undefined || body?.keperluan === null ? null : String(body.keperluan);
    const handover = body?.handover === undefined || body?.handover === null ? null : String(body.handover);

    const jenisPengajuanResult = resolveJenisPengajuan(body?.jenis_pengajuan, 'cuti');
    if (!jenisPengajuanResult.ok) {
      return NextResponse.json({ ok: false, message: jenisPengajuanResult.message }, { status: 400 });
    }
    const jenis_pengajuan = jenisPengajuanResult.value;

    if (!id_kategori_cuti) {
      return NextResponse.json({ ok: false, message: 'id_kategori_cuti wajib diisi.' }, { status: 400 });
    }

    // tanggal_masuk_kerja harus single
    if (Array.isArray(tanggalMasukInput)) {
      return NextResponse.json({ ok: false, message: 'tanggal_masuk_kerja harus berupa satu tanggal, bukan array.' }, { status: 400 });
    }
    const tanggalMasukKerja = parseDateOnlyToUTC(tanggalMasukInput);
    if (!tanggalMasukKerja) {
      return NextResponse.json({ ok: false, message: 'tanggal_masuk_kerja tidak valid.' }, { status: 400 });
    }

    // tanggal_cuti[]
    const tanggalCutiArray = Array.isArray(tanggalCutiInput) ? tanggalCutiInput : [tanggalCutiInput];
    const parsedCutiDates = [];

    if (tanggalCutiArray.length === 0 || tanggalCutiArray[0] === undefined) {
      return NextResponse.json({ ok: false, message: 'tanggal_cuti wajib diisi.' }, { status: 400 });
    }

    for (const raw of tanggalCutiArray) {
      const tanggalCuti = parseDateOnlyToUTC(raw);
      if (!tanggalCuti) {
        return NextResponse.json({ ok: false, message: `Tanggal cuti '${raw}' tidak valid.` }, { status: 400 });
      }
      if (tanggalMasukKerja <= tanggalCuti) {
        return NextResponse.json({ ok: false, message: `Tanggal cuti '${raw}' harus sebelum tanggal_masuk_kerja.` }, { status: 400 });
      }
      parsedCutiDates.push(tanggalCuti);
    }

    const handoverIdsInput = body?.['handover_tag_user_ids[]'] ?? body?.handover_tag_user_ids;
    const handoverIds = sanitizeHandoverIds(handoverIdsInput);

    const kategori = await db.kategoriCuti.findFirst({
      where: { id_kategori_cuti, deleted_at: null },
      select: { id_kategori_cuti: true },
    });
    if (!kategori) {
      return NextResponse.json({ ok: false, message: 'Kategori cuti tidak ditemukan.' }, { status: 404 });
    }

    if (handoverIds && handoverIds.length) {
      const users = await db.user.findMany({
        where: { id_user: { in: handoverIds }, deleted_at: null },
        select: { id_user: true },
      });
      const foundIds = new Set(users.map((u) => u.id_user));
      const missing = handoverIds.filter((id) => !foundIds.has(id));
      if (missing.length) {
        return NextResponse.json({ ok: false, message: 'Beberapa handover_tag_user_ids tidak valid.' }, { status: 400 });
      }
    }

    let approvalsInput;
    try {
      approvalsInput = parseApprovalsFromBody(body);
    } catch (err) {
      const status = err?.status || 400;
      return NextResponse.json({ ok: false, message: err?.message || 'Data approvals tidak valid.' }, { status });
    }

    try {
      if (approvalsInput !== undefined) {
        await ensureApprovalUsersExist(db, approvalsInput);
      }
    } catch (err) {
      const status = err?.status || 400;
      return NextResponse.json({ ok: false, message: err?.message || 'Approver tidak valid.' }, { status });
    }

    let uploadMeta = null;
    let lampiranUrl = null;
    const lampiranFile = findFileInBody(body, ['lampiran_cuti', 'lampiran', 'lampiran_file', 'file']);
    if (lampiranFile) {
      try {
        const res = await storageClient.uploadBufferWithPresign(lampiranFile, { folder: 'pengajuan' });
        lampiranUrl = res.publicUrl || null;
        uploadMeta = { key: res.key, publicUrl: res.publicUrl, etag: res.etag, size: res.size };
      } catch (e) {
        return NextResponse.json({ ok: false, message: 'Gagal mengunggah lampiran.', detail: e?.message || String(e) }, { status: 502 });
      }
    }

    // Transaksi: create pengajuan + tanggal_list + approvals + handover
    const fullPengajuan = await db.$transaction(async (tx) => {
      const created = await tx.pengajuanCuti.create({
        data: {
          id_user: actorId,
          id_kategori_cuti,
          keperluan,
          tanggal_masuk_kerja: tanggalMasukKerja,
          handover,
          jenis_pengajuan,
          lampiran_cuti_url: lampiranUrl,
        },
      });

      if (parsedCutiDates.length) {
        await tx.pengajuanCutiTanggal.createMany({
          data: parsedCutiDates.map((tgl) => ({
            id_pengajuan_cuti: created.id_pengajuan_cuti,
            tanggal_cuti: tgl,
          })),
          skipDuplicates: true,
        });
      }

      if (approvalsInput !== undefined) {
        await syncApprovalRecords(tx, created.id_pengajuan_cuti, approvalsInput);
      }

      if (handoverIds && handoverIds.length) {
        await tx.handoverCuti.createMany({
          data: handoverIds.map((id_user_tagged) => ({
            id_pengajuan_cuti: created.id_pengajuan_cuti,
            id_user_tagged,
          })),
          skipDuplicates: true,
        });
      }

      return tx.pengajuanCuti.findUnique({
        where: { id_pengajuan_cuti: created.id_pengajuan_cuti },
        include: pengajuanInclude,
      });
    });

    // Notifikasi (pemohon & handover)
    if (fullPengajuan) {
      const deeplink = `/pengajuan-cuti/${fullPengajuan.id_pengajuan_cuti}`;

      const rawDates = (fullPengajuan.tanggal_list || []).map((d) => (d?.tanggal_cuti instanceof Date ? d.tanggal_cuti : new Date(d.tanggal_cuti))).sort((a, b) => a.getTime() - b.getTime());
      const tanggalCutiPertama = rawDates.length ? rawDates[0] : null;

      const basePayload = {
        nama_pemohon: fullPengajuan.user?.nama_pengguna || 'Rekan',
        kategori_cuti: fullPengajuan.kategori_cuti?.nama_kategori || '-',
        tanggal_cuti: formatDateISO(tanggalCutiPertama),
        tanggal_cuti_display: formatDateDisplay(tanggalCutiPertama),
        tanggal_masuk_kerja: formatDateISO(fullPengajuan.tanggal_masuk_kerja),
        tanggal_masuk_kerja_display: formatDateDisplay(fullPengajuan.tanggal_masuk_kerja),
        keperluan: fullPengajuan.keperluan || '-',
        handover: fullPengajuan.handover || '-',
        related_table: 'pengajuan_cuti',
        related_id: fullPengajuan.id_pengajuan_cuti,
        deeplink,
      };

      const notifiedUsers = new Set();
      const notifPromises = [];
      if (Array.isArray(fullPengajuan.handover_users)) {
        for (const handoverUser of fullPengajuan.handover_users) {
          const taggedId = handoverUser?.id_user_tagged;
          if (!taggedId || notifiedUsers.has(taggedId)) continue;
          notifiedUsers.add(taggedId);
          const overrideTitle = `${basePayload.nama_pemohon} mengajukan cuti`;
          const overrideBody = `${basePayload.nama_pemohon} menandai Anda sebagai handover cuti (${basePayload.kategori_cuti}) pada ${basePayload.tanggal_cuti_display}.`;
          notifPromises.push(
            sendNotification(
              'LEAVE_HANDOVER_TAGGED',
              taggedId,
              {
                ...basePayload,
                nama_penerima: handoverUser?.user?.nama_pengguna || undefined,
                title: overrideTitle,
                body: overrideBody,
                overrideTitle,
                overrideBody,
              },
              { deeplink }
            )
          );
        }
      }
      if (fullPengajuan.id_user && !notifiedUsers.has(fullPengajuan.id_user)) {
        const overrideTitle = 'Pengajuan cuti berhasil dikirim';
        const overrideBody = `Pengajuan cuti ${basePayload.kategori_cuti} pada ${basePayload.tanggal_cuti_display} telah berhasil dibuat.`;
        notifPromises.push(
          sendNotification(
            'LEAVE_HANDOVER_TAGGED',
            fullPengajuan.id_user,
            {
              ...basePayload,
              is_pemohon: true,
              title: overrideTitle,
              body: overrideBody,
              overrideTitle,
              overrideBody,
            },
            { deeplink }
          )
        );
        notifiedUsers.add(fullPengajuan.id_user);
      }
      if (notifPromises.length) {
        await Promise.allSettled(notifPromises);
      }
    }

    return NextResponse.json({
      ok: true,
      message: 'Pengajuan cuti berhasil dibuat.',
      data: fullPengajuan,
      upload: uploadMeta || undefined,
    });
  } catch (err) {
    console.error('POST /mobile/pengajuan-cuti error:', err);
    return NextResponse.json({ ok: false, message: 'Gagal membuat pengajuan cuti.' }, { status: 500 });
  }
}
