import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';

const REPORT_STATUSES = new Set(['terkirim', 'disetujui', 'ditolak']);

function getClaimsFromRequest(req) {
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) {
    const err = new Error('Token tidak ditemukan');
    err.status = 401;
    throw err;
  }

  const token = auth.slice(7).trim();
  try {
    return verifyAuthToken(token);
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      const err = new Error('Token sudah kedaluwarsa');
      err.status = 401;
      throw err;
    }
    if (error instanceof jwt.JsonWebTokenError) {
      const err = new Error('Token tidak valid');
      err.status = 401;
      throw err;
    }
    const err = new Error('Gagal memverifikasi token');
    err.status = 500;
    throw err;
  }
}

export async function GET(req) {
  try {
    const claims = getClaimsFromRequest(req);
    const actorId = claims?.sub || claims?.id_user;

    if (!actorId) {
      return NextResponse.json({ message: 'Payload token tidak sesuai' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const statusParam = (searchParams.get('status') || '').trim().toLowerCase();
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get('perPage') || '20', 10)));

    const where = {
      deleted_at: null,
      id_user: actorId,
    };

    if (statusParam) {
      if (!REPORT_STATUSES.has(statusParam)) {
        return NextResponse.json({ message: "Parameter 'status' tidak valid." }, { status: 400 });
      }
      where.status = statusParam;
    }

    const [total, items] = await Promise.all([
      db.absensiReportRecipient.count({ where }),
      db.absensiReportRecipient.findMany({
        where,
        orderBy: [{ created_at: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          absensi: {
            include: {
              user: {
                select: {
                  id_user: true,
                  nama_pengguna: true,
                  email: true,
                  role: true,
                  departement: { select: { id_departement: true, nama_departement: true } },
                },
              },
              lokasiIn: {
                select: {
                  id_location: true,
                  nama_kantor: true,
                  latitude: true,
                  longitude: true,
                  radius: true,
                },
              },
              lokasiOut: {
                select: {
                  id_location: true,
                  nama_kantor: true,
                  latitude: true,
                  longitude: true,
                  radius: true,
                },
              },
            },
          },
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
      },
    });
  } catch (error) {
    const status = error?.status || 500;
    const message = error?.message || 'Terjadi kesalahan ketika mengambil data persetujuan absensi.';
    console.error('absensi approvals list error:', error);
    return NextResponse.json({ ok: false, message }, { status });
  }
}
