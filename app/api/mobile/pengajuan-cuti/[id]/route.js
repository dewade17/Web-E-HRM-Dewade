import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { ensureAuth, pengajuanInclude } from '../route';
import { parseRequestBody, findFileInBody } from '@/app/api/_utils/requestBody';
import storageClient from '@/app/api/_utils/storageClient';
import { parseDateOnlyToUTC } from '@/helpers/date-helper'; // Pastikan helper ini diimport

const ADMIN_ROLES = new Set(['HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN', 'SUBADMIN', 'SUPERVISI']);

function normalizeRole(role) {
  return String(role || '')
    .trim()
    .toUpperCase();
}

const isAdminRole = (role) => ADMIN_ROLES.has(normalizeRole(role));

function mapPengajuanWithTanggal(item) {
  if (!item) return item;

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
}

async function handleGet(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  const actorRole = auth.actor?.role;

  if (!actorId) {
    return NextResponse.json({ ok: false, message: 'Unauthorized.' }, { status: 401 });
  }

  const { id } = params || {};
  if (!id) {
    return NextResponse.json({ ok: false, message: 'ID tidak valid.' }, { status: 400 });
  }

  try {
    const pengajuan = await db.pengajuanCuti.findFirst({
      where: { id_pengajuan_cuti: id, deleted_at: null, jenis_pengajuan: 'cuti' },
      include: pengajuanInclude,
    });

    if (!pengajuan) {
      return NextResponse.json({ ok: false, message: 'Pengajuan cuti tidak ditemukan.' }, { status: 404 });
    }

    if (pengajuan.id_user !== actorId && !isAdminRole(actorRole)) {
      return NextResponse.json({ ok: false, message: 'Forbidden.' }, { status: 403 });
    }

    return NextResponse.json({ ok: true, data: mapPengajuanWithTanggal(pengajuan) });
  } catch (err) {
    console.error('GET /mobile/pengajuan-cuti/:id error:', err);
    return NextResponse.json({ ok: false, message: 'Terjadi kesalahan saat mengambil pengajuan cuti.' }, { status: 500 });
  }
}

export async function GET(req, ctx) {
  return handleGet(req, ctx);
}

