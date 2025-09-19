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

export async function GET(req) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const { searchParams } = new URL(req.url);
    const includeDeleted = searchParams.get('includeDeleted') === '1';

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

    const dateParam = searchParams.get('date');
    let targetDate;
    try {
      targetDate = parseDateParam(dateParam, 'date');
    } catch (err) {
      return NextResponse.json({ message: err.message }, { status: 400 });
    }

    const [total, groupedStatus] = await Promise.all([
      db.shiftKerja.count({ where }),
      db.shiftKerja.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
    ]);

    const statusCounts = SHIFT_STATUS.reduce((acc, key) => ({ ...acc, [key]: 0 }), {});

    for (const item of groupedStatus) {
      statusCounts[item.status] = item._count._all;
    }

    let activeCount = 0;
    if (!where.status || where.status === 'KERJA') {
      const baseAnd = [{ OR: [{ tanggal_mulai: null }, { tanggal_mulai: { lte: targetDate } }] }, { OR: [{ tanggal_selesai: null }, { tanggal_selesai: { gte: targetDate } }] }];

      const activeWhere = {
        ...where,
        status: 'KERJA',
        AND: baseAnd,
      };

      activeCount = await db.shiftKerja.count({ where: activeWhere });
    }

    return NextResponse.json({
      summary: {
        total,
        status: statusCounts,
        activeOn: {
          date: targetDate.toISOString().slice(0, 10),
          total: activeCount,
        },
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('tanggal')) {
      return NextResponse.json({ message: err.message }, { status: 400 });
    }
    console.error('GET /shift-kerja/summary error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
