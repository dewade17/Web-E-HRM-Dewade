export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { parseDateOnlyToUTC } from '@/helpers/date-helper';
// Impor helper dari route.js (GET list) dan utils
import { ensureAuth, pengajuanInclude, sanitizeHandoverIds, normalizeStatus } from '../route';
import storageClient from '@/app/api/_utils/storageClient';
import { parseRequestBody, findFileInBody, hasOwn, isNullLike } from '@/app/api/_utils/requestBody';
import { parseApprovalsFromBody, ensureApprovalUsersExist, syncApprovalRecords } from '../_utils/approvals';

/**
 * Helper untuk mengambil data pengajuan cuti beserta relasinya.
 * @param {string} id - ID pengajuan cuti
 */
async function getPengajuanOrError(id) {
  // Menggunakan pengajuanInclude yang sudah didefinisikan di route.js
  // 'pengajuanInclude' sudah berisi 'tanggal_list'
  const include = {
    ...pengajuanInclude,
    user: {
      select: { id_user: true, nama_pengguna: true, email: true, role: true },
    },
  };

  const pengajuan = await db.pengajuanCuti.findUnique({
    where: { id_pengajuan_cuti: id },
    include: include,
  });
  return pengajuan;
}

/**
 * Helper untuk response 403 Forbidden
 */
function buildForbiddenResponse() {
  return NextResponse.json({ ok: false, message: 'Anda tidak memiliki akses ke pengajuan ini.' }, { status: 403 });
}

/**
 * Helper untuk response 404 Not Found
 */
function buildNotFoundResponse() {
  return NextResponse.json({ ok: false, message: 'Pengajuan cuti tidak ditemukan.' }, { status: 404 });
}

/**
 * Helper untuk menghitung tanggal_mulai dan tanggal_selesai (turunan)
 * dari relasi tanggal_list yang ada di data pengajuan.
 */
function computeDerivedDates(pengajuan) {
  const dates = (pengajuan?.tanggal_list || []).map((d) => (d?.tanggal_cuti instanceof Date ? d.tanggal_cuti : new Date(d.tanggal_cuti))).sort((a, b) => a.getTime() - b.getTime()); // Gunakan .getTime()

  const tanggal_mulai_derived = dates.length ? dates[0] : null;
  const tanggal_selesai_derived = dates.length ? dates[dates.length - 1] : null;
  const tanggal_list_flat = dates; // kembalikan array Date object

  return { tanggal_mulai_derived, tanggal_selesai_derived, tanggal_list_flat };
}

/**
 * GET: Mengambil detail satu pengajuan cuti (by ID)
 */
export async function GET(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  if (!actorId) {
    return NextResponse.json({ ok: false, message: 'Unauthorized.' }, { status: 401 });
  }

  const id = params?.id;
  if (!id) {
    return NextResponse.json({ ok: false, message: 'ID pengajuan wajib diisi.' }, { status: 400 });
  }

  try {
    const pengajuan = await getPengajuanOrError(id);
    if (!pengajuan || pengajuan.deleted_at) {
      return buildNotFoundResponse();
    }

    // Hanya pemilik atau admin yang boleh lihat
    const actorRole = auth.actor?.role ? String(auth.actor.role).trim().toUpperCase() : '';
    const isAdmin = ['HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN', 'SUBADMIN', 'SUPERVISI'].includes(actorRole);

    if (pengajuan.user.id_user !== actorId && !isAdmin) {
      return buildForbiddenResponse();
    }

    // Hitung dan kembalikan derived dates
    const { tanggal_list: _unused, ...rest } = pengajuan;
    const { tanggal_mulai_derived, tanggal_selesai_derived, tanggal_list_flat } = computeDerivedDates(pengajuan);

    return NextResponse.json({
      ok: true,
      data: {
        ...rest,
        tanggal_mulai: tanggal_mulai_derived, // Nilai turunan (bukan field DB)
        tanggal_selesai: tanggal_selesai_derived, // Nilai turunan (bukan field DB)
        tanggal_list: tanggal_list_flat, // Kirim list tanggal yang sudah di-flat
      },
    });
  } catch (err) {
    console.error(`GET /mobile/pengajuan-cuti/${id} error:`, err);
    return NextResponse.json({ ok: false, message: 'Gagal mengambil detail pengajuan cuti.' }, { status: 500 });
  }
}