async function handleUpdate(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  const { id } = params;

  if (!id) {
    return NextResponse.json({ ok: false, message: 'ID tidak valid.' }, { status: 400 });
  }

  let parsed;
  try {
    parsed = await parseRequestBody(req);
  } catch (err) {
    return NextResponse.json({ ok: false, message: 'Gagal memproses request body.' }, { status: 400 });
  }

  const body = parsed.body || {};

  const existing = await db.pengajuanCuti.findUnique({
    where: { id_pengajuan_cuti: id },
  });

  if (!existing) {
    return NextResponse.json({ ok: false, message: 'Pengajuan cuti tidak ditemukan.' }, { status: 404 });
  }

  // Validasi kepemilikan
  if (existing.id_user !== actorId) {
    return NextResponse.json({ ok: false, message: 'Anda tidak memiliki akses untuk mengedit data ini.' }, { status: 403 });
  }

  // Ambil field dasar
  const keperluan = body.keperluan;
  const handover = body.handover;
  const id_kategori_cuti = body.id_kategori_cuti;

  // --- PERBAIKAN: Parse Tanggal Masuk Kerja ---
  let tanggalMasukKerja = undefined;
  if (body.tanggal_masuk_kerja) {
    // Gunakan helper yang sama dengan create agar konsisten (UTC)
    const d = parseDateOnlyToUTC(body.tanggal_masuk_kerja);
    if (d) tanggalMasukKerja = d;
  }

  // --- PERBAIKAN UTAMA: Parse List Tanggal Cuti Baru ---
  let parsedCutiDates = [];
  // Cek berbagai kemungkinan key yang dikirim oleh Flutter
  const tanggalCutiInput = body['tanggal_list[]'] ?? body['tanggal_list'] ?? body['tanggal_cuti[]'] ?? body['tanggal_cuti'];

  if (tanggalCutiInput) {
    const tanggalCutiArray = Array.isArray(tanggalCutiInput) ? tanggalCutiInput : [tanggalCutiInput];

    for (const raw of tanggalCutiArray) {
      const tgl = parseDateOnlyToUTC(raw);
      if (tgl) {
        parsedCutiDates.push(tgl);
      }
    }
    // Validasi: Tanggal cuti tidak boleh kosong jika user berniat mengupdatenya
    if (parsedCutiDates.length === 0) {
      return NextResponse.json({ ok: false, message: 'Format tanggal cuti tidak valid.' }, { status: 400 });
    }
  }

  // --- Upload Lampiran ---
  let lampiranUrl = undefined;
  const lampiranFile = findFileInBody(body, ['lampiran_cuti', 'file', 'lampiran']);

  if (lampiranFile) {
    try {
      const res = await storageClient.uploadBufferWithPresign(lampiranFile, { folder: 'pengajuan' });
      lampiranUrl = res.publicUrl;
    } catch (e) {
      return NextResponse.json({ ok: false, message: 'Gagal upload lampiran baru.' }, { status: 500 });
    }
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const updateData = {};
      if (keperluan !== undefined) updateData.keperluan = keperluan;
      if (handover !== undefined) updateData.handover = handover;
      if (id_kategori_cuti !== undefined) updateData.id_kategori_cuti = id_kategori_cuti;
      if (tanggalMasukKerja !== undefined) updateData.tanggal_masuk_kerja = tanggalMasukKerja;
      if (lampiranUrl !== undefined) updateData.lampiran_cuti_url = lampiranUrl;

      // Reset status ke pending jika di-edit (Opsional, tergantung aturan bisnis Anda)
      // updateData.status = 'pending';

      // 1. Update Data Utama
      const updated = await tx.pengajuanCuti.update({
        where: { id_pengajuan_cuti: id },
        data: updateData,
      });

      // 2. Update Relasi Tanggal Cuti (Jika ada perubahan tanggal)
      if (parsedCutiDates.length > 0) {
        // A. Hapus semua tanggal lama untuk pengajuan ini
        await tx.pengajuanCutiTanggal.deleteMany({
          where: { id_pengajuan_cuti: id },
        });

        // B. Masukkan tanggal-tanggal baru
        await tx.pengajuanCutiTanggal.createMany({
          data: parsedCutiDates.map((tgl) => ({
            id_pengajuan_cuti: id,
            tanggal_cuti: tgl,
          })),
          skipDuplicates: true,
        });
      }

      // 3. Return data lengkap dengan include
      return tx.pengajuanCuti.findUnique({
        where: { id_pengajuan_cuti: id },
        include: pengajuanInclude,
      });
    });

    // Transformasi data response agar sesuai format GET (optional, agar UI langsung update)
    const itemsProcessed = { ...result };
    if (itemsProcessed.tanggal_list) {
      const dates = itemsProcessed.tanggal_list.map((d) => (d?.tanggal_cuti instanceof Date ? d.tanggal_cuti : new Date(d.tanggal_cuti))).sort((a, b) => a.getTime() - b.getTime());

      itemsProcessed.tanggal_cuti = dates.length ? dates[0] : null;
      itemsProcessed.tanggal_selesai = dates.length ? dates[dates.length - 1] : null;
    }

    return NextResponse.json({
      ok: true,
      message: 'Pengajuan cuti berhasil diperbarui.',
      data: itemsProcessed,
    });
  } catch (err) {
    console.error('Update Error:', err);
    return NextResponse.json({ ok: false, message: 'Terjadi kesalahan server saat update.' }, { status: 500 });
  }
}

export async function PUT(req, ctx) {
  return handleUpdate(req, ctx);
}

export async function PATCH(req, ctx) {
  return handleUpdate(req, ctx);
}

export async function DELETE(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  const actorRole = auth.actor?.role;

  if (!actorId) {
    return NextResponse.json({ ok: false, message: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const { id } = params;

    const existing = await db.pengajuanCuti.findUnique({
      where: { id_pengajuan_cuti: id },
      select: { id_pengajuan_cuti: true, id_user: true, status: true },
    });

    if (!existing) {
      return NextResponse.json({ ok: false, message: 'Pengajuan cuti tidak ditemukan.' }, { status: 404 });
    }

    if (existing.id_user !== actorId && !isAdminRole(actorRole)) {
      return NextResponse.json({ ok: false, message: 'Forbidden.' }, { status: 403 });
    }

    await db.pengajuanCuti.delete({
      where: { id_pengajuan_cuti: id },
    });

    return NextResponse.json({ ok: true, message: 'Pengajuan cuti berhasil dihapus permanen.' });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, message: 'Server error.' }, { status: 500 });
  }
}
