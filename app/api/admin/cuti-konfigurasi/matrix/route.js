// app/api/admin/cuti-konfigurasi/route.js
import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';

const ALLOWED_MONTHS = new Set(['JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI', 'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER']);

async function ensureAuth(req) {
  /* sama seperti versi kamu */
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const payload = verifyAuthToken(auth.slice(7));
      return { actor: { id: payload?.sub || payload?.id_user || payload?.userId, role: payload?.role, source: 'bearer' } };
    } catch (_) {}
  }
  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;
  return { actor: { id: sessionOrRes.user.id, role: sessionOrRes.user.role, source: 'session' } };
}
function guardHr(actor) {
  const role = String(actor?.role || '')
    .trim()
    .toUpperCase();
  if (!['HR', 'OPERASIONAL', 'SUPERADMIN'].includes(role)) {
    return NextResponse.json({ message: 'Forbidden: hanya HR/OPERASIONAL/SUPERADMIN yang dapat mengakses resource ini.' }, { status: 403 });
  }
  return null;
}

const ALLOWED_ORDER_BY = new Set(['created_at', 'updated_at', 'bulan', 'kouta_cuti', 'user']);

export async function GET(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;
  const forbidden = guardHr(auth.actor);
  if (forbidden) return forbidden;

  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
    const pageSize = Math.min(Math.max(parseInt(searchParams.get('pageSize') || '10', 10), 1), 100);
    const includeDeleted = ['1', 'true'].includes((searchParams.get('includeDeleted') || '').toLowerCase());
    const search = (searchParams.get('search') || '').trim();
    const userId = (searchParams.get('userId') || '').trim();
    const bulanParam = (searchParams.get('bulan') || '').trim().toUpperCase();
    const bulanFilter = ALLOWED_MONTHS.has(bulanParam) ? bulanParam : null;

    const orderByParam = (searchParams.get('orderBy') || 'created_at').trim();
    const orderBy = ALLOWED_ORDER_BY.has(orderByParam) ? orderByParam : 'created_at';
    const sort = (searchParams.get('sort') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    const where = {
      ...(includeDeleted ? {} : { deleted_at: null }),
      ...(userId ? { id_user: userId } : {}),
      ...(bulanFilter ? { bulan: bulanFilter } : {}),
      ...(search ? { OR: [{ user: { nama_pengguna: { contains: search } } }, { user: { email: { contains: search } } }, { user: { nomor_induk_karyawan: { contains: search } } }] } : {}),
    };

    const orderClause = orderBy === 'user' ? { user: { nama_pengguna: sort } } : { [orderBy]: sort };

    const [total, data] = await Promise.all([
      db.cutiKonfigurasi.count({ where }),
      db.cutiKonfigurasi.findMany({
        where,
        orderBy: orderClause,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id_cuti_konfigurasi: true,
          id_user: true,
          bulan: true,
          kouta_cuti: true,
          created_at: true,
          updated_at: true,
          deleted_at: true,
          user: {
            select: {
              id_user: true,
              nama_pengguna: true,
              email: true,
              nomor_induk_karyawan: true,
              role: true,
            },
          },
        },
      }),
    ]);

    return NextResponse.json({
      data,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (err) {
    console.error('GET /admin/cuti-konfigurasi error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function POST(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;
  const forbidden = guardHr(auth.actor);
  if (forbidden) return forbidden;

  try {
    const body = await req.json();
    const idUser = body?.id_user ? String(body.id_user).trim() : '';
    const bulanInput = body?.bulan ? String(body.bulan).trim().toUpperCase() : '';
    const koutaRaw = body?.kouta_cuti;

    if (!idUser) return NextResponse.json({ message: "Field 'id_user' wajib diisi." }, { status: 400 });
    if (!bulanInput || !ALLOWED_MONTHS.has(bulanInput)) return NextResponse.json({ message: "Field 'bulan' tidak valid." }, { status: 400 });

    const kouta = Number(koutaRaw);
    if (!Number.isInteger(kouta) || kouta < 0) return NextResponse.json({ message: "Field 'kouta_cuti' harus berupa bilangan bulat >= 0." }, { status: 400 });

    const user = await db.user.findUnique({ where: { id_user: idUser }, select: { id_user: true } });
    if (!user) return NextResponse.json({ message: 'User tidak ditemukan.' }, { status: 404 });

    const created = await db.cutiKonfigurasi.create({
      data: { id_user: idUser, bulan: bulanInput, kouta_cuti: kouta },
      select: { id_cuti_konfigurasi: true, id_user: true, bulan: true, kouta_cuti: true, created_at: true },
    });

    return NextResponse.json({ message: 'Konfigurasi cuti dibuat.', data: created }, { status: 201 });
  } catch (err) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ message: 'Konfigurasi cuti untuk user dan bulan tersebut sudah ada.' }, { status: 409 });
    }
    console.error('POST /admin/cuti-konfigurasi error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}
