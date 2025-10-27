// app/api/admin/kategori-sakit/route.js
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

const ALLOWED_ORDER_BY = new Set(['created_at', 'updated_at', 'nama_kategori']);

export async function GET(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(req.url);

    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
    const pageSize = Math.min(Math.max(parseInt(searchParams.get('pageSize') || '10', 10), 1), 100);

    const search = (searchParams.get('search') || '').trim();

    const includeDeleted = ['1', 'true'].includes((searchParams.get('includeDeleted') || '').toLowerCase());
    const deletedOnly = ['1', 'true'].includes((searchParams.get('deletedOnly') || '').toLowerCase());

    const orderByParam = (searchParams.get('orderBy') || 'created_at').trim();
    const orderBy = ALLOWED_ORDER_BY.has(orderByParam) ? orderByParam : 'created_at';
    const sort = (searchParams.get('sort') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    const where = {
      ...(deletedOnly ? { deleted_at: { not: null } } : {}),
      ...(!includeDeleted && !deletedOnly ? { deleted_at: null } : {}),
      ...(search
        ? {
            nama_kategori: {
              contains: search,
            },
          }
        : {}),
    };

    const [total, data] = await Promise.all([
      db.kategoriSakit.count({ where }),
      db.kategoriSakit.findMany({
        where,
        orderBy: { [orderBy]: sort },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id_kategori_sakit: true,
          nama_kategori: true,
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
    console.error('GET /admin/kategori-sakit error:', err);
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
    const rawNama = body?.nama_kategori;

    if (rawNama === undefined || String(rawNama).trim() === '') {
      return NextResponse.json({ message: "Field 'nama_kategori' wajib diisi." }, { status: 400 });
    }

    const nama_kategori = String(rawNama).trim();

    const existing = await db.kategoriSakit.findFirst({
      where: { nama_kategori },
      select: { id_kategori_sakit: true },
    });

    if (existing) {
      return NextResponse.json({ message: 'Kategori sakit sudah terdaftar.' }, { status: 409 });
    }

    const created = await db.kategoriSakit.create({
      data: { nama_kategori },
      select: {
        id_kategori_sakit: true,
        nama_kategori: true,
        created_at: true,
      },
    });

    return NextResponse.json({ message: 'Kategori sakit dibuat.', data: created }, { status: 201 });
  } catch (err) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ message: 'Kategori sakit sudah terdaftar.' }, { status: 409 });
    }
    console.error('POST /admin/kategori-sakit error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}
