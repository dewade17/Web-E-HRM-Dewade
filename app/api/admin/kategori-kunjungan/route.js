// app/api/admin/kategori-kunjungan/route.js
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

const ALLOWED_ORDER_BY = new Set(['created_at', 'updated_at', 'kategori_kunjungan']);

export async function GET(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(req.url);

    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
    const pageSize = Math.min(Math.max(parseInt(searchParams.get('pageSize') || '10', 10), 1), 100);

    const search = (searchParams.get('search') || '').trim();

    // includeDeleted=1 => aktif+terhapus
    const includeDeleted = ['1', 'true'].includes((searchParams.get('includeDeleted') || '').toLowerCase());
    // deletedOnly=1 => hanya yang terhapus
    const deletedOnly = ['1', 'true'].includes((searchParams.get('deletedOnly') || '').toLowerCase());

    const orderByParam = (searchParams.get('orderBy') || 'created_at').trim();
    const orderBy = ALLOWED_ORDER_BY.has(orderByParam) ? orderByParam : 'created_at';
    const sort = (searchParams.get('sort') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    // where
    const where = {
      ...(deletedOnly ? { deleted_at: { not: null } } : {}),
      ...(!includeDeleted && !deletedOnly ? { deleted_at: null } : {}),
      ...(search
        ? {
            kategori_kunjungan: {
              contains: search,
            },
          }
        : {}),
    };

    const [total, data] = await Promise.all([
      db.kategoriKunjungan.count({ where }),
      db.kategoriKunjungan.findMany({
        where,
        orderBy: { [orderBy]: sort },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id_kategori_kunjungan: true,
          kategori_kunjungan: true,
          created_at: true,
          updated_at: true,
          deleted_at: true,
        },
      }),
    ]);

    return NextResponse.json({
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err) {
    console.error('GET /admin/kategori-kunjungan error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function POST(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;
  const forbidden = guardOperational(auth.actor);
  if (forbidden) return forbidden;

  try {
    const body = await req.json();
    const rawKategori = body.kategori_kunjungan;

    if (rawKategori === undefined || String(rawKategori).trim() === '') {
      return NextResponse.json({ message: "Field 'kategori_kunjungan' wajib diisi." }, { status: 400 });
    }

    const kategori_kunjungan = String(rawKategori).trim();

    const created = await db.kategoriKunjungan.create({
      data: { kategori_kunjungan },
      select: {
        id_kategori_kunjungan: true,
        kategori_kunjungan: true,
        created_at: true,
      },
    });

    return NextResponse.json({ message: 'Kategori kunjungan dibuat.', data: created }, { status: 201 });
  } catch (err) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ message: 'Kategori kunjungan sudah terdaftar.' }, { status: 409 });
    }
    console.error('POST /admin/kategori-kunjungan error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}
