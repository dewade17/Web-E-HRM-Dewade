import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { endOfUTCDay, parseDateTimeToUTC, startOfUTCDay } from '@/helpers/date-helper';

async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const payload = verifyAuthToken(auth.slice(7));
      return {
        actor: {
          id: payload?.sub || payload?.id_user || payload?.userId || null,
          role: payload?.role || null,
          source: 'bearer',
        },
      };
    } catch (err) {
      console.warn('Invalid bearer token for admin agenda-kerja API, fallback to session.', err);
      /* fallback ke NextAuth */
    }
  }

  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;

  return {
    actor: {
      id: sessionOrRes?.user?.id || null,
      role: sessionOrRes?.user?.role || null,
      source: 'session',
    },
  };
}

function guardOperational(actor) {
  if (!actor?.role || actor.role !== 'OPERASIONAL') {
    return NextResponse.json({ message: 'Forbidden: hanya role OPERASIONAL yang dapat mengakses resource ini.' }, { status: 403 });
  }
  return null;
}

function toDateOrNull(v) {
  if (!v) return null;
  const parsed = parseDateTimeToUTC(v);
  return parsed ?? null;
}

function startOfDay(d) {
  return startOfUTCDay(d);
}

function endOfDay(d) {
  return endOfUTCDay(d);
}

function overlapRangeFilter(fromSOD, toEOD) {
  return {
    AND: [{ OR: [{ start_date: null }, { start_date: { lte: toEOD } }] }, { OR: [{ end_date: null }, { end_date: { gte: fromSOD } }] }],
  };
}

const VALID_STATUS = ['diproses', 'ditunda', 'selesai'];
const VALID_KEBUTUHAN = ['PENTING_MENDESAK', 'TIDAK_PENTING_TAPI_MENDESAK', 'PENTING_TAK_MENDESAK', 'TIDAK_PENTING_TIDAK_MENDESAK'];
const MIN_RANGE_DATE = startOfUTCDay('1970-01-01') ?? new Date(Date.UTC(1970, 0, 1));
const MAX_RANGE_DATE = endOfUTCDay('2999-12-31') ?? new Date(Date.UTC(2999, 11, 31, 23, 59, 59, 999));

export async function GET(request) {
  const auth = await ensureAuth(request);
  if (auth instanceof NextResponse) return auth;

  const forbidden = guardOperational(auth.actor);
  if (forbidden) return forbidden;

  try {
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get('perPage') || '20', 10)));

    const userIdParam = searchParams.get('id_user') ?? searchParams.get('user_id');
    const id_agenda = searchParams.get('id_agenda') || undefined;
    const id_absensi = searchParams.get('id_absensi') || undefined;
    const status = searchParams.get('status') || undefined;

    const dateEq = searchParams.get('date');
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    const where = { deleted_at: null };
    const kebutuhan_agenda_raw = searchParams.get('kebutuhan_agenda');
    if (userIdParam) where.id_user = userIdParam;
    if (id_agenda) where.id_agenda = id_agenda;
    if (id_absensi) where.id_absensi = id_absensi;
    if (status && VALID_STATUS.includes(String(status).toLowerCase())) {
      where.status = String(status).toLowerCase();
    }
    if (kebutuhan_agenda_raw !== null) {
      const trimmed = String(kebutuhan_agenda_raw || '').trim();
      if (!trimmed) {
        where.kebutuhan_agenda = null;
      } else {
        const normalized = trimmed.toUpperCase();
        if (!VALID_KEBUTUHAN.includes(normalized)) {
          return NextResponse.json({ ok: false, message: 'kebutuhan_agenda tidak valid' }, { status: 400 });
        }
        where.kebutuhan_agenda = normalized;
      }
    }

    const and = [];
    if (dateEq) {
      const d = toDateOrNull(dateEq);
      if (d) and.push(overlapRangeFilter(startOfDay(d), endOfDay(d)));
    } else if (from || to) {
      const gte = toDateOrNull(from);
      const lte = toDateOrNull(to);
      if (gte || lte) {
        and.push(overlapRangeFilter(gte ? startOfDay(gte) : MIN_RANGE_DATE, lte ? endOfDay(lte) : MAX_RANGE_DATE));
      }
    }
    if (and.length) where.AND = and;

    const [total, items] = await Promise.all([
      db.agendaKerja.count({ where }),
      db.agendaKerja.findMany({
        where,
        orderBy: [{ start_date: 'desc' }, { created_at: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          agenda: { select: { id_agenda: true, nama_agenda: true } },
          absensi: { select: { id_absensi: true, tanggal: true, jam_masuk: true, jam_pulang: true } },
          user: { select: { id_user: true, nama_pengguna: true, email: true, role: true } },
        },
      }),
    ]);

    return NextResponse.json({
      ok: true,
      data: items,
      meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
    });
  } catch (err) {
    console.error('GET /api/admin/agenda-kerja error:', err);
    return NextResponse.json({ ok: false, message: 'Failed to fetch agenda kerja' }, { status: 500 });
  }
}

