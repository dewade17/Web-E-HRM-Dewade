import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { parseDateOnlyToUTC } from '@/helpers/date-helper';

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

async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const payload = verifyAuthToken(auth.slice(7));
      const id = payload?.sub || payload?.id_user || payload?.userId;
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
    return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
  }

  return {
    actor: {
      id,
      role: sessionOrRes?.user?.role,
      source: 'session',
      session: sessionOrRes,
    },
  };
}

function parseTagUserIds(raw) {
  if (raw === undefined) return undefined;
  if (raw === null) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const set = new Set();
  for (const value of arr) {
    const str = String(value || '').trim();
    if (str) set.add(str);
  }
  return Array.from(set);
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

async function getPengajuanOr404(id) {
  const pengajuan = await db.izinTukarHari.findFirst({
    where: { id_izin_tukar_hari: id, deleted_at: null },
    include: baseInclude,
  });
  if (!pengajuan) {
    return NextResponse.json({ message: 'Pengajuan izin tukar hari tidak ditemukan.' }, { status: 404 });
  }
  return pengajuan;
}

export async function GET(_req, { params }) {
  try {
    const pengajuan = await getPengajuanOr404(params.id);
    if (pengajuan instanceof NextResponse) return pengajuan;
    return NextResponse.json({ ok: true, data: pengajuan });
  } catch (err) {
    console.error('GET /mobile/pengajuan-izin-tukar-hari/:id error:', err);
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
    const pengajuan = await getPengajuanOr404(params.id);
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

    if (Object.prototype.hasOwnProperty.call(body, 'hari_izin')) {
      const parsed = parseDateOnlyToUTC(body.hari_izin);
      if (!parsed) {
        return NextResponse.json({ message: "Field 'hari_izin' harus berupa tanggal yang valid." }, { status: 400 });
      }
      data.hari_izin = parsed;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'hari_pengganti')) {
      const parsed = parseDateOnlyToUTC(body.hari_pengganti);
      if (!parsed) {
        return NextResponse.json({ message: "Field 'hari_pengganti' harus berupa tanggal yang valid." }, { status: 400 });
      }
      data.hari_pengganti = parsed;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'kategori')) {
      const kategori = String(body.kategori || '').trim();
      if (!kategori) {
        return NextResponse.json({ message: "Field 'kategori' tidak boleh kosong." }, { status: 400 });
      }
      data.kategori = kategori;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'keperluan')) {
      data.keperluan = isNullLike(body.keperluan) ? null : String(body.keperluan).trim();
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

    const tagUserIds = parseTagUserIds(body.tag_user_ids);
    if (tagUserIds !== undefined) {
      await validateTaggedUsers(tagUserIds);
    }

    const updated = await db.$transaction(async (tx) => {
      const saved = await tx.izinTukarHari.update({
        where: { id_izin_tukar_hari: pengajuan.id_izin_tukar_hari },
        data,
      });

      if (tagUserIds !== undefined) {
        await tx.handoverTukarHari.deleteMany({
          where: {
            id_izin_tukar_hari: saved.id_izin_tukar_hari,
            ...(tagUserIds.length ? { id_user_tagged: { notIn: tagUserIds } } : {}),
          },
        });

        if (tagUserIds.length) {
          const existing = await tx.handoverTukarHari.findMany({
            where: {
              id_izin_tukar_hari: saved.id_izin_tukar_hari,
              id_user_tagged: { in: tagUserIds },
            },
            select: { id_user_tagged: true },
          });
          const existingSet = new Set(existing.map((item) => item.id_user_tagged));
          const toCreate = tagUserIds
            .filter((id) => !existingSet.has(id))
            .map((id) => ({
              id_izin_tukar_hari: saved.id_izin_tukar_hari,
              id_user_tagged: id,
            }));

          if (toCreate.length) {
            await tx.handoverTukarHari.createMany({ data: toCreate, skipDuplicates: true });
          }
        }
      }

      return tx.izinTukarHari.findUnique({
        where: { id_izin_tukar_hari: saved.id_izin_tukar_hari },
        include: baseInclude,
      });
    });

    return NextResponse.json({ message: 'Pengajuan izin tukar hari berhasil diperbarui.', data: updated });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    if (err?.code === 'P2003') {
      return NextResponse.json({ message: 'Data referensi tidak valid.' }, { status: 400 });
    }
    console.error('PUT /mobile/pengajuan-izin-tukar-hari/:id error:', err);
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
    const pengajuan = await getPengajuanOr404(params.id);
    if (pengajuan instanceof NextResponse) return pengajuan;

    if (pengajuan.id_user !== actorId && !isAdminRole(actorRole)) {
      return NextResponse.json({ message: 'Forbidden.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const hard = searchParams.get('hard');

    if (hard === '1' || hard === 'true') {
      await db.izinTukarHari.delete({ where: { id_izin_tukar_hari: pengajuan.id_izin_tukar_hari } });
      return NextResponse.json({
        message: 'Pengajuan izin tukar hari dihapus permanen.',
        data: { id: pengajuan.id_izin_tukar_hari, deleted: true, hard: true },
      });
    }

    await db.izinTukarHari.update({
      where: { id_izin_tukar_hari: pengajuan.id_izin_tukar_hari },
      data: { deleted_at: new Date() },
    });

    return NextResponse.json({
      message: 'Pengajuan izin tukar hari berhasil dihapus.',
      data: { id: pengajuan.id_izin_tukar_hari, deleted: true, hard: false },
    });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    console.error('DELETE /mobile/pengajuan-izin-tukar-hari/:id error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}
