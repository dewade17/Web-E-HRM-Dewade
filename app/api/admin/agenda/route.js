// app/api/agenda/route.js
import { NextResponse } from 'next/server';
import db from '../../../../lib/prisma';
import { verifyAuthToken } from '../../../../lib/jwt';
import { authenticateRequest } from '../../../../app/utils/auth/authUtils';

// Hanya memastikan request terautentikasi (JWT atau NextAuth), tanpa resolve user/role
async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      verifyAuthToken(auth.slice(7));
      return true;
    } catch {
      /* fallback ke NextAuth */
    }
  }
  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes; // unauthorized
  return true;
}

/**
 * GET /api/agenda
 * Query:
 *  - q? (search nama_agenda)
 *  - page?, perPage?
 */
export async function GET(request) {
  const okAuth = await ensureAuth(request);
  if (okAuth instanceof NextResponse) return okAuth;

  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get('perPage') || '20', 10)));

    const where = { deleted_at: null };
    if (q) {
      where.nama_agenda = { contains: q };
    }

    const [total, items] = await Promise.all([
      db.agenda.count({ where }),
      db.agenda.findMany({
        where,
        orderBy: [{ created_at: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          _count: { select: { items: true } }, // jumlah agenda_kerja
        },
      }),
    ]);

    return NextResponse.json({
      ok: true,
      data: items,
      meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, message: 'Failed to fetch agenda' }, { status: 500 });
  }
}

/**
 * POST /api/agenda
 * Body JSON:
 *  - nama_agenda (required)
 */
export async function POST(request) {
  const okAuth = await ensureAuth(request);
  if (okAuth instanceof NextResponse) return okAuth;

  try {
    const body = await request.json();
    const nama_agenda = (body.nama_agenda || '').trim();
    if (!nama_agenda) {
      return NextResponse.json({ ok: false, message: 'nama_agenda wajib diisi' }, { status: 400 });
    }

    const created = await db.agenda.create({
      data: { nama_agenda },
      include: { _count: { select: { items: true } } },
    });

    return NextResponse.json({ ok: true, data: created }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, message: 'Gagal membuat agenda' }, { status: 500 });
  }
}
