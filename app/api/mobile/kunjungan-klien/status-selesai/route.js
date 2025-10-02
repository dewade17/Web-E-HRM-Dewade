export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { endOfUTCDay, parseDateOnlyToUTC, startOfUTCDay } from '@/helpers/date-helper';

// Helper untuk autentikasi
async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const payload = verifyAuthToken(auth.slice(7));
      const id = payload?.sub || payload?.id_user || payload?.userId;
      if (id) {
        return {
          actor: { id, role: payload?.role, source: 'bearer' },
        };
      }
    } catch (_) {
      /* fallback ke NextAuth */
    }
  }

  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;

  const id = sessionOrRes?.user?.id || sessionOrRes?.user?.id_user;
  if (!id) {
    return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
  }

  return {
    actor: { id, role: sessionOrRes?.user?.role, source: 'session' },
  };
}

// Objek untuk menyertakan relasi pada hasil query
const kunjunganInclude = {
  kategori: {
    select: {
      id_kategori_kunjungan: true,
      kategori_kunjungan: true,
    },
  },
  reports: {
    where: { deleted_at: null },
    select: {
      recipient_nama_snapshot: true, //ada update ini
      id_kunjungan_report_recipient: true,
      id_user: true,
      status: true,
    },
  },
};

export async function GET(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  if (!actorId) {
    return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
    const pageSize = Math.min(Math.max(parseInt(searchParams.get('pageSize') || '10', 10), 1), 50);

    // Ambil parameter tanggal dari URL
    const tanggalParam = (searchParams.get('tanggal') || '').trim();

    const where = {
      id_user: actorId,
      status_kunjungan: 'selesai', // Filter utama: status 'selesai'
      deleted_at: null,
    };

    // Tambahkan filter tanggal jika ada
    if (tanggalParam) {
      const tanggal = parseDateOnlyToUTC(tanggalParam);
      if (!tanggal) {
        return NextResponse.json({ message: "Parameter 'tanggal' tidak valid. Gunakan format YYYY-MM-DD." }, { status: 400 });
      }

      const startOfDay = startOfUTCDay(tanggal);
      const endOfDay = endOfUTCDay(tanggal);
      if (!startOfDay || !endOfDay) {
        return NextResponse.json({ message: "Parameter 'tanggal' tidak valid. Gunakan format YYYY-MM-DD." }, { status: 400 });
      }
      where.tanggal = {
        gte: startOfDay,
        lte: endOfDay,
      };
    }

    const [total, items] = await Promise.all([
      db.kunjungan.count({ where }),
      db.kunjungan.findMany({
        where,
        orderBy: { jam_checkout: 'desc' }, // Urutkan berdasarkan waktu check-out terbaru
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: kunjunganInclude,
      }),
    ]);

    return NextResponse.json({
      data: items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err) {
    console.error('GET /status-selesai error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}
