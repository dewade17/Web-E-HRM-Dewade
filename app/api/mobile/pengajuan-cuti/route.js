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
// Align admin roles with the latest Role enum defined in the Prisma schema.
// In addition to the previously supported roles, allow SUBADMIN and SUPERVISI
// to manage all cuti submissions. These roles are treated the same as other
// administrative roles such as HR, OPERASIONAL, DIREKTUR and SUPERADMIN.
const ADMIN_ROLES = new Set(['HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN', 'SUBADMIN', 'SUPERVISI']);

/*
 * Include definition for a complete Pengajuan Cuti object.  In addition to
 * the previously selected relations, this now pulls in the related
 * `tanggal_list` records.  The `tanggal_list` relation represents the
 * individual leave dates associated with a submission (see the
 * `PengajuanCutiTanggal` model in the Prisma schema).  Fetching these
 * dates allows callers to derive the effective start and end of a leave
 * request without relying on the deprecated `tanggal_mulai` field, which
 * was removed in the latest schema.
 */
const pengajuanInclude = {
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
  // Pull all leave dates associated with this submission.  Only the
  // `tanggal_cuti` field is needed; additional fields like the id are
  // excluded to reduce payload size.
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
    return value.toISOString().split('T')[0];
  } catch (err) {
    try {
      const asDate = new Date(value);
      if (Number.isNaN(asDate.getTime())) return '-';
      return asDate.toISOString().split('T')[0];
    } catch (_) {
      return '-';
    }
  }
}

function formatDateDisplay(value) {
  if (!value) return '-';
  try {
    return dateDisplayFormatter.format(value);
  } catch (err) {
    try {
      const asDate = new Date(value);
      if (Number.isNaN(asDate.getTime())) return '-';
      return dateDisplayFormatter.format(asDate);
    } catch (_) {
      return '-';
    }
  }
}

