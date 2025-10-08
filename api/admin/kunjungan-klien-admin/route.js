import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { endOfUTCDay, parseDateOnlyToUTC, parseDateTimeToUTC, startOfUTCDay } from '@/helpers/date-helper';

const STATUS_VALUES = new Set(['diproses', 'berlangsung', 'selesai']);
const ALLOWED_ORDER_FIELDS = new Set(['tanggal', 'created_at', 'updated_at', 'status_kunjungan']);

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
      id_kunjungan_report_recipient: true,
      id_user: true,
      recipient_nama_snapshot: true,
      recipient_role_snapshot: true,
      catatan: true,
      status: true,
      created_at: true,
      updated_at: true,
    },
  },
};

async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const payload = verifyAuthToken(auth.slice(7));
      return {
        actor: {
          id: payload?.sub || payload?.id_user || payload?.userId,
          role: payload?.role,
          source: 'bearer',
        },
      };
    } catch (_) {
      // fallback ke NextAuth
    }
  }

  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;

  return {
    actor: {
      id: sessionOrRes.user.id,
      role: sessionOrRes.user.role,
      source: 'session',
    },
  };
}

function guardOperational(actor) {
  if (actor?.role !== 'OPERASIONAL') {
    return NextResponse.json({ message: 'Forbidden: hanya role OPERASIONAL yang dapat mengakses resource ini.' }, { status: 403 });
  }
  return null;
}

function parseBoolean(value) {
  if (value === null || value === undefined) return false;
  const lowered = String(value).trim().toLowerCase();
  return lowered === '1' || lowered === 'true';
}

function normalizeUserId(param) {
  if (!param) return '';
  return String(param).trim();
}

function buildDateRange({ tanggal, tanggalMulai, tanggalSelesai }) {
  if (tanggal) {
    const parsed = parseDateOnlyToUTC(tanggal);
    if (!parsed) {
      const error = new Error("Parameter 'tanggal' tidak valid.");
      error.status = 400;
      throw error;
    }
    const start = startOfUTCDay(parsed);
    const end = endOfUTCDay(parsed);
    if (!start || !end) {
      const error = new Error("Parameter 'tanggal' tidak valid.");
      error.status = 400;
      throw error;
    }
    return { tanggal: { gte: start, lte: end } };
  }

  let start = null;
  let end = null;

  if (tanggalMulai) {
    start = startOfUTCDay(tanggalMulai) || parseDateTimeToUTC(tanggalMulai);
    if (!start) {
      const error = new Error("Parameter 'tanggal_mulai' tidak valid.");
      error.status = 400;
      throw error;
    }
  }

  if (tanggalSelesai) {
    end = endOfUTCDay(tanggalSelesai) || parseDateTimeToUTC(tanggalSelesai);
    if (!end) {
      const error = new Error("Parameter 'tanggal_selesai' tidak valid.");
      error.status = 400;
      throw error;
    }
  }

  if (!start && !end) return null;

  return {
    tanggal: {
      ...(start ? { gte: start } : {}),
      ...(end ? { lte: end } : {}),
    },
  };
}

