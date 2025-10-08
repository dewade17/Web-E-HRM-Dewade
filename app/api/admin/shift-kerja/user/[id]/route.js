// app/api/admin/shift-kerja/user/[id]/route.js
import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';

/**
 * Auth helper: terima Bearer JWT atau NextAuth session.
 */
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

/**
 * Parse tanggal opsional (string ISO/`YYYY-MM-DD`).
 * undefined => tidak difilter; '' / null => error.
 * Kolom di DB bertipe DATE, namun Prisma pakai Date JS.
 */
function parseOptionalDateOnly(value, field) {
  if (value === undefined) return undefined;
  if (value === null || value === '') {
    throw new Error(`Parameter '${field}' tidak boleh kosong.`);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Parameter '${field}' harus berupa tanggal yang valid (YYYY-MM-DD).`);
  }
  // Normalisasi ke 00:00:00 agar aman dipakai gte/lte untuk kolom DATE.
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * GET /shift-kerja/user/[id]
 * Query params:
 * - page (default 1), pageSize (default 10, max 100)
 * - orderBy: one of ['tanggal_mulai','tanggal_selesai','status','created_at','updated_at'] (default 'tanggal_mulai')
 * - sort: 'asc' | 'desc' (default 'desc')
 * - includeDeleted=1 untuk sertakan soft-deleted
 * - status=KERJA|LIBUR (opsional)
 * - from=YYYY-MM-DD (filter tanggal_mulai >= from)
 * - to=YYYY-MM-DD   (filter tanggal_mulai <= to)
 * - hari=string     (opsional, cari contains pada 'hari_kerja', case-insensitive)
 */
export async function GET(req, { params }) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const { id } = params;
    const { searchParams } = new URL(req.url);

    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
    const pageSize = Math.min(Math.max(parseInt(searchParams.get('pageSize') || '10', 10), 1), 100);

    const includeDeleted = searchParams.get('includeDeleted') === '1';
    const statusParam = searchParams.get('status'); // 'KERJA' | 'LIBUR' | null
    const hari = (searchParams.get('hari') || '').trim();

    const allowedOrder = new Set(['tanggal_mulai', 'tanggal_selesai', 'status', 'created_at', 'updated_at']);
    const orderByParam = (searchParams.get('orderBy') || 'tanggal_mulai').trim();
    const orderByField = allowedOrder.has(orderByParam) ? orderByParam : 'tanggal_mulai';
    const sort = (searchParams.get('sort') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    // Filter tanggal (berbasis tanggal_mulai)
    let from, to;
    try {
      from = parseOptionalDateOnly(searchParams.get('from'), 'from');
      to = parseOptionalDateOnly(searchParams.get('to'), 'to');
    } catch (e) {
      return NextResponse.json({ message: e.message }, { status: 400 });
    }

    // Build where clause
    const where = {
      id_user: id,
      ...(includeDeleted ? {} : { deleted_at: null }),
      ...(statusParam && (statusParam === 'KERJA' || statusParam === 'LIBUR') ? { status: statusParam } : {}),
      ...(hari ? { hari_kerja: { contains: hari, mode: 'insensitive' } } : {}),
      ...(from ? { tanggal_mulai: { gte: from } } : {}),
      ...(to ? { ...(from ? {} : {}), tanggal_mulai: { ...(from ? { gte: from } : {}), lte: to } } : {}),
    };

    // Count + data
    const [total, data] = await Promise.all([
      db.shiftKerja.count({ where }),
      db.shiftKerja.findMany({
        where,
        orderBy: { [orderByField]: sort },
        skip: (page - 1) * pageSize,
        take: pageSize,
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
          // ikutkan detail pola kerja agar kaya konteks
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
      }),
    ]);

    return NextResponse.json({
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err) {
    console.error('GET /shift-kerja/user/[id] error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
