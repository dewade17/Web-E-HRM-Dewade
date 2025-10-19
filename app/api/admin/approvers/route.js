// app/api/admin/approvers/route.js
import { NextResponse } from 'next/server';
import db from '../../../../lib/prisma';
import { verifyAuthToken } from '../../../../lib/jwt';
import { authenticateRequest } from '../../../../app/utils/auth/authUtils';

async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      verifyAuthToken(auth.slice(7));
      return true;
    } catch {
      /* fallback ke NextAuth */
    }
  }
  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes; // unauthorized
  return true;
}

export async function GET(req) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const { searchParams } = new URL(req.url);

    // roles=HR,DIREKTUR,OPERASIONAL (default HR+DIREKTUR)
    const rawRoles = (searchParams.get('roles') || 'HR,DIREKTUR,OPERASIONAL,SUPERADMIN')
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);

    const allowed = ['HR', 'DIREKTUR', 'OPERASIONAL', 'SUPERADMIN'];
    let roles = rawRoles.filter((r) => allowed.includes(r));
    if (roles.length === 0) roles = ['HR', 'DIREKTUR'];

    const q = (searchParams.get('search') || '').trim();
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
    const pageSize = Math.min(Math.max(parseInt(searchParams.get('pageSize') || '20', 10), 1), 50);
    const includeDeleted = searchParams.get('includeDeleted') === '1';

    const where = {
      ...(includeDeleted ? {} : { deleted_at: null }),
      role: { in: roles },
      ...(q
        ? {
            OR: [{ nama_pengguna: { contains: q } }, { email: { contains: q } }],
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
          role: true,
          foto_profil_user: true,
          created_at: true,
          updated_at: true,
        },
      }),
    ]);

    return NextResponse.json({
      users,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
      filters: { roles },
    });
  } catch (err) {
    console.error('GET /approvers error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