export async function GET(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;
  const forbidden = guardOperational(auth.actor);
  if (forbidden) return forbidden;

  try {
    const { searchParams } = new URL(req.url);

    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
    const rawPageSize = parseInt(searchParams.get('pageSize') || searchParams.get('perPage') || '10', 10);
    const pageSize = Math.min(Math.max(Number.isNaN(rawPageSize) ? 10 : rawPageSize, 1), 100);

    const searchTerm = (searchParams.get('q') || searchParams.get('search') || '').trim();
    const kategoriId = (searchParams.get('id_kategori_kunjungan') || searchParams.get('kategoriId') || '').trim();
    const statusParam = (searchParams.get('status_kunjungan') || searchParams.get('status') || '').trim().toLowerCase();
    const tanggalParam = (searchParams.get('tanggal') || '').trim();
    const tanggalMulaiParam = (searchParams.get('tanggal_mulai') || searchParams.get('startDate') || '').trim();
    const tanggalSelesaiParam = (searchParams.get('tanggal_selesai') || searchParams.get('endDate') || '').trim();
    const includeDeleted = parseBoolean(searchParams.get('includeDeleted'));

    const userIdParam = normalizeUserId(searchParams.get('id_user')) || normalizeUserId(searchParams.get('user_id')) || normalizeUserId(searchParams.get('idUser')) || normalizeUserId(searchParams.get('userId'));

    const filters = [];
    if (!includeDeleted) {
      filters.push({ deleted_at: null });
    }

    if (userIdParam) {
      filters.push({ id_user: userIdParam });
    }

    if (kategoriId) {
      filters.push({ id_kategori_kunjungan: kategoriId });
    }

    if (statusParam) {
      if (!STATUS_VALUES.has(statusParam)) {
        return NextResponse.json({ message: "Parameter 'status_kunjungan' tidak valid." }, { status: 400 });
      }
      filters.push({ status_kunjungan: statusParam });
    }

    if (tanggalParam || tanggalMulaiParam || tanggalSelesaiParam) {
      try {
        const rangeFilter = buildDateRange({
          tanggal: tanggalParam,
          tanggalMulai: tanggalMulaiParam,
          tanggalSelesai: tanggalSelesaiParam,
        });
        if (rangeFilter) filters.push(rangeFilter);
      } catch (err) {
        if (err?.status) {
          return NextResponse.json({ message: err.message }, { status: err.status });
        }
        throw err;
      }
    }

    if (searchTerm) {
      filters.push({
        OR: [{ deskripsi: { contains: searchTerm, mode: 'insensitive' } }, { hand_over: { contains: searchTerm, mode: 'insensitive' } }],
      });
    }

    const where = filters.length > 0 ? { AND: filters } : undefined;

    const orderByParam = (searchParams.get('orderBy') || 'tanggal').trim();
    const orderByField = ALLOWED_ORDER_FIELDS.has(orderByParam) ? orderByParam : 'tanggal';
    const sort = (searchParams.get('sort') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    const [total, data] = await Promise.all([
      db.kunjungan.count({ where }),
      db.kunjungan.findMany({
        where,
        orderBy: [{ [orderByField]: sort }, { created_at: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: kunjunganInclude,
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
    console.error('GET /api/admin/kunjungan-klien error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

function isNullLike(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return true;
    const lowered = trimmed.toLowerCase();
    if (lowered === 'null' || lowered === 'undefined') return true;
  }
  return false;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export async function POST(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;
  const forbidden = guardOperational(auth.actor);
  if (forbidden) return forbidden;

  try {
    const body = await req.json();

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ message: 'Body tidak valid.' }, { status: 400 });
    }

    const userIdCandidate = body.id_user ?? body.user_id ?? body.idUser ?? body.userId ?? body.target_user_id ?? body.targetUserId;
    const targetUserId = normalizeUserId(userIdCandidate);
    if (!targetUserId) {
      return NextResponse.json({ message: "Field 'id_user' wajib diisi." }, { status: 400 });
    }

    const rawKategori = body.id_kategori_kunjungan ?? body.kategori_id ?? body.kategoriId;
    if (isNullLike(rawKategori)) {
      return NextResponse.json({ message: "Field 'id_kategori_kunjungan' wajib diisi." }, { status: 400 });
    }

    const rawTanggal = body.tanggal;
    if (isNullLike(rawTanggal)) {
      return NextResponse.json({ message: "Field 'tanggal' wajib diisi." }, { status: 400 });
    }

    const tanggalDate = parseDateOnlyToUTC(rawTanggal);
    if (!tanggalDate) {
      return NextResponse.json({ message: "Field 'tanggal' tidak valid." }, { status: 400 });
    }

    const jamMulaiDate = !isNullLike(body.jam_mulai) ? parseDateTimeToUTC(body.jam_mulai) : null;
    if (jamMulaiDate === null && !isNullLike(body.jam_mulai)) {
      return NextResponse.json({ message: "Field 'jam_mulai' tidak valid." }, { status: 400 });
    }

    const jamSelesaiDate = !isNullLike(body.jam_selesai) ? parseDateTimeToUTC(body.jam_selesai) : null;
    if (jamSelesaiDate === null && !isNullLike(body.jam_selesai)) {
      return NextResponse.json({ message: "Field 'jam_selesai' tidak valid." }, { status: 400 });
    }

    let statusValue = 'diproses';
    if (!isNullLike(body.status_kunjungan ?? body.status)) {
      const candidate = String(body.status_kunjungan ?? body.status)
        .trim()
        .toLowerCase();
      if (!STATUS_VALUES.has(candidate)) {
        return NextResponse.json({ message: "Field 'status_kunjungan' tidak valid." }, { status: 400 });
      }
      statusValue = candidate;
    }

    const data = {
      id_user: targetUserId,
      id_kategori_kunjungan: String(rawKategori).trim(),
      deskripsi: isNullLike(body.deskripsi) ? null : String(body.deskripsi).trim(),
      hand_over: isNullLike(body.hand_over) ? null : String(body.hand_over).trim(),
      tanggal: tanggalDate,
      jam_mulai: jamMulaiDate,
      jam_selesai: jamSelesaiDate,
      status_kunjungan: statusValue,
      start_latitude: !isNullLike(body.start_latitude) ? Number(body.start_latitude) : null,
      start_longitude: !isNullLike(body.start_longitude) ? Number(body.start_longitude) : null,
      end_latitude: !isNullLike(body.end_latitude) ? Number(body.end_latitude) : null,
      end_longitude: !isNullLike(body.end_longitude) ? Number(body.end_longitude) : null,
    };

    for (const field of ['start_latitude', 'start_longitude', 'end_latitude', 'end_longitude']) {
      if (data[field] !== null && !Number.isFinite(data[field])) {
        return NextResponse.json({ message: `Field '${field}' tidak valid.` }, { status: 400 });
      }
    }

    const created = await db.kunjungan.create({
      data,
      include: kunjunganInclude,
    });

    return NextResponse.json({ message: 'Kunjungan klien dibuat.', data: created }, { status: 201 });
  } catch (err) {
    if (err?.code === 'P2003') {
      return NextResponse.json({ message: 'Referensi data tidak valid.' }, { status: 400 });
    }
    console.error('POST /api/admin/kunjungan-klien error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}