async function ensureAuth(req) {
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

function normalizeStatus(value) {
  /**
   * Normalize a status string against the allowed approve statuses.  This helper will
   * gracefully coerce the legacy value "menunggu" to the supported Prisma enum
   * value "pending".  If the provided value is not recognized, `null` is
   * returned so callers can handle invalid input.
   *
   * @param {any} value - raw status input
   * @returns {string|null} normalized status or null when invalid
   */
  if (!value) return null;
  const raw = String(value).trim().toLowerCase();
  // map legacy values to the canonical schema values
  const mapped = raw === 'menunggu' ? 'pending' : raw;
  if (!APPROVE_STATUSES.has(mapped)) return null;
  return mapped;
}

function parseDateQuery(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return parseDateOnlyToUTC(trimmed);
}

function sanitizeHandoverIds(ids) {
  if (ids === undefined) return undefined;
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

/* ============================ GET ============================ */
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

    const tanggalMulaiEqParam = searchParams.get('tanggal_mulai');
    const tanggalMulaiFromParam = searchParams.get('tanggal_mulai_from');
    const tanggalMulaiToParam = searchParams.get('tanggal_mulai_to');

    const tanggalMasukEqParam = searchParams.get('tanggal_masuk_kerja');
    const tanggalMasukFromParam = searchParams.get('tanggal_masuk_kerja_from');
    const tanggalMasukToParam = searchParams.get('tanggal_masuk_kerja_to');

    const targetUserParam = searchParams.get('id_user');
    const targetUserFilter = targetUserParam ? String(targetUserParam).trim() : '';

    // Build base where clause: restrict to non-deleted submissions of type 'cuti'.
    // We intentionally avoid referencing the removed `tanggal_mulai` field and
    // instead rely on the related `tanggal_list` relation for date-based
    // filtering.  The canManageAll helper still controls whether an actor
    // sees only their own submissions or all submissions.
    const where = { deleted_at: null, jenis_pengajuan: 'cuti' };

    if (!canManageAll(actorRole)) {
      // Non-admins may only see their own records
      where.id_user = actorId;
    } else if (targetUserFilter) {
      // Admins can optionally filter by a specific user
      where.id_user = targetUserFilter;
    }

    // Normalize legacy pending/menunggu statuses into a unified filter.  When
    // filtering for the canonical 'pending' state, we still include older
    // records with status 'menunggu'.  Other statuses map directly.
    if (status) {
      if (status === 'pending') {
        where.status = { in: ['pending', 'menunggu'] };
      } else {
        where.status = status;
      }
    }

    if (kategoriId) where.id_kategori_cuti = kategoriId;

    // Apply date filters against the related tanggal_list records.  Each
    // PengajuanCuti may have many associated tanggal_cuti values.  When a
    // singular `tanggal_mulai` filter is supplied, we treat it as a request
    // to fetch submissions that contain that exact leave date.  For range
    // queries we include any submission that has at least one leave date
    // within the provided interval.
    if (tanggalMulaiEqParam) {
      const parsed = parseDateQuery(tanggalMulaiEqParam);
      if (!parsed) {
        return NextResponse.json({ ok: false, message: 'Parameter tanggal_mulai tidak valid.' }, { status: 400 });
      }
      where.tanggal_list = { some: { tanggal_cuti: parsed } };
    } else if (tanggalMulaiFromParam || tanggalMulaiToParam) {
      const gte = parseDateQuery(tanggalMulaiFromParam);
      const lte = parseDateQuery(tanggalMulaiToParam);
      if (tanggalMulaiFromParam && !gte) {
        return NextResponse.json({ ok: false, message: 'Parameter tanggal_mulai_from tidak valid.' }, { status: 400 });
      }
      if (tanggalMulaiToParam && !lte) {
        return NextResponse.json({ ok: false, message: 'Parameter tanggal_mulai_to tidak valid.' }, { status: 400 });
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

    // Still support filtering by tanggal_masuk_kerja on the parent record.
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

    /*
     * Transform each returned submission to compute derived properties from
     * the related tanggal_list.  The earliest leave date becomes
     * `tanggal_mulai` and the latest date becomes `tanggal_selesai`.  A
     * flat array of raw date values (without wrapper objects) is exposed via
     * `tanggal_list` for convenience.  If no dates exist, these fields are
     * null.
     */
    const items = rawItems.map((item) => {
      const dates = Array.isArray(item.tanggal_list) ? item.tanggal_list.map((d) => (d?.tanggal_cuti instanceof Date ? d.tanggal_cuti : new Date(d.tanggal_cuti))) : [];
      dates.sort((a, b) => a - b);
      const tanggal_mulai = dates.length ? dates[0] : null;
      const tanggal_selesai = dates.length ? dates[dates.length - 1] : null;
      // Flatten dates to ISO strings for the consumer
      const tanggal_list = dates.map((d) => d);
      const { tanggal_list: _unused, ...rest } = item;
      return {
        ...rest,
        tanggal_mulai,
        tanggal_selesai,
        tanggal_list,
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

/* ============================ POST ============================ */
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
    const tanggal_mulai_input = body?.tanggal_mulai;
    const tanggal_masuk_input = body?.tanggal_masuk_kerja;
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

    /*
     * Mendukung banyak tanggal cuti dalam satu pengajuan.
     * Jika `tanggal_mulai` atau `tanggal_masuk_kerja` merupakan array (salah satunya atau keduanya),
     * maka setiap pasangan akan diproses sebagai pengajuan terpisah namun dalam satu request.
     */

    const startDateArray = Array.isArray(tanggal_mulai_input) ? tanggal_mulai_input : [tanggal_mulai_input];
    const endDateArray = Array.isArray(tanggal_masuk_input) ? tanggal_masuk_input : [tanggal_masuk_input];

    // Validasi jumlah array: jika lebih dari satu, kedua array harus sama panjang atau endDateArray panjangnya 1
    if (startDateArray.length > 1 && endDateArray.length > 1 && startDateArray.length !== endDateArray.length) {
      return NextResponse.json({ ok: false, message: "Jumlah elemen pada 'tanggal_mulai' dan 'tanggal_masuk_kerja' tidak sesuai. Panjang array keduanya harus sama atau salah satunya satu." }, { status: 400 });
    }

    /*
     * Build pairs of (start, return) dates.  Each pair represents a leave interval
     * where the employee is away from the start date up to (but not
     * including) the return date.  These pairs will later be expanded into
     * individual leave dates to populate the `pengajuan_cuti_tanggal` table.
     */
    const datePairs = [];
    for (let i = 0; i < startDateArray.length; i++) {
      const mulaiRaw = startDateArray[i];
      const masukRaw = endDateArray.length > 1 ? endDateArray[i] : endDateArray[0];
      const tanggal_mulai = parseDateOnlyToUTC(mulaiRaw);
      if (!tanggal_mulai) {
        return NextResponse.json({ ok: false, message: 'tanggal_mulai tidak valid.' }, { status: 400 });
      }
      const tanggal_masuk_kerja = parseDateOnlyToUTC(masukRaw);
      if (!tanggal_masuk_kerja) {
        return NextResponse.json({ ok: false, message: 'tanggal_masuk_kerja tidak valid.' }, { status: 400 });
      }
      if (tanggal_masuk_kerja < tanggal_mulai) {
        return NextResponse.json({ ok: false, message: 'tanggal_masuk_kerja tidak boleh sebelum tanggal_mulai.' }, { status: 400 });
      }
      datePairs.push({ tanggal_mulai, tanggal_masuk_kerja });
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

    /*
     * Proses pembuatan pengajuan cuti untuk setiap pasangan tanggal.
     * Kita iterasi setiap datePairs yang sudah disiapkan di atas, membuat record secara terpisah
     * namun dalam satu transaksi. Setelah transaksi selesai, setiap record lengkap (dengan includes)
     * akan dikirimkan dalam bentuk array jika lebih dari satu, atau sebagai objek tunggal jika hanya satu.
     */
    const fullPengajuans = await db.$transaction(async (tx) => {
      const createdRecords = [];
      for (const { tanggal_mulai: tMulai, tanggal_masuk_kerja: tMasuk } of datePairs) {
        // Create the parent leave submission.  Note that the `tanggal_mulai` field
        // has been removed from the model; only the return date
        // (`tanggal_masuk_kerja`) is stored on the main record.  The
        // individual leave dates will be persisted into the related
        // PengajuanCutiTanggal table below.
        const created = await tx.pengajuanCuti.create({
          data: {
            id_user: actorId,
            id_kategori_cuti,
            keperluan,
            tanggal_masuk_kerja: tMasuk,
            handover,
            jenis_pengajuan,
            lampiran_cuti_url: lampiranUrl,
          },
        });

        // Expand the leave interval into individual dates and insert into
        // pengajuan_cuti_tanggal.  The cuti period covers every date from
        // `tMulai` up to (but not including) `tMasuk`.  This mirrors the
        // previous behaviour where `tanggal_mulai` represented the first day
        // off and `tanggal_masuk_kerja` represented the first day back.
        const dates = [];
        {
          const current = new Date(tMulai.getTime());
          // Ensure we operate in UTC by using getUTCDate/setUTCDate to avoid
          // daylight saving differences.
          while (current < tMasuk) {
            dates.push(new Date(current.getTime()));
            current.setUTCDate(current.getUTCDate() + 1);
          }
        }
        if (dates.length) {
          await tx.pengajuanCutiTanggal.createMany({
            data: dates.map((tgl) => ({
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
        createdRecords.push(created);
      }
      // fetch full objects with includes
      return Promise.all(
        createdRecords.map((item) =>
          tx.pengajuanCuti.findUnique({
            where: { id_pengajuan_cuti: item.id_pengajuan_cuti },
            include: pengajuanInclude,
          })
        )
      );
    });

    // Kirim notifikasi untuk setiap pengajuan yang telah dibuat
    for (const fullPengajuan of fullPengajuans) {
      if (!fullPengajuan) continue;
      const deeplink = `/pengajuan-cuti/${fullPengajuan.id_pengajuan_cuti}`;
      // Determine the earliest leave date from the related tanggal_list.  If no
      // dates exist (which should not occur under normal operation), the
      // derived values will be null.  The first date is used in the
      // notification payload in place of the removed `tanggal_mulai` field.
      const rawDates = Array.isArray(fullPengajuan.tanggal_list) ? fullPengajuan.tanggal_list.map((d) => (d?.tanggal_cuti instanceof Date ? d.tanggal_cuti : new Date(d.tanggal_cuti))) : [];
      rawDates.sort((a, b) => a - b);
      const firstDate = rawDates.length ? rawDates[0] : null;
      const basePayload = {
        nama_pemohon: fullPengajuan.user?.nama_pengguna || 'Rekan',
        kategori_cuti: fullPengajuan.kategori_cuti?.nama_kategori || '-',
        tanggal_mulai: formatDateISO(firstDate),
        tanggal_mulai_display: formatDateDisplay(firstDate),
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
          const overrideBody = `${basePayload.nama_pemohon} menandai Anda sebagai handover cuti (${basePayload.kategori_cuti}) pada ${basePayload.tanggal_mulai_display}.`;
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
        const overrideBody = `Pengajuan cuti ${basePayload.kategori_cuti} pada ${basePayload.tanggal_mulai_display} telah berhasil dibuat.`;
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
      message: fullPengajuans.length > 1 ? `Berhasil membuat ${fullPengajuans.length} pengajuan cuti.` : 'Pengajuan cuti berhasil dibuat.',
      data: fullPengajuans.length === 1 ? fullPengajuans[0] : fullPengajuans,
      upload: uploadMeta || undefined,
    });
  } catch (err) {
    console.error('POST /mobile/pengajuan-cuti error:', err);
    return NextResponse.json({ ok: false, message: 'Gagal membuat pengajuan cuti.' }, { status: 500 });
  }
}

export { ensureAuth, pengajuanInclude, sanitizeHandoverIds, normalizeStatus, parseDateQuery };