export async function POST(request) {
  const auth = await ensureAuth(request);
  if (auth instanceof NextResponse) return auth;

  const forbidden = guardOperational(auth.actor);
  if (forbidden) return forbidden;

  try {
    const body = await request.json();

    const id_user = String(body.id_user || '').trim();
    const id_agenda = String(body.id_agenda || '').trim();
    const deskripsi_kerja = String(body.deskripsi_kerja || '').trim();

    if (!id_user) return NextResponse.json({ ok: false, message: 'id_user wajib diisi' }, { status: 400 });
    if (!id_agenda) return NextResponse.json({ ok: false, message: 'id_agenda wajib diisi' }, { status: 400 });
    if (!deskripsi_kerja) return NextResponse.json({ ok: false, message: 'deskripsi_kerja wajib diisi' }, { status: 400 });

    const statusValue = String(body.status || 'diproses').toLowerCase();
    if (!VALID_STATUS.includes(statusValue)) {
      return NextResponse.json({ ok: false, message: 'status tidak valid' }, { status: 400 });
    }

    const start_date = toDateOrNull(body.start_date);
    const end_date = toDateOrNull(body.end_date);

    if (start_date && end_date && end_date < start_date) {
      return NextResponse.json({ ok: false, message: 'end_date tidak boleh sebelum start_date' }, { status: 400 });
    }

    let duration_seconds = body.duration_seconds ?? null;
    if (duration_seconds == null && start_date && end_date) {
      duration_seconds = Math.max(0, Math.floor((end_date - start_date) / 1000));
    }

    const kebutuhanAgenda = normalizeKebutuhanInput(body.kebutuhan_agenda);
    if (kebutuhanAgenda.error) {
      return NextResponse.json({ ok: false, message: kebutuhanAgenda.error }, { status: 400 });
    }

    const data = {
      id_user,
      id_agenda,
      deskripsi_kerja,
      status: statusValue,
      start_date,
      end_date,
      duration_seconds,
      id_absensi: body.id_absensi ?? null,
      ...(kebutuhanAgenda.value !== undefined && { kebutuhan_agenda: kebutuhanAgenda.value }),
    };

    const created = await db.agendaKerja.create({
      data,
      include: {
        agenda: { select: { id_agenda: true, nama_agenda: true } },
        absensi: { select: { id_absensi: true, tanggal: true, jam_masuk: true, jam_pulang: true } },
        user: { select: { id_user: true, nama_pengguna: true, email: true, role: true } },
      },
    });

    return NextResponse.json({ ok: true, data: created }, { status: 201 });
  } catch (err) {
    console.error('POST /api/admin/agenda-kerja error:', err);
    return NextResponse.json({ ok: false, message: 'Gagal membuat agenda kerja' }, { status: 500 });
  }
}

function normalizeKebutuhanInput(input) {
  if (input === undefined) return { value: undefined };
  if (input === null) return { value: null };

  const trimmed = String(input).trim();
  if (!trimmed) return { value: null };

  const normalized = trimmed.toUpperCase();
  if (!VALID_KEBUTUHAN.includes(normalized)) {
    return { error: 'kebutuhan_agenda tidak valid' };
  }

  return { value: normalized };
}
