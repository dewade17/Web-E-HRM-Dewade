// app/api/admin/kategori-sop/[id]/route.js
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';

const ADMIN_ROLES = new Set(['HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN', 'SUBADMIN', 'SUPERVISI']);

function getKategoriDelegate() {
  return db?.kategori_sop || db?.kategoriSop || null;
}

async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    try {
      const payload = await verifyAuthToken(token);
      const id = payload?.sub || payload?.id_user || payload?.userId || payload?.id;
      const role = payload?.role || payload?.jabatan || payload?.level || payload?.akses;
      if (id && role) {
        return {
          actor: {
            id: String(id),
            role: String(role).toUpperCase(),
            source: 'token',
          },
        };
      }
    } catch (_) {
      /* fallback ke NextAuth */
    }
  }

  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;

  return {
    actor: {
      id: sessionOrRes.user.id,
      role: sessionOrRes.user.role,
      source: 'session',
    },
  };
}

function guardAdmin(actor) {
  const role = String(actor?.role || '').toUpperCase();
  if (!ADMIN_ROLES.has(role)) {
    return NextResponse.json({ message: 'Forbidden: hanya admin yang dapat mengakses resource ini.' }, { status: 403 });
  }
  return null;
}

export async function GET(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;
  const forbidden = guardAdmin(auth.actor);
  if (forbidden) return forbidden;

  const kategori = getKategoriDelegate();
  if (!kategori) {
    return NextResponse.json({ message: 'Prisma model kategori_sop tidak ditemukan. Pastikan schema + prisma generate sudah benar.' }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const includeDeleted = ['1', 'true'].includes((searchParams.get('includeDeleted') || '').toLowerCase());

  try {
    const data = await kategori.findFirst({
      where: {
        id_kategori_sop: params.id,
        ...(!includeDeleted ? { deleted_at: null } : {}),
      },
      select: {
        id_kategori_sop: true,
        nama_kategori: true,
        created_at: true,
        updated_at: true,
        deleted_at: true,
      },
    });

    if (!data) {
      return NextResponse.json({ message: 'Kategori SOP tidak ditemukan.' }, { status: 404 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    console.error('GET /admin/kategori-sop/[id] error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function PUT(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;
  const forbidden = guardAdmin(auth.actor);
  if (forbidden) return forbidden;

  const kategori = getKategoriDelegate();
  if (!kategori) {
    return NextResponse.json({ message: 'Prisma model kategori_sop tidak ditemukan. Pastikan schema + prisma generate sudah benar.' }, { status: 500 });
  }

  let body;
  try {
    body = await req.json();
  } catch (_) {
    return NextResponse.json({ message: 'Body JSON tidak valid.' }, { status: 400 });
  }

  try {
    const exists = await kategori.findFirst({
      where: { id_kategori_sop: params.id },
      select: { id_kategori_sop: true },
    });

    if (!exists) {
      return NextResponse.json({ message: 'Kategori SOP tidak ditemukan.' }, { status: 404 });
    }

    const payload = {};

    if (Object.prototype.hasOwnProperty.call(body, 'nama_kategori')) {
      const nama_kategori = typeof body.nama_kategori === 'string' ? body.nama_kategori.trim() : '';
      if (!nama_kategori) {
        return NextResponse.json({ message: "Field 'nama_kategori' tidak boleh kosong." }, { status: 400 });
      }
      payload.nama_kategori = String(body.nama_kategori).trim();
    }

    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ message: 'Tidak ada field yang diupdate.' }, { status: 400 });
    }

    const updated = await kategori.update({
      where: { id_kategori_sop: params.id },
      data: payload,
      select: {
        id_kategori_sop: true,
        nama_kategori: true,
        created_at: true,
        updated_at: true,
        deleted_at: true,
      },
    });

    return NextResponse.json({ message: 'Kategori SOP diupdate.', data: updated });
  } catch (err) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ message: 'Kategori SOP sudah terdaftar.' }, { status: 409 });
    }
    console.error('PUT /admin/kategori-sop/[id] error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;
  const forbidden = guardAdmin(auth.actor);
  if (forbidden) return forbidden;

  const kategori = getKategoriDelegate();
  if (!kategori) {
    return NextResponse.json({ message: 'Prisma model kategori_sop tidak ditemukan. Pastikan schema + prisma generate sudah benar.' }, { status: 500 });
  }

  try {
    const exists = await kategori.findFirst({
      where: { id_kategori_sop: params.id },
      select: { id_kategori_sop: true, deleted_at: true },
    });

    if (!exists) {
      return NextResponse.json({ message: 'Kategori SOP tidak ditemukan.' }, { status: 404 });
    }

    if (exists.deleted_at) {
      return NextResponse.json({ message: 'Kategori SOP sudah dihapus.' }, { status: 400 });
    }

    const deleted = await kategori.update({
      where: { id_kategori_sop: params.id },
      data: { deleted_at: new Date() },
      select: {
        id_kategori_sop: true,
        nama_kategori: true,
        created_at: true,
        updated_at: true,
        deleted_at: true,
      },
    });

    return NextResponse.json({ message: 'Kategori SOP dihapus (soft delete).', data: deleted });
  } catch (err) {
    console.error('DELETE /admin/kategori-sop/[id] error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}
