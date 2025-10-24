// app/api/admin/kategori-kunjungan/[id]/restore/route.js
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
    } catch (_) { /* fallback ke NextAuth */ }
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
  const role = String(actor?.role || '').trim().toUpperCase();
  if (role !== 'OPERASIONAL' && role !== 'SUPERADMIN') {
    return NextResponse.json(
      { message: 'Forbidden: hanya role OPERASIONAL/SUPERADMIN yang dapat mengakses resource ini.' },
      { status: 403 }
    );
  }
  return null;
}

export async function PATCH(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;
  const forbidden = guardOperational(auth.actor);
  if (forbidden) return forbidden;

  try {
    const id = params.id;

    const existing = await db.kategoriKunjungan.findUnique({
      where: { id_kategori_kunjungan: id },
      select: { id_kategori_kunjungan: true, deleted_at: true },
    });

    if (!existing) {
      return NextResponse.json({ message: 'Kategori kunjungan tidak ditemukan.' }, { status: 404 });
    }

    if (existing.deleted_at === null) {
      return NextResponse.json({ message: 'Kategori sudah aktif (tidak terhapus).' }, { status: 409 });
    }

    const restored = await db.kategoriKunjungan.update({
      where: { id_kategori_kunjungan: id },
      data: { deleted_at: null },
      select: {
        id_kategori_kunjungan: true,
        kategori_kunjungan: true,
        updated_at: true,
        deleted_at: true,
      },
    });

    return NextResponse.json({ message: 'Kategori dikembalikan (restore) berhasil.', data: restored });
  } catch (err) {
    console.error('PATCH /admin/kategori-kunjungan/[id]/restore error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}