function normalizeBodyString(value) {
  if (value === undefined || value === null) return null;
  return String(value);
}

/**
 * PUT / PATCH: Memperbarui pengajuan cuti
 */
async function handleUpdate(req, params) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  if (!actorId) {
    return NextResponse.json({ ok: false, message: 'Unauthorized.' }, { status: 401 });
  }

  const id = params?.id;
  if (!id) {
    return NextResponse.json({ ok: false, message: 'ID pengajuan wajib diisi.' }, { status: 400 });
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
    const pengajuan = await getPengajuanOrError(id);
    if (!pengajuan || pengajuan.deleted_at) {
      return buildNotFoundResponse();
    }
    // Hanya pemilik yang boleh edit
    if (pengajuan.user.id_user !== actorId) {
      return buildForbiddenResponse();
    }

    // Ambil tanggal_mulai (turunan) dan tanggal_masuk (skema) yang ada
    const { tanggal_mulai_derived: existingCutiAwal } = computeDerivedDates(pengajuan);
    const existingTanggalMasuk = pengajuan.tanggal_masuk_kerja;

    const updateData = {}; // Data untuk tabel PengajuanCuti
    let uploadMeta = null;

    if (hasOwn(body, 'id_kategori_cuti')) {
      const idKategori = String(body.id_kategori_cuti || '').trim();
      if (!idKategori) {
        return NextResponse.json({ ok: false, message: 'id_kategori_cuti wajib diisi.' }, { status: 400 });
      }
      const kategori = await db.kategoriCuti.findFirst({
        where: { id_kategori_cuti: idKategori, deleted_at: null },
        select: { id_kategori_cuti: true },
      });
      if (!kategori) {
        return NextResponse.json({ ok: false, message: 'Kategori cuti tidak ditemukan.' }, { status: 404 });
      }
      updateData.id_kategori_cuti = idKategori;
    }

    // Logika penanganan tanggal
    // Terima 'tanggal_mulai' sebagai parameter input dari body
    const hasTanggalMulai = hasOwn(body, 'tanggal_mulai');
    // Terima 'tanggal_masuk_kerja' (field skema)
    const hasTanggalMasuk = hasOwn(body, 'tanggal_masuk_kerja');

    // Kita perlu sinkronisasi relasi tanggal jika salah satu dari Tgl Mulai atau Tgl Masuk diubah
    const shouldSyncTanggalCuti = hasTanggalMulai || hasTanggalMasuk;

    let newCutiAwal; // Variabel untuk tanggal mulai (dari input)
    let newTanggalMasuk; // Variabel untuk tanggal masuk (dari input/existing)

    if (shouldSyncTanggalCuti) {
      // Jika salah satu dikirim, gunakan yang ada sebagai fallback
      newCutiAwal = hasTanggalMulai ? parseDateOnlyToUTC(body.tanggal_mulai) : existingCutiAwal;
      newTanggalMasuk = hasTanggalMasuk ? parseDateOnlyToUTC(body.tanggal_masuk_kerja) : existingTanggalMasuk;

      if (!newCutiAwal) {
        return NextResponse.json({ ok: false, message: 'tanggal_mulai tidak valid.' }, { status: 400 });
      }
      if (!newTanggalMasuk) {
        return NextResponse.json({ ok: false, message: 'tanggal_masuk_kerja tidak valid.' }, { status: 400 });
      }
      if (newTanggalMasuk <= newCutiAwal) {
        return NextResponse.json({ ok: false, message: 'tanggal_masuk_kerja tidak boleh sebelum atau sama dengan tanggal_mulai.' }, { status: 400 });
      }

      // HANYA update tanggal_masuk_kerja di tabel utama jika disediakan
      if (hasTanggalMasuk) {
        updateData.tanggal_masuk_kerja = newTanggalMasuk; // Field skema
      }
      // JANGAN tambahkan 'tanggal_mulai' ke updateData
    }

    if (hasOwn(body, 'keperluan')) {
      updateData.keperluan = normalizeBodyString(body.keperluan);
    }

    if (hasOwn(body, 'handover')) {
      updateData.handover = normalizeBodyString(body.handover);
    }

    const lampiranFile = findFileInBody(body, ['lampiran_cuti', 'lampiran', 'lampiran_file', 'file']);
    if (lampiranFile) {
      try {
        const res = await storageClient.uploadBufferWithPresign(lampiranFile, { folder: 'pengajuan' });
        updateData.lampiran_cuti_url = res.publicUrl || null;
        uploadMeta = { key: res.key, publicUrl: res.publicUrl, etag: res.etag, size: res.size };
      } catch (e) {
        return NextResponse.json({ ok: false, message: 'Gagal mengunggah lampiran.', detail: e?.message || String(e) }, { status: 502 });
      }
    } else if (hasOwn(body, 'lampiran_cuti_url')) {
      updateData.lampiran_cuti_url = isNullLike(body.lampiran_cuti_url) ? null : String(body.lampiran_cuti_url);
    }

    if (hasOwn(body, 'status')) {
      const normalized = normalizeStatus(body.status);
      if (!normalized) {
        return NextResponse.json({ ok: false, message: 'status tidak valid.' }, { status: 400 });
      }
      updateData.status = normalized;
    }

    const handoverIdsInput = body?.['handover_tag_user_ids[]'] ?? body?.handover_tag_user_ids;
    const handoverIds = sanitizeHandoverIds(handoverIdsInput); // undefined, atau array

    if (handoverIds && handoverIds.length) {
      const users = await db.user.findMany({
        where: { id_user: { in: handoverIds }, deleted_at: null },
        select: { id_user: true },
      });
      const found = new Set(users.map((u) => u.id_user));
      const missing = handoverIds.filter((userId) => !found.has(userId));
      if (missing.length) {
        return NextResponse.json({ ok: false, message: 'Beberapa handover_tag_user_ids tidak valid.' }, { status: 400 });
      }
    }

    let approvalsInput;
    let shouldSyncApprovals = false;
    try {
      approvalsInput = parseApprovalsFromBody(body);
      shouldSyncApprovals = approvalsInput !== undefined;
    } catch (err) {
      const status = err?.status || 400;
      return NextResponse.json({ ok: false, message: err?.message || 'Data approvals tidak valid.' }, { status });
    }

    try {
      if (shouldSyncApprovals) {
        await ensureApprovalUsersExist(db, approvalsInput);
      }
    } catch (err) {
      const status = err?.status || 400;
      return NextResponse.json({ ok: false, message: err?.message || 'Approver tidak valid.' }, { status });
    }

    const hasUpdate = Object.keys(updateData).length > 0;
    const shouldSyncHandover = handoverIds !== undefined;

    if (!hasUpdate && !shouldSyncHandover && !shouldSyncApprovals && !shouldSyncTanggalCuti) {
      return NextResponse.json({ ok: false, message: 'Tidak ada perubahan yang diberikan.' }, { status: 400 });
    }

    const updated = await db.$transaction(async (tx) => {
      // 1. Update tabel utama (PengajuanCuti)
      if (hasUpdate) {
        await tx.pengajuanCuti.update({
          where: { id_pengajuan_cuti: id },
          data: updateData, // 'updateData' hanya berisi field skema
        });
      }

      // 2. Sinkronisasi Handover
      if (shouldSyncHandover) {
        await tx.handoverCuti.deleteMany({ where: { id_pengajuan_cuti: id } });
        if (handoverIds && handoverIds.length) {
          await tx.handoverCuti.createMany({
            data: handoverIds.map((userId) => ({
              id_pengajuan_cuti: id,
              id_user_tagged: userId,
            })),
            skipDuplicates: true,
          });
        }
      }

      // 3. Sinkronisasi Approvals
      if (shouldSyncApprovals) {
        await syncApprovalRecords(tx, id, approvalsInput);
      }

      // 4. Sinkronisasi tanggal di relasi 'PengajuanCutiTanggal'
      if (shouldSyncTanggalCuti) {
        // Hapus semua tanggal lama
        await tx.pengajuanCutiTanggal.deleteMany({
          where: { id_pengajuan_cuti: id },
        });

        // Buat tanggal baru berdasarkan 'newCutiAwal' dan 'newTanggalMasuk'
        const dates = [];
        // Pastikan kita menggunakan tanggal yang sudah divalidasi
        const current = new Date(newCutiAwal.getTime());
        // Loop sampai 1 hari SEBELUM tanggal masuk
        while (current < newTanggalMasuk) {
          dates.push(new Date(current.getTime()));
          current.setUTCDate(current.getUTCDate() + 1);
        }

        if (dates.length) {
          await tx.pengajuanCutiTanggal.createMany({
            data: dates.map((tgl) => ({
              id_pengajuan_cuti: id,
              tanggal_cuti: tgl, // Field skema relasi
            })),
            skipDuplicates: true,
          });
        }
      }

      // 5. Ambil data terbaru
      return tx.pengajuanCuti.findUnique({
        where: { id_pengajuan_cuti: id },
        include: pengajuanInclude,
      });
    });

    // Hitung ulang derived dates untuk respons
    const { tanggal_list: _unused, ...restUpdated } = updated;
    const { tanggal_mulai_derived, tanggal_selesai_derived, tanggal_list_flat } = computeDerivedDates(updated);

    return NextResponse.json({
      ok: true,
      message: 'Pengajuan cuti berhasil diperbarui.',
      data: {
        ...restUpdated,
        tanggal_mulai: tanggal_mulai_derived, // Nilai turunan
        tanggal_selesai: tanggal_selesai_derived, // Nilai turunan
        tanggal_list: tanggal_list_flat,
      },
      upload: uploadMeta || undefined,
    });
  } catch (err) {
    console.error(`UPDATE /mobile/pengajuan-cuti/${id} error:`, err);
    return NextResponse.json({ ok: false, message: 'Gagal memperbarui pengajuan cuti.' }, { status: 500 });
  }
}

