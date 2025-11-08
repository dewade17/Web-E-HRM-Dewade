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
// Menyesuaikan dengan skema Role terbaru
const ADMIN_ROLES = new Set(['HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN', 'SUBADMIN', 'SUPERVISI']);

/**
 * Mendefinisikan data relasi yang akan diambil.
 * Sesuai skema: 'tanggal_list' (merujuk ke PengajuanCutiTanggal) disertakan.
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
  // Sesuai skema: ambil daftar tanggal dari relasi
  tanggal_list: {
    select: {
      tanggal_cuti: true, // Field 'tanggal_cuti' dari model 'PengajuanCutiTanggal'
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
 * Normalisasi status, termasuk mapping 'menunggu' (legacy) ke 'pending' (skema).
 */
export function normalizeStatus(value) {
  if (!value) return null;
  const raw = String(value).trim().toLowerCase();
  const mapped = raw === 'menunggu' ? 'pending' : raw;
  if (!APPROVE_STATUSES.has(mapped)) return null;
  return mapped;
}

export function parseDateQuery(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return parseDateOnlyToUTC(trimmed);
}

export function sanitizeHandoverIds(ids) {
  if (ids === undefined) return undefined;
  // Menangani input '[]' dari form-data
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

    // Terima parameter filter 'tanggal_mulai' (ini BUKAN field schema, ini parameter query)
    const tanggalMulaiEqParam = searchParams.get('tanggal_mulai');
    const tanggalMulaiFromParam = searchParams.get('tanggal_mulai_from');
    const tanggalMulaiToParam = searchParams.get('tanggal_mulai_to');

    // Filter untuk field 'tanggal_masuk_kerja' (ini ADALAH field schema)
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
      if (status === 'pending') {
        where.status = { in: ['pending', 'menunggu'] }; // Tetap dukung legacy 'menunggu'
      } else {
        where.status = status;
      }
    }

    if (kategoriId) where.id_kategori_cuti = kategoriId;

    // Filter 'tanggal_mulai' (parameter) ke relasi 'tanggal_list' (skema)
    if (tanggalMulaiEqParam) {
      const parsed = parseDateQuery(tanggalMulaiEqParam);
      if (!parsed) {
        return NextResponse.json({ ok: false, message: 'Parameter tanggal_mulai tidak valid.' }, { status: 400 });
      }
      // Temukan pengajuan yang memiliki minimal 1 tanggal cuti yang cocok
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
      // Temukan pengajuan yang memiliki minimal 1 tanggal cuti dalam rentang
      where.tanggal_list = {
        some: {
          tanggal_cuti: {
            ...(gte ? { gte } : {}),
            ...(lte ? { lte } : {}),
          },
        },
      };
    }

    // Filter 'tanggal_masuk_kerja' (field skema)
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

    // Transformasi: Hitung 'tanggal_mulai' dan 'tanggal_selesai' (sebagai nilai turunan)
    // dari 'tanggal_list' untuk dikirim ke klien.
    const items = rawItems.map((item) => {
      const dates = (item.tanggal_list || []).map((d) => (d?.tanggal_cuti instanceof Date ? d.tanggal_cuti : new Date(d.tanggal_cuti))).sort((a, b) => a.getTime() - b.getTime()); // Gunakan .getTime() untuk sorting

      const tanggal_mulai_derived = dates.length ? dates[0] : null;
      const tanggal_selesai_derived = dates.length ? dates[dates.length - 1] : null;

      const { tanggal_list: _unused, ...rest } = item;

      return {
        ...rest,
        tanggal_mulai: tanggal_mulai_derived, // Nilai turunan (bukan field DB)
        tanggal_selesai: tanggal_selesai_derived, // Nilai turunan (bukan field DB)
        tanggal_list: dates, // Kirim array tanggal (bukan objek relasi)
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
    // Terima 'tanggal_mulai' sebagai parameter input dari body
    const tanggalMulaiInput = body?.tanggal_mulai;
    // Terima 'tanggal_masuk_kerja' (field skema)
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

    // Mendukung input array untuk 'tanggal_mulai' (parameter) dan 'tanggal_masuk_kerja' (field)
    const tanggalAwalArray = Array.isArray(tanggalMulaiInput) ? tanggalMulaiInput : [tanggalMulaiInput];
    const tanggalMasukArray = Array.isArray(tanggalMasukInput) ? tanggalMasukInput : [tanggalMasukInput];

    if (tanggalAwalArray.length > 1 && tanggalMasukArray.length > 1 && tanggalAwalArray.length !== tanggalMasukArray.length) {
      return NextResponse.json({ ok: false, message: "Jumlah elemen pada 'tanggal_mulai' dan 'tanggal_masuk_kerja' tidak sesuai." }, { status: 400 });
    }

    const datePairs = []; // Pasangan [tanggalCutiAwal, tanggalMasukKerja]
    for (let i = 0; i < tanggalAwalArray.length; i++) {
      const cutiAwalRaw = tanggalAwalArray[i];
      const masukRaw = tanggalMasukArray.length > 1 ? tanggalMasukArray[i] : tanggalMasukArray[0];

      const tanggalCutiAwal = parseDateOnlyToUTC(cutiAwalRaw); // Ini parameter, bukan field
      if (!tanggalCutiAwal) {
        return NextResponse.json({ ok: false, message: 'tanggal_mulai tidak valid.' }, { status: 400 });
      }
      const tanggalMasukKerja = parseDateOnlyToUTC(masukRaw); // Ini field skema
      if (!tanggalMasukKerja) {
        return NextResponse.json({ ok: false, message: 'tanggal_masuk_kerja tidak valid.' }, { status: 400 });
      }
      if (tanggalMasukKerja <= tanggalCutiAwal) {
        // Harus '<=' karena tanggal masuk adalah hari PERTAMA kembali
        return NextResponse.json({ ok: false, message: 'tanggal_masuk_kerja tidak boleh sebelum atau sama dengan tanggal_mulai.' }, { status: 400 });
      }
      datePairs.push({ tanggalCutiAwal, tanggalMasukKerja });
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

    // Proses pembuatan data dalam satu transaksi
    const fullPengajuans = await db.$transaction(async (tx) => {
      const createdRecords = [];
      for (const { tanggalCutiAwal, tanggalMasukKerja } of datePairs) {
        // 1. Buat data di tabel PengajuanCuti
        // Sesuai skema: HANYA 'tanggal_masuk_kerja' yang disimpan.
        const created = await tx.pengajuanCuti.create({
          data: {
            id_user: actorId,
            id_kategori_cuti,
            keperluan,
            tanggal_masuk_kerja: tanggalMasukKerja, // Field skema
            // 'tanggal_mulai' TIDAK DISIMPAN di sini
            handover,
            jenis_pengajuan,
            lampiran_cuti_url: lampiranUrl,
          },
        });

        // 2. Hitung rentang tanggal cuti
        const dates = [];
        const current = new Date(tanggalCutiAwal.getTime());
        // Loop sampai 1 hari SEBELUM tanggal masuk
        while (current < tanggalMasukKerja) {
          dates.push(new Date(current.getTime()));
          current.setUTCDate(current.getUTCDate() + 1);
        }

        // 3. Simpan rentang tanggal ke tabel relasi 'PengajuanCutiTanggal'
        if (dates.length) {
          await tx.pengajuanCutiTanggal.createMany({
            data: dates.map((tgl) => ({
              id_pengajuan_cuti: created.id_pengajuan_cuti,
              tanggal_cuti: tgl, // Field skema relasi
            })),
            skipDuplicates: true,
          });
        }

        // 4. Simpan relasi Approvals
        if (approvalsInput !== undefined) {
          await syncApprovalRecords(tx, created.id_pengajuan_cuti, approvalsInput);
        }

        // 5. Simpan relasi Handover
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

      // Ambil data lengkap untuk dikirim kembali
      return Promise.all(
        createdRecords.map((item) =>
          tx.pengajuanCuti.findUnique({
            where: { id_pengajuan_cuti: item.id_pengajuan_cuti },
            include: pengajuanInclude, // 'pengajuanInclude' sudah berisi 'tanggal_list'
          })
        )
      );
    });

    // Kirim notifikasi
    for (const fullPengajuan of fullPengajuans) {
      if (!fullPengajuan) continue;
      const deeplink = `/pengajuan-cuti/${fullPengajuan.id_pengajuan_cuti}`;

      // Ambil tanggal cuti pertama DARI RELASI 'tanggal_list'
      const rawDates = (fullPengajuan.tanggal_list || []).map((d) => (d?.tanggal_cuti instanceof Date ? d.tanggal_cuti : new Date(d.tanggal_cuti))).sort((a, b) => a.getTime() - b.getTime()); // Gunakan .getTime()
      const tanggalCutiPertama = rawDates.length ? rawDates[0] : null;

      const basePayload = {
        nama_pemohon: fullPengajuan.user?.nama_pengguna || 'Rekan',
        kategori_cuti: fullPengajuan.kategori_cuti?.nama_kategori || '-',
        // Gunakan nilai turunan 'tanggalCutiPertama' untuk notifikasi
        tanggal_mulai: formatDateISO(tanggalCutiPertama),
        tanggal_mulai_display: formatDateDisplay(tanggalCutiPertama),
        // Gunakan field 'tanggal_masuk_kerja' dari skema
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
            'LEAVE_HANDOVER_TAGGED', // Menggunakan trigger yang ada
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
      // Kembalikan data lengkap (termasuk 'tanggal_list')
      data: fullPengajuans.length === 1 ? fullPengajuans[0] : fullPengajuans,
      upload: uploadMeta || undefined,
    });
  } catch (err) {
    console.error('POST /mobile/pengajuan-cuti error:', err);
    return NextResponse.json({ ok: false, message: 'Gagal membuat pengajuan cuti.' }, { status: 500 });
  }
}
