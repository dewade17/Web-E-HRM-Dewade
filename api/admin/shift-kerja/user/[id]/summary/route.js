import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { parseDateOnlyToUTC } from '@/helpers/date-helper';

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

function parseDateParam(value, field) {
  if (value === null) {
    const today = new Date();
    const utc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    return utc;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Parameter '${field}' tidak boleh kosong.`);
  }
  const parsed = parseDateOnlyToUTC(trimmed);
  if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) {
    throw new Error(`Parameter '${field}' harus berupa tanggal yang valid (YYYY-MM-DD).`);
  }
  return parsed;
}

function buildDateFilter(searchParams, field) {
  const from = searchParams.get(`${field}From`);
  const to = searchParams.get(`${field}To`);
  const filter = {};
  if (from) {
    const parsed = parseDateOnlyToUTC(from);
    if (!(parsed instanceof Date)) {
      throw new Error(`Parameter '${field}From' tidak valid.`);
    }
    filter.gte = parsed;
  }
  if (to) {
    const parsed = parseDateOnlyToUTC(to);
    if (!(parsed instanceof Date)) {
      throw new Error(`Parameter '${field}To' tidak valid.`);
    }
    filter.lte = parsed;
  }
  return Object.keys(filter).length > 0 ? filter : undefined;
}

function clampLimit(raw) {
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return 50;
  return Math.min(Math.max(parsed, 1), 200);
}

export async function GET(req) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const { searchParams } = new URL(req.url);
    const includeDeleted = searchParams.get('includeDeleted') === '1';

    const baseWhere = {
      ...(includeDeleted ? {} : { deleted_at: null }),
    };

    const idUser = (searchParams.get('id_user') || '').trim();
    if (idUser) {
      baseWhere.id_user = idUser;
    }

    const idPolaKerjaRaw = searchParams.get('id_pola_kerja');
    if (idPolaKerjaRaw !== null) {
      const trimmed = idPolaKerjaRaw.trim();
      if (trimmed === 'null') {
        baseWhere.id_pola_kerja = null;
      } else if (trimmed) {
        baseWhere.id_pola_kerja = trimmed;
      }
    }
    const status = (searchParams.get('status') || '').trim();
    let statusFilter = 'KERJA';
    if (status) {
      const normalized = status.toUpperCase();
      if (!SHIFT_STATUS.includes(normalized)) {
        return NextResponse.json({ message: "Parameter 'status' tidak valid." }, { status: 400 });
      }
      statusFilter = normalized;
    }

    const tanggalMulaiFilter = buildDateFilter(searchParams, 'tanggalMulai');
    if (tanggalMulaiFilter) {
      baseWhere.tanggal_mulai = tanggalMulaiFilter;
    }

    const tanggalSelesaiFilter = buildDateFilter(searchParams, 'tanggalSelesai');
    if (tanggalSelesaiFilter) {
      baseWhere.tanggal_selesai = tanggalSelesaiFilter;
    }

    const dateParam = searchParams.get('date');
    let targetDate;
    try {
      targetDate = parseDateParam(dateParam, 'date');
    } catch (err) {
      return NextResponse.json({ message: err.message }, { status: 400 });
    }

    const limit = clampLimit(searchParams.get('limit') || '50');
    const sortDirection = (searchParams.get('sort') || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';

    const overlapConditions = [{ OR: [{ tanggal_mulai: null }, { tanggal_mulai: { lte: targetDate } }] }, { OR: [{ tanggal_selesai: null }, { tanggal_selesai: { gte: targetDate } }] }];

    const existingAnd = Array.isArray(baseWhere.AND) ? [...baseWhere.AND] : [];
    const datasetWhere = {
      ...baseWhere,
      status: statusFilter,
      AND: [...existingAnd, ...overlapConditions],
    };

    const data = await db.shiftKerja.findMany({
      where: datasetWhere,
      orderBy: [{ tanggal_mulai: sortDirection }, { updated_at: 'desc' }],
      take: limit,
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
            jam_mulai: true,
            jam_selesai: true,
            jam_istirahat_mulai: true,
            jam_istirahat_selesai: true,
            maks_jam_istirahat: true,
          },
        },
      },
    });

    const total = data.length;

    const statusCounts = SHIFT_STATUS.reduce((acc, key) => ({ ...acc, [key]: 0 }), {});

    for (const item of data) {
      statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;
    }
    const activeDate = targetDate.toISOString().slice(0, 10);

    return NextResponse.json({
      summary: {
        total,
        status: statusCounts,
        activeOn: {
          date: activeDate,
          total,
        },
      },
      date: activeDate,
      total,
      data,
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('tanggal')) {
      return NextResponse.json({ message: err.message }, { status: 400 });
    }
    console.error('GET /shift-kerja/summary error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
