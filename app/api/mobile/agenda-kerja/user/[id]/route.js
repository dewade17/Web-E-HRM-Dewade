// app/api/mobile/agenda-kerja/user/[id]/route.js
// GET /api/mobile/agenda-kerja/user/:id?status=...&from=...&to=...&has_absensi=1|0&limit=50&offset=0

import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { parseDateTimeToUTC } from '@/helpers/date-helper';

const VALID_STATUS = ['diproses', 'ditunda', 'selesai'];

function toDateOrNull(v) {
  if (!v) return null;
  const parsed = parseDateTimeToUTC(v);
  return parsed ?? null;
}

// Autentikasi (Bearer JWT atau NextAuth session)
async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      verifyAuthToken(auth.slice(7));
      return true;
    } catch {
      // fallback ke NextAuth
    }
  }
  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes; // unauthorized
  return true;
}

export async function GET(req, { params }) {
  const okAuth = await ensureAuth(req);
  if (okAuth instanceof NextResponse) return okAuth;

  try {
    const userId = (params.id || '').trim();
    if (!userId) {
      return NextResponse.json({ ok: false, message: 'user_id wajib ada di path' }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);

    // filter opsional
    const statusRaw = (searchParams.get('status') || '').trim().toLowerCase();
    if (statusRaw && !VALID_STATUS.includes(statusRaw)) {
      return NextResponse.json({ ok: false, message: 'status tidak valid' }, { status: 400 });
    }

    const from = toDateOrNull(searchParams.get('from'));
    const to = toDateOrNull(searchParams.get('to'));
    if (from && to && to < from) {
      return NextResponse.json({ ok: false, message: '"to" tidak boleh sebelum "from"' }, { status: 400 });
    }

    const hasAbsensiRaw = (searchParams.get('has_absensi') || '').trim().toLowerCase();
    const hasAbsensi = hasAbsensiRaw === '1' || hasAbsensiRaw === 'true' ? true : hasAbsensiRaw === '0' || hasAbsensiRaw === 'false' ? false : undefined;

    // pagination
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    // where-clause Prisma
    const where = {
      deleted_at: null,
      id_user: userId,
      ...(statusRaw && { status: statusRaw }),
    };

    const startDate = {};
    if (from) startDate.gte = from;
    if (to) startDate.lte = to;
    if (Object.keys(startDate).length) where.start_date = startDate;

    if (hasAbsensi === true) where.NOT = { id_absensi: null };
    else if (hasAbsensi === false) where.id_absensi = null;

    const [total, data] = await Promise.all([
      db.agendaKerja.count({ where }),
      db.agendaKerja.findMany({
        where,
        orderBy: [{ start_date: 'desc' }, { created_at: 'desc' }],
        skip: offset,
        take: limit,
        include: {
          agenda: { select: { id_agenda: true, nama_agenda: true } },
          absensi: { select: { id_absensi: true, tanggal: true, jam_masuk: true, jam_pulang: true } },
          user: { select: { id_user: true, nama_pengguna: true, email: true, role: true } },
        },
      }),
    ]);

    return NextResponse.json({
      ok: true,
      meta: {
        total,
        limit,
        offset,
        nextOffset: offset + data.length < total ? offset + data.length : null,
      },
      data,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, message: 'Gagal mengambil daftar agenda_kerja' }, { status: 500 });
  }
}
