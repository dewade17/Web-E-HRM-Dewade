import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';

async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      verifyAuthToken(auth.slice(7));
      return true;
    } catch (_) {}
  }
  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;
  return true;
}

function parseDateTime(value, field) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Field '${field}' wajib diisi.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Field '${field}' harus berupa tanggal/waktu yang valid.`);
  }
  return parsed;
}

export async function GET(req) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
    const pageSize = Math.min(Math.max(parseInt(searchParams.get('pageSize') || '10', 10), 1), 100);
    const search = (searchParams.get('search') || '').trim();
    const includeDeleted = searchParams.get('includeDeleted') === '1';

    const allowedOrder = new Set(['nama_pola_kerja', 'jam_mulai', 'jam_selesai', 'created_at', 'updated_at', 'deleted_at']);
    const orderByParam = (searchParams.get('orderBy') || 'created_at').trim();
    const orderByField = allowedOrder.has(orderByParam) ? orderByParam : 'created_at';
    const sort = (searchParams.get('sort') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    const where = {
      ...(includeDeleted ? {} : { deleted_at: null }),
      ...(search ? { nama_pola_kerja: { contains: search, mode: 'insensitive' } } : {}),
    };

    const [total, data] = await Promise.all([
      db.polaKerja.count({ where }),
      db.polaKerja.findMany({
        where,
        orderBy: { [orderByField]: sort },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id_pola_kerja: true,
          nama_pola_kerja: true,
          jam_mulai: true,
          jam_selesai: true,
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
    console.error('GET /pola-kerja error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}

export async function POST(req) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const body = await req.json();
    const nama = body.nama_pola_kerja !== undefined ? String(body.nama_pola_kerja).trim() : '';
    if (!nama) {
      return NextResponse.json({ message: "Field 'nama_pola_kerja' wajib diisi." }, { status: 400 });
    }

    let jamMulai;
    let jamSelesai;
    try {
      jamMulai = parseDateTime(body.jam_mulai, 'jam_mulai');
      jamSelesai = parseDateTime(body.jam_selesai, 'jam_selesai');
    } catch (parseErr) {
      return NextResponse.json({ message: parseErr.message }, { status: 400 });
    }

    if (jamSelesai < jamMulai) {
      return NextResponse.json({ message: "Field 'jam_selesai' tidak boleh lebih awal dari 'jam_mulai'." }, { status: 400 });
    }

    const created = await db.polaKerja.create({
      data: {
        nama_pola_kerja: nama,
        jam_mulai: jamMulai,
        jam_selesai: jamSelesai,
      },
      select: {
        id_pola_kerja: true,
        nama_pola_kerja: true,
        jam_mulai: true,
        jam_selesai: true,
        created_at: true,
      },
    });

    return NextResponse.json({ message: 'Pola kerja dibuat.', data: created }, { status: 201 });
  } catch (err) {
    console.error('POST /pola-kerja error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
