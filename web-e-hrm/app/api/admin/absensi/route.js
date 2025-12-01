import { NextResponse } from 'next/server';
import { authenticateRequest } from '../../../../app/utils/auth/authUtils';
import db from '../../../../lib/prisma';
import { verifyAuthToken } from '../../../../lib/jwt';

const REPORT_STATUSES = new Set(['terkirim', 'disetujui', 'ditolak']);

async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const claims = verifyAuthToken(auth.slice(7));
      return { claims };
    } catch (_) {
      /* fallback ke NextAuth */
    }
  }
  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes; // unauthorized
  return { session: sessionOrRes };
}

export async function GET(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { claims, session } = auth;
    const actorId = claims?.sub || claims?.id_user || claims?.userId || claims?.id || session?.user?.id || session?.user?.id_user;

    if (!actorId) {
      return NextResponse.json({ message: 'Payload token tidak sesuai' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const statusParam = (searchParams.get('status') || '').trim().toLowerCase();
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get('perPage') || '20', 10)));

    const where = { deleted_at: null, id_user: actorId };

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
                  absensi: {
                    select: {
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
