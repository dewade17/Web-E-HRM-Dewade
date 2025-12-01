import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { parseDateOnlyToUTC } from '@/helpers/date-helper';

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
    return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  }
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`Parameter '${field}' tidak boleh kosong.`);
  const parsed = parseDateOnlyToUTC(trimmed);
  if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) {
    throw new Error(`Parameter '${field}' harus berupa tanggal yang valid (YYYY-MM-DD).`);
  }
  return parsed;
}

function clampLimit(raw) {
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return 50;
  return Math.min(Math.max(n, 1), 200);
}

export async function GET(req) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const { searchParams } = new URL(req.url);
    const includeDeleted = searchParams.get('includeDeleted') === '1';

    const whereBase = {
      ...(includeDeleted ? {} : { deleted_at: null }),
      status: 'KERJA',
    };

    const idUser = (searchParams.get('id_user') || '').trim();
    if (idUser) whereBase.id_user = idUser;

    const idPolaKerjaRaw = searchParams.get('id_pola_kerja');
    if (idPolaKerjaRaw !== null) {
      const trimmed = idPolaKerjaRaw.trim();
      if (trimmed === 'null') whereBase.id_pola_kerja = null;
      else if (trimmed) whereBase.id_pola_kerja = trimmed;
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

    // OVERLAP MURNI (tanpa cabang null)
    const where = {
      ...whereBase,
      AND: [{ tanggal_mulai: { lte: targetDate } }, { tanggal_selesai: { gte: targetDate } }],
    };

    const data = await db.shiftKerja.findMany({
      where,
      orderBy: [{ tanggal_mulai: sortDirection }, { updated_at: 'desc' }, { id_shift_kerja: 'asc' }],
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
        user: { select: { id_user: true, nama_pengguna: true, email: true } },
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

    return NextResponse.json({
      date: targetDate.toISOString().slice(0, 10),
      total: data.length,
      data,
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('tanggal')) {
      return NextResponse.json({ message: err.message }, { status: 400 });
    }
    console.error('GET /shift-kerja/realtime error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
