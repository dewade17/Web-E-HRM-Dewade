import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';

async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      return { claims: verifyAuthToken(auth.slice(7)) };
    } catch {}
  }
  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;
  return { session: sessionOrRes };
}

export async function GET(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(req.url);
    const from = (searchParams.get('from') || '').trim(); // 'YYYY-MM-DD'
    const to = (searchParams.get('to') || '').trim();     // 'YYYY-MM-DD'
    const userId = (searchParams.get('userId') || '').trim(); // optional

    // pagination params (server-side)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const perPage = Math.min(5000, Math.max(1, parseInt(searchParams.get('perPage') || '1000', 10)));

    // Buat rentang tanggal inklusif: [from 00:00:00, nextDay(to) 00:00:00)
    const start = from ? new Date(`${from}T00:00:00`) : null;
    const endExclusive = to
      ? new Date(new Date(`${to}T00:00:00`).getTime() + 24 * 60 * 60 * 1000)
      : null;

    const where = {
      deleted_at: null,
      ...(userId ? { id_user: userId } : {}),
      ...((start || endExclusive)
        ? {
            tanggal: {
              ...(start && { gte: start }),
              ...(endExclusive && { lt: endExclusive }),
            },
          }
        : {}),
    };

    const [total, items] = await Promise.all([
      db.absensi.count({ where }),
      db.absensi.findMany({
        where,
        orderBy: [{ tanggal: 'desc' }, { jam_masuk: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          user: {
            select: {
              id_user: true,
              nama_pengguna: true,
              email: true,
              role: true,
              foto_profil_user: true,
              jabatan: { select: { id_jabatan: true, nama_jabatan: true } },
              departement: { select: { id_departement: true, nama_departement: true } },
            },
          },
          istirahat: {
            where: { deleted_at: null },
            orderBy: [{ start_istirahat: 'asc' }],
            select: {
              id_istirahat: true,
              tanggal_istirahat: true,
              start_istirahat: true,
              end_istirahat: true,
              start_istirahat_latitude: true,
              start_istirahat_longitude: true,
              end_istirahat_latitude: true,
              end_istirahat_longitude: true,
              created_at: true,
              updated_at: true,
            },
          },
          lokasiIn:  { select: { id_location: true, nama_kantor: true, latitude: true, longitude: true, radius: true } },
          lokasiOut: { select: { id_location: true, nama_kantor: true, latitude: true, longitude: true, radius: true } },
        },
      }),
    ]);

    return NextResponse.json({
      ok: true,
      data: items,
      meta: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
        from: from || null,
        to: to || null,
      },
    });
  } catch (error) {
    console.error('absensi records list error:', error);
    return NextResponse.json(
      { ok: false, message: 'Terjadi kesalahan ketika mengambil riwayat absensi.' },
      { status: 500 }
    );
  }
}
