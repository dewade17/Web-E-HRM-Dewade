// app/api/admin/kategori-sop/route.js
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';

const ADMIN_ROLES = new Set(['HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN', 'SUBADMIN', 'SUPERVISI']);
const ALLOWED_ORDER_BY = new Set(['created_at', 'updated_at', 'nama_kategori']);

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

export async function GET(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;
  const forbidden = guardAdmin(auth.actor);
  if (forbidden) return forbidden;

  const kategori = getKategoriDelegate();
  if (!kategori) {
    return NextResponse.json({ message: 'Prisma model kategori_sop tidak ditemukan. Pastikan schema + prisma generate sudah benar.' }, { status: 500 });
  }

  try {
    const { searchParams } = new URL(req.url);

    const search = (searchParams.get('search') || '').trim();
    const includeDeleted = ['1', 'true'].includes((searchParams.get('includeDeleted') || '').toLowerCase());
    const deletedOnly = ['1', 'true'].includes((searchParams.get('deletedOnly') || '').toLowerCase());

    const orderByParam = (searchParams.get('orderBy') || 'created_at').trim();
    const orderBy = ALLOWED_ORDER_BY.has(orderByParam) ? orderByParam : 'created_at';
    const sort = (searchParams.get('sort') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    const all = ['1', 'true'].includes((searchParams.get('all') || '').toLowerCase());
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
    const pageSize = Math.min(Math.max(parseInt(searchParams.get('pageSize') || '10', 10), 1), 100);

    const where = {
      ...(deletedOnly ? { deleted_at: { not: null } } : {}),
      ...(!includeDeleted && !deletedOnly ? { deleted_at: null } : {}),
      ...(search
        ? {
            OR: [{ nama_kategori: { contains: search, mode: 'insensitive' } }],
          }
        : {}),
    };

    if (all) {
      const items = await kategori.findMany({
        where,
        orderBy: { [orderBy]: sort },
        select: {
          id_kategori_sop: true,
          nama_kategori: true,
          created_at: true,
          updated_at: true,
          deleted_at: true,
        },
      });

      return NextResponse.json({ total: items.length, items });
    }

    const skip = (page - 1) * pageSize;

    const [total, items] = await db.$transaction([
      kategori.count({ where }),
      kategori.findMany({
        where,
        orderBy: { [orderBy]: sort },
        skip,
        take: pageSize,
        select: {
          id_kategori_sop: true,
          nama_kategori: true,
          created_at: true,
          updated_at: true,
          deleted_at: true,
        },
      }),
    ]);

    return NextResponse.json({
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      items,
    });
  } catch (err) {
    console.error('GET /admin/kategori-sop error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function POST(req) {
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
    const nama_kategori = typeof body?.nama_kategori === 'string' ? body.nama_kategori.trim() : '';
    if (!nama_kategori) {
      return NextResponse.json({ message: "Field 'nama_kategori' wajib diisi." }, { status: 400 });
    }

    const created = await kategori.create({
      data: {
        nama_kategori,
      },
      select: {
        id_kategori_sop: true,
        nama_kategori: true,
        created_at: true,
        updated_at: true,
        deleted_at: true,
      },
    });

    return NextResponse.json({ message: 'Kategori SOP dibuat.', data: created }, { status: 201 });
  } catch (err) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ message: 'Kategori SOP sudah terdaftar.' }, { status: 409 });
    }
    console.error('POST /admin/kategori-sop error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}
