export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { parseDateOnlyToUTC } from '@/helpers/date-helper';
import { ensureAuth, pengajuanInclude, sanitizeHandoverIds, normalizeStatus } from '../route';

async function getPengajuanOrError(id) {
  return db.pengajuanCuti.findUnique({
    where: { id_pengajuan_cuti: id },
    include: {
      ...pengajuanInclude,
      user: {
        select: { id_user: true },
      },
    },
  });
}

function buildForbiddenResponse() {
  return NextResponse.json({ ok: false, message: 'Anda tidak memiliki akses ke pengajuan ini.' }, { status: 403 });
}

function buildNotFoundResponse() {
  return NextResponse.json({ ok: false, message: 'Pengajuan cuti tidak ditemukan.' }, { status: 404 });
}

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

    if (pengajuan.user.id_user !== actorId) {
      return buildForbiddenResponse();
    }

    const { user, ...rest } = pengajuan;

    return NextResponse.json({ ok: true, data: rest });
  } catch (err) {
    console.error(`GET /mobile/pengajuan-cuti/${id} error:`, err);
    return NextResponse.json({ ok: false, message: 'Gagal mengambil detail pengajuan cuti.' }, { status: 500 });
  }
}

function normalizeBodyString(value) {
  if (value === undefined || value === null) return null;
  return String(value);
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

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

  let body;
  try {
    body = await req.json();
  } catch (err) {
    return NextResponse.json({ ok: false, message: 'Body request harus berupa JSON.' }, { status: 400 });
  }

  try {
    const pengajuan = await getPengajuanOrError(id);
    if (!pengajuan || pengajuan.deleted_at) {
      return buildNotFoundResponse();
    }
    if (pengajuan.user.id_user !== actorId) {
      return buildForbiddenResponse();
    }

    const updateData = {};

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

    let tanggalMulaiBaru;
    if (hasOwn(body, 'tanggal_mulai')) {
      tanggalMulaiBaru = parseDateOnlyToUTC(body.tanggal_mulai);
      if (!tanggalMulaiBaru) {
        return NextResponse.json({ ok: false, message: 'tanggal_mulai tidak valid.' }, { status: 400 });
      }
      updateData.tanggal_mulai = tanggalMulaiBaru;
    }

    let tanggalMasukBaru;
    if (hasOwn(body, 'tanggal_masuk_kerja')) {
      tanggalMasukBaru = parseDateOnlyToUTC(body.tanggal_masuk_kerja);
      if (!tanggalMasukBaru) {
        return NextResponse.json({ ok: false, message: 'tanggal_masuk_kerja tidak valid.' }, { status: 400 });
      }
      updateData.tanggal_masuk_kerja = tanggalMasukBaru;
    }

    if (hasOwn(body, 'keperluan')) {
      updateData.keperluan = normalizeBodyString(body.keperluan);
    }

    if (hasOwn(body, 'handover')) {
      updateData.handover = normalizeBodyString(body.handover);
    }

    if (hasOwn(body, 'status')) {
      const normalized = normalizeStatus(body.status);
      if (!normalized) {
        return NextResponse.json({ ok: false, message: 'status tidak valid.' }, { status: 400 });
      }
      updateData.status = normalized;
    }

    const handoverIds = sanitizeHandoverIds(body.handover_tag_user_ids);
    if (handoverIds === null) {
      return NextResponse.json({ ok: false, message: 'handover_tag_user_ids harus berupa array.' }, { status: 400 });
    }

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

    const finalTanggalMulai = tanggalMulaiBaru ?? pengajuan.tanggal_mulai;
    const finalTanggalMasuk = tanggalMasukBaru ?? pengajuan.tanggal_masuk_kerja;
    if (finalTanggalMasuk && finalTanggalMulai && finalTanggalMasuk < finalTanggalMulai) {
      return NextResponse.json({ ok: false, message: 'tanggal_masuk_kerja tidak boleh sebelum tanggal_mulai.' }, { status: 400 });
    }

    const hasUpdate = Object.keys(updateData).length > 0;
    const shouldSyncHandover = handoverIds !== undefined;

    if (!hasUpdate && !shouldSyncHandover) {
      return NextResponse.json({ ok: false, message: 'Tidak ada perubahan yang diberikan.' }, { status: 400 });
    }

    const updated = await db.$transaction(async (tx) => {
      if (hasUpdate) {
        await tx.pengajuanCuti.update({
          where: { id_pengajuan_cuti: id },
          data: updateData,
        });
      }

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

      return tx.pengajuanCuti.findUnique({
        where: { id_pengajuan_cuti: id },
        include: pengajuanInclude,
      });
    });

    return NextResponse.json({ ok: true, message: 'Pengajuan cuti berhasil diperbarui.', data: updated });
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
