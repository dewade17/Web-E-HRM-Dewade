import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';

const SHIFT_STATUS = ['KERJA', 'LIBUR'];

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

function parseBodyDate(value, field) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Field '${field}' harus berupa tanggal yang valid.`);
  }
  return parsed;
}

function buildDateFilter(searchParams, field) {
  const from = searchParams.get(`${field}From`);
  const to = searchParams.get(`${field}To`);
  const filter = {};
  if (from) {
    const parsed = new Date(from);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Parameter '${field}From' tidak valid.`);
    }
    filter.gte = parsed;
  }
  if (to) {
    const parsed = new Date(to);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Parameter '${field}To' tidak valid.`);
    }
    filter.lte = parsed;
  }
  return Object.keys(filter).length > 0 ? filter : undefined;
}

export async function GET(req) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
    const pageSize = Math.min(Math.max(parseInt(searchParams.get('pageSize') || '10', 10), 1), 100);
    const includeDeleted = searchParams.get('includeDeleted') === '1';

    const allowedOrder = new Set(['tanggal_mulai', 'tanggal_selesai', 'created_at', 'updated_at', 'status']);
    const orderByParam = (searchParams.get('orderBy') || 'created_at').trim();
    const orderByField = allowedOrder.has(orderByParam) ? orderByParam : 'created_at';
    const sort = (searchParams.get('sort') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    const where = {
      ...(includeDeleted ? {} : { deleted_at: null }),
    };

    const idUser = (searchParams.get('id_user') || '').trim();
    if (idUser) {
      where.id_user = idUser;
    }

    const idPolaKerjaRaw = searchParams.get('id_pola_kerja');
    if (idPolaKerjaRaw !== null) {
      const trimmed = idPolaKerjaRaw.trim();
      if (trimmed === 'null') {
        where.id_pola_kerja = null;
      } else if (trimmed) {
        where.id_pola_kerja = trimmed;
      }
    }

    const status = (searchParams.get('status') || '').trim();
    if (status) {
      const normalized = status.toUpperCase();
      if (!SHIFT_STATUS.includes(normalized)) {
        return NextResponse.json({ message: "Parameter 'status' tidak valid." }, { status: 400 });
      }
      where.status = normalized;
    }

    const tanggalMulaiFilter = buildDateFilter(searchParams, 'tanggalMulai');
    if (tanggalMulaiFilter) {
      where.tanggal_mulai = tanggalMulaiFilter;
    }

    const tanggalSelesaiFilter = buildDateFilter(searchParams, 'tanggalSelesai');
    if (tanggalSelesaiFilter) {
      where.tanggal_selesai = tanggalSelesaiFilter;
    }

    const [total, data] = await Promise.all([
      db.shiftKerja.count({ where }),
      db.shiftKerja.findMany({
        where,
        orderBy: { [orderByField]: sort },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id_shift_kerja: true,
          id_user: true,
          tanggal_mulai: true,
          tanggal_selesai: true,
          hari_kerja: true,
          status: true,
          id_pola_kerja: true,
          created_at: true,
          updated_at: true,
          deleted_at: true,
          user: {
            select: {
              id_user: true,
              nama_pengguna: true,
              email: true,
            },
          },
          polaKerja: {
            select: {
              id_pola_kerja: true,
              nama_pola_kerja: true,
            },
          },
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
    if (err instanceof Error && err.message.includes('tanggal')) {
      return NextResponse.json({ message: err.message }, { status: 400 });
    }
    console.error('GET /shift-kerja error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}

export async function POST(req) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const body = await req.json();

    const idUser = body.id_user ? String(body.id_user).trim() : '';
    if (!idUser) {
      return NextResponse.json({ message: "Field 'id_user' wajib diisi." }, { status: 400 });
    }
    const userExists = await db.user.findUnique({ where: { id_user: idUser }, select: { id_user: true } });
    if (!userExists) {
      return NextResponse.json({ message: 'User tidak ditemukan.' }, { status: 404 });
    }

    const hariKerja = body.hari_kerja ? String(body.hari_kerja).trim() : '';
    if (!hariKerja) {
      return NextResponse.json({ message: "Field 'hari_kerja' wajib diisi." }, { status: 400 });
    }

    const statusRaw = body.status ? String(body.status).toUpperCase().trim() : '';
    if (!SHIFT_STATUS.includes(statusRaw)) {
      return NextResponse.json({ message: "Field 'status' tidak valid." }, { status: 400 });
    }

    let tanggalMulai;
    let tanggalSelesai;
    try {
      tanggalMulai = parseBodyDate(body.tanggal_mulai, 'tanggal_mulai');
      tanggalSelesai = parseBodyDate(body.tanggal_selesai, 'tanggal_selesai');
    } catch (parseErr) {
      return NextResponse.json({ message: parseErr.message }, { status: 400 });
    }

    if (tanggalMulai instanceof Date && tanggalSelesai instanceof Date && tanggalSelesai < tanggalMulai) {
      return NextResponse.json({ message: "Field 'tanggal_selesai' tidak boleh lebih awal dari 'tanggal_mulai'." }, { status: 400 });
    }

    let idPolaKerja = null;
    if (body.id_pola_kerja !== undefined) {
      if (body.id_pola_kerja === null || body.id_pola_kerja === '') {
        idPolaKerja = null;
      } else {
        idPolaKerja = String(body.id_pola_kerja).trim();
        if (!idPolaKerja) {
          return NextResponse.json({ message: "Field 'id_pola_kerja' tidak valid." }, { status: 400 });
        }
        const polaExists = await db.polaKerja.findUnique({
          where: { id_pola_kerja: idPolaKerja },
          select: { id_pola_kerja: true },
        });
        if (!polaExists) {
          return NextResponse.json({ message: 'Pola kerja tidak ditemukan.' }, { status: 404 });
        }
      }
    }

    const created = await db.shiftKerja.create({
      data: {
        id_user: idUser,
        hari_kerja: hariKerja,
        status: statusRaw,
        tanggal_mulai: tanggalMulai ?? null,
        tanggal_selesai: tanggalSelesai ?? null,
        id_pola_kerja: idPolaKerja,
      },
      select: {
        id_shift_kerja: true,
        id_user: true,
        tanggal_mulai: true,
        tanggal_selesai: true,
        hari_kerja: true,
        status: true,
        id_pola_kerja: true,
        created_at: true,
      },
    });

    return NextResponse.json({ message: 'Shift kerja dibuat.', data: created }, { status: 201 });
  } catch (err) {
    console.error('POST /shift-kerja error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
