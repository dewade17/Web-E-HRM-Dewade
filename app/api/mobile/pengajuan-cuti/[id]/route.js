import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { ensureAuth, pengajuanInclude } from '../route';
import { parseRequestBody, findFileInBody } from '@/app/api/_utils/requestBody';
import storageClient from '@/app/api/_utils/storageClient';

const ADMIN_ROLES = new Set(['HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN', 'SUBADMIN', 'SUPERVISI']);

function normalizeRole(role) {
  return String(role || '')
    .trim()
    .toUpperCase();
}

const isAdminRole = (role) => ADMIN_ROLES.has(normalizeRole(role));

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

  if (existing.id_user !== actorId) {
    return NextResponse.json({ ok: false, message: 'Anda tidak memiliki akses untuk mengedit data ini.' }, { status: 403 });
  }

  const keperluan = body.keperluan;
  const handover = body.handover;
  const id_kategori_cuti = body.id_kategori_cuti;

  let tanggalMasukKerja = undefined;
  if (body.tanggal_masuk_kerja) {
    const d = new Date(body.tanggal_masuk_kerja);
    if (!isNaN(d.getTime())) tanggalMasukKerja = d;
  }

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

      const updated = await tx.pengajuanCuti.update({
        where: { id_pengajuan_cuti: id },
        data: updateData,
        include: pengajuanInclude,
      });

      return updated;
    });

    return NextResponse.json({
      ok: true,
      message: 'Pengajuan cuti berhasil diperbarui.',
      data: result,
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
