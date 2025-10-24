import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { ensureAuth, parseTagUserIds } from '../route';

const APPROVE_STATUSES = new Set(['disetujui', 'ditolak', 'pending', 'menunggu']);
const ADMIN_ROLES = new Set(['HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN']);

const baseInclude = {
  user: {
    select: {
      id_user: true,
      nama_pengguna: true,
      email: true,
      role: true,
    },
  },
  kategori: {
    select: {
      id_kategori_sakit: true,
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
};

const normRole = (role) =>
  String(role || '')
    .trim()
    .toUpperCase();
const isAdminRole = (role) => ADMIN_ROLES.has(normRole(role));

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

function normalizeLampiranInput(value) {
  if (value === undefined) return undefined;
  if (isNullLike(value)) return null;
  return String(value).trim();
}

async function validateTaggedUsers(userIds) {
  if (!userIds || !userIds.length) return;
  const uniqueIds = Array.from(new Set(userIds));
  const found = await db.user.findMany({
    where: { id_user: { in: uniqueIds }, deleted_at: null },
    select: { id_user: true },
  });
  if (found.length !== uniqueIds.length) {
    const missing = uniqueIds.filter((id) => !found.some((u) => u.id_user === id));
    throw NextResponse.json({ message: `User berikut tidak ditemukan: ${missing.join(', ')}` }, { status: 400 });
  }
}

async function getPengajuanOr404(rawId) {
  const id = String(rawId || '').trim();
  if (!id) {
    return NextResponse.json({ message: 'Pengajuan izin sakit tidak ditemukan.' }, { status: 404 });
  }

  const pengajuan = await db.pengajuanIzinSakit.findFirst({
    where: { id_pengajuan_izin_sakit: id, deleted_at: null },
    include: baseInclude,
  });

  if (!pengajuan) {
    return NextResponse.json({ message: 'Pengajuan izin sakit tidak ditemukan.' }, { status: 404 });
  }

  return pengajuan;
}

export async function GET(_req, { params }) {
  try {
    const pengajuan = await getPengajuanOr404(params?.id);
    if (pengajuan instanceof NextResponse) return pengajuan;

    return NextResponse.json({ message: 'Detail pengajuan izin sakit berhasil diambil.', data: pengajuan });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    console.error('GET /mobile/pengajuan-izin-sakit/:id error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function PUT(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  const actorRole = auth.actor?.role;
  if (!actorId) {
    return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const pengajuan = await getPengajuanOr404(params?.id);
    if (pengajuan instanceof NextResponse) return pengajuan;

    if (pengajuan.id_user !== actorId && !isAdminRole(actorRole)) {
      return NextResponse.json({ message: 'Forbidden.' }, { status: 403 });
    }

    const body = await req.json();
    const data = {};

    if (Object.prototype.hasOwnProperty.call(body, 'id_user')) {
      const nextId = String(body.id_user || '').trim();
      if (!nextId) {
        return NextResponse.json({ message: "Field 'id_user' tidak boleh kosong." }, { status: 400 });
      }
      if (!isAdminRole(actorRole) && nextId !== pengajuan.id_user) {
        return NextResponse.json({ message: 'Forbidden.' }, { status: 403 });
      }

      const targetUser = await db.user.findFirst({
        where: { id_user: nextId, deleted_at: null },
        select: { id_user: true },
      });
      if (!targetUser) {
        return NextResponse.json({ message: 'User tujuan tidak ditemukan.' }, { status: 404 });
      }

      data.id_user = nextId;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'id_kategori_sakit')) {
      const nextKategoriId = String(body.id_kategori_sakit || '').trim();
      if (!nextKategoriId) {
        return NextResponse.json({ message: "Field 'id_kategori_sakit' tidak boleh kosong." }, { status: 400 });
      }

      const kategori = await db.kategoriSakit.findFirst({
        where: { id_kategori_sakit: nextKategoriId, deleted_at: null },
        select: { id_kategori_sakit: true },
      });
      if (!kategori) {
        return NextResponse.json({ message: 'Kategori sakit tidak ditemukan.' }, { status: 404 });
      }

      data.id_kategori_sakit = nextKategoriId;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'handover')) {
      data.handover = isNullLike(body.handover) ? null : String(body.handover).trim();
    }

    if (Object.prototype.hasOwnProperty.call(body, 'status')) {
      const statusRaw = String(body.status || '')
        .trim()
        .toLowerCase();
      if (!APPROVE_STATUSES.has(statusRaw)) {
        return NextResponse.json({ message: 'status tidak valid.' }, { status: 400 });
      }
      data.status = statusRaw;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'current_level')) {
      if (body.current_level === null || body.current_level === undefined || body.current_level === '') {
        data.current_level = null;
      } else {
        const levelNumber = Number(body.current_level);
        if (!Number.isFinite(levelNumber)) {
          return NextResponse.json({ message: 'current_level harus berupa angka.' }, { status: 400 });
        }
        data.current_level = levelNumber;
      }
    }

    if (
      Object.prototype.hasOwnProperty.call(body, 'lampiran_izin_sakit_url') ||
      Object.prototype.hasOwnProperty.call(body, 'lampiran_url') ||
      Object.prototype.hasOwnProperty.call(body, 'lampiran') ||
      Object.prototype.hasOwnProperty.call(body, 'lampiran_izin')
    ) {
      const lampiran = normalizeLampiranInput(body.lampiran_izin_sakit_url ?? body.lampiran_url ?? body.lampiran ?? body.lampiran_izin);
      if (lampiran === undefined) {
        data.lampiran_izin_sakit_url = pengajuan.lampiran_izin_sakit_url;
      } else {
        data.lampiran_izin_sakit_url = lampiran;
      }
    }

    const tagUserIds = parseTagUserIds(body.tag_user_ids ?? body.handover_user_ids);
    if (tagUserIds !== undefined) {
      await validateTaggedUsers(tagUserIds);
    }

    if (!Object.keys(data).length && tagUserIds === undefined) {
      return NextResponse.json({ message: 'Tidak ada perubahan yang dilakukan.', data: pengajuan });
    }

    const updated = await db.$transaction(async (tx) => {
      const saved = await tx.pengajuanIzinSakit.update({
        where: { id_pengajuan_izin_sakit: pengajuan.id_pengajuan_izin_sakit },
        data,
      });

      if (tagUserIds !== undefined) {
        await tx.handoverIzinSakit.deleteMany({
          where: {
            id_pengajuan_izin_sakit: saved.id_pengajuan_izin_sakit,
            ...(tagUserIds.length ? { id_user_tagged: { notIn: tagUserIds } } : {}),
          },
        });

        if (tagUserIds.length) {
          const existing = await tx.handoverIzinSakit.findMany({
            where: {
              id_pengajuan_izin_sakit: saved.id_pengajuan_izin_sakit,
              id_user_tagged: { in: tagUserIds },
            },
            select: { id_user_tagged: true },
          });
          const existingSet = new Set(existing.map((item) => item.id_user_tagged));
          const toCreate = tagUserIds
            .filter((id) => !existingSet.has(id))
            .map((id) => ({
              id_pengajuan_izin_sakit: saved.id_pengajuan_izin_sakit,
              id_user_tagged: id,
            }));

          if (toCreate.length) {
            await tx.handoverIzinSakit.createMany({ data: toCreate, skipDuplicates: true });
          }
        }
      }

      return tx.pengajuanIzinSakit.findUnique({
        where: { id_pengajuan_izin_sakit: saved.id_pengajuan_izin_sakit },
        include: baseInclude,
      });
    });

    return NextResponse.json({ message: 'Pengajuan izin sakit berhasil diperbarui.', data: updated });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    if (err?.code === 'P2003') {
      return NextResponse.json({ message: 'Data referensi tidak valid.' }, { status: 400 });
    }
    console.error('PUT /mobile/pengajuan-izin-sakit/:id error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  const actorRole = auth.actor?.role;
  if (!actorId) {
    return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const pengajuan = await getPengajuanOr404(params?.id);
    if (pengajuan instanceof NextResponse) return pengajuan;

    if (pengajuan.id_user !== actorId && !isAdminRole(actorRole)) {
      return NextResponse.json({ message: 'Forbidden.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const hard = searchParams.get('hard');

    if (hard === '1' || hard === 'true') {
      await db.pengajuanIzinSakit.delete({ where: { id_pengajuan_izin_sakit: pengajuan.id_pengajuan_izin_sakit } });
      return NextResponse.json({
        message: 'Pengajuan izin sakit dihapus permanen.',
        data: { id: pengajuan.id_pengajuan_izin_sakit, deleted: true, hard: true },
      });
    }

    await db.pengajuanIzinSakit.update({
      where: { id_pengajuan_izin_sakit: pengajuan.id_pengajuan_izin_sakit },
      data: { deleted_at: new Date() },
    });

    return NextResponse.json({
      message: 'Pengajuan izin sakit berhasil dihapus.',
      data: { id: pengajuan.id_pengajuan_izin_sakit, deleted: true, hard: false },
    });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    console.error('DELETE /mobile/pengajuan-izin-sakit/:id error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export { getPengajuanOr404 };