export async function PUT(req, context) {
  return handleUpdate(req, context?.params ?? {});
}

export async function PATCH(req, context) {
  return handleUpdate(req, context?.params ?? {});
}

/**
 * DELETE: Menghapus pengajuan cuti (soft delete)
 */
export async function DELETE(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  if (!actorId) {
    return NextResponse.json({ ok: false, message: 'Unauthorized.' }, { status: 401 });
  }

  const id = params?.id;
  if (!id) {
    return NextResponse.json({ ok: false, message: 'ID pengajuan wajib diisi.' }, { status: 400 });
  }

  try {
    const pengajuan = await getPengajuanOrError(id);
    if (!pengajuan || pengajuan.deleted_at) {
      return buildNotFoundResponse();
    }

    if (pengajuan.user.id_user !== actorId) {
      return buildForbiddenResponse();
    }

    await db.pengajuanCuti.update({
      where: { id_pengajuan_cuti: id },
      data: { deleted_at: new Date() },
    });

    return NextResponse.json({ ok: true, message: 'Pengajuan cuti berhasil dihapus.' });
  } catch (err) {
    console.error(`DELETE /mobile/pengajuan-cuti/${id} error:`, err);
    return NextResponse.json({ ok: false, message: 'Gagal menghapus pengajuan cuti.' }, { status: 500 });
  }
}
