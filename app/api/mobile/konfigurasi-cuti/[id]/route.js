import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';

export const runtime = 'nodejs';

const MONTHS = ['JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI', 'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'];
const MONTH_SET = new Set(MONTHS);

async function ensureAuth(req) {
  const authHeader = req.headers.get('authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    const rawToken = authHeader.slice(7).trim();
    if (rawToken) {
      try {
        const payload = verifyAuthToken(rawToken);
        const id = payload?.sub || payload?.id_user || payload?.userId || payload?.user_id;
        if (id) {
          return {
            actor: {
              id,
              role: payload?.role ?? null,
              source: 'bearer',
              payload,
            },
          };
        }
      } catch (err) {
        // fall through ke autentikasi NextAuth
      }
    }
  }

  const sessionOrResponse = await authenticateRequest();
  if (sessionOrResponse instanceof NextResponse) {
    return sessionOrResponse;
  }

  const sessionUser = sessionOrResponse?.user ?? {};
  const sessionUserId = sessionUser?.id || sessionUser?.id_user;
  if (!sessionUserId) {
    return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
  }

  return {
    actor: {
      id: sessionUserId,
      role: sessionUser?.role ?? null,
      source: 'session',
      session: sessionOrResponse,
    },
  };
}

export async function GET(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const userId = String(params?.id ?? '').trim();
    if (!userId) {
      return NextResponse.json({ ok: false, message: 'Parameter id pengguna wajib diisi.' }, { status: 400 });
    }

    const existingUser = await db.user.findUnique({ where: { id_user: userId }, select: { id_user: true } });
    if (!existingUser) {
      return NextResponse.json({ ok: false, message: 'Pengguna tidak ditemukan.' }, { status: 404 });
    }

    const { searchParams } = new URL(req.url);
    const bulanFilters = [];
    const seenMonths = new Set();

    const rawParams = searchParams.getAll('bulan');
    for (const raw of rawParams) {
      if (raw == null) continue;
      for (const entry of String(raw).split(',')) {
        const trimmed = entry.trim();
        if (!trimmed) continue;
        const normalized = trimmed.toUpperCase();
        if (!MONTH_SET.has(normalized)) {
          return NextResponse.json({ ok: false, message: `Nilai bulan tidak valid: ${trimmed}` }, { status: 400 });
        }
        if (!seenMonths.has(normalized)) {
          seenMonths.add(normalized);
          bulanFilters.push(normalized);
        }
      }
    }

    const data = await db.cutiKonfigurasi.findMany({
      where: {
        id_user: userId,
        deleted_at: null,
        ...(bulanFilters.length && { bulan: { in: bulanFilters } }),
      },
      orderBy: { bulan: 'asc' },
      select: {
        id_cuti_konfigurasi: true,
        bulan: true,
        kouta_cuti: true,
        cuti_tabung: true,
        updated_at: true,
      },
    });

    return NextResponse.json({ ok: true, data, meta: { total: data.length } });
  } catch (err) {
    console.error('GET /api/mobile/cuti-konfigurasi/[id] error:', err);
    return NextResponse.json({ ok: false, message: 'Gagal mengambil konfigurasi cuti.' }, { status: 500 });
  }
}

export { ensureAuth };
