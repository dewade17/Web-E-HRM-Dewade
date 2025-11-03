import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';

// Autentikasi ringan: izinkan Bearer JWT atau session NextAuth
async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      verifyAuthToken(auth.slice(7));
      return true;
    } catch (_) {
      /* fallback ke session */
    }
  }
  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes; // unauthorized
  return true;
}

// GET /api/mobile/tag-users
// Query: q?=keyword, page?=1.., pageSize?=10..
export async function GET(req) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') || '').trim();
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
    const pageSize = Math.min(Math.max(parseInt(searchParams.get('pageSize') || '20', 10), 1), 50);

    const where = {
      deleted_at: null,
      ...(q
        ? {
            OR: [{ nama_pengguna: { contains: q } }, { email: { contains: q } }, { kontak: { contains: q } }],
          }
        : {}),
    };

    const [total, users] = await Promise.all([
      db.user.count({ where }),
      db.user.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ nama_pengguna: 'asc' }],
        select: {
          id_user: true,
          nama_pengguna: true,
          email: true,
          kontak: true,
          foto_profil_user: true,
          divisi: true,
          id_departement: true,
          departement: { select: { id_departement: true, nama_departement: true } },
          role: true,
        },
      }),
    ]);

    return NextResponse.json({
      data: users,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err) {
    console.error('GET /mobile/tag-users error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}
