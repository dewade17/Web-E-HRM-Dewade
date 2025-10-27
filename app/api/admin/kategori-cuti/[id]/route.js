// app/api/admin/kategori-cuti/[id]/route.js
import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';

async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const payload = verifyAuthToken(auth.slice(7));
      return {
        actor: {
          id: payload?.sub || payload?.id_user || payload?.userId,
          role: payload?.role,
          source: 'bearer',
        },
      };
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

function guardOperational(actor) {
  const role = String(actor?.role || '')
    .trim()
    .toUpperCase();
  if (role !== 'OPERASIONAL' && role !== 'SUPERADMIN') {
    return NextResponse.json({ message: 'Forbidden: hanya role OPERASIONAL/SUPERADMIN yang dapat mengakses resource ini.' }, { status: 403 });
  }
  return null;
}

export async function GET(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = params;

    const data = await db.kategoriCuti.findUnique({
      where: { id_kategori_cuti: id },
      select: {
        id_kategori_cuti: true,
        nama_kategori: true,
        created_at: true,
        updated_at: true,
        deleted_at: true,
      },
    });

    if (!data) {
      return NextResponse.json({ message: 'Kategori cuti tidak ditemukan.' }, { status: 404 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    console.error('GET /admin/kategori-cuti/[id] error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function PUT(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;
  const forbidden = guardOperational(auth.actor);
  if (forbidden) return forbidden;

  try {
    const body = await req.json();
    const payload = {};

    if (Object.prototype.hasOwnProperty.call(body, 'nama_kategori')) {
      if (body.nama_kategori === null || String(body.nama_kategori).trim() === '') {
        return NextResponse.json({ message: "Field 'nama_kategori' tidak boleh kosong." }, { status: 400 });
      }
      payload.nama_kategori = String(body.nama_kategori).trim();
    }

    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ message: 'Tidak ada perubahan yang diberikan.' }, { status: 400 });
    }

    const updated = await db.kategoriCuti.update({
      where: { id_kategori_cuti: params.id },
      data: payload,
      select: {
        id_kategori_cuti: true,
        nama_kategori: true,
        updated_at: true,
      },
    });

    return NextResponse.json({ message: 'Kategori cuti diperbarui.', data: updated });
  } catch (err) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ message: 'Kategori cuti sudah terdaftar.' }, { status: 409 });
    }
    if (err?.code === 'P2025') {
      return NextResponse.json({ message: 'Kategori cuti tidak ditemukan.' }, { status: 404 });
    }
    console.error('PUT /admin/kategori-cuti/[id] error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;
  const forbidden = guardOperational(auth.actor);
  if (forbidden) return forbidden;

  try {
    const { searchParams } = new URL(req.url);
    const isHardDelete = (searchParams.get('hard') || '').toLowerCase() === 'true';

    if (isHardDelete) {
      await db.kategoriCuti.delete({
        where: { id_kategori_cuti: params.id },
      });
      return NextResponse.json({ message: 'Kategori cuti dihapus secara permanen (hard delete).' });
    }

    await db.kategoriCuti.update({
      where: { id_kategori_cuti: params.id },
      data: { deleted_at: new Date() },
    });
    return NextResponse.json({ message: 'Kategori cuti dihapus (soft delete).' });
  } catch (err) {
    if (err?.code === 'P2025') {
      return NextResponse.json({ message: 'Kategori cuti tidak ditemukan.' }, { status: 404 });
    }
    console.error('DELETE /admin/kategori-cuti/[id] error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}
