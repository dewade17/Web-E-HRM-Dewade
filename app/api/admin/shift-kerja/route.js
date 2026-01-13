import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { parseDateOnlyToUTC } from '@/helpers/date-helper';
import { extractWeeklyScheduleInput, normalizeWeeklySchedule, serializeHariKerja, transformShiftRecord } from './schedul-utils';
import { sendNotification } from '@/app/utils/services/notificationService';

const SHIFT_STATUS = ['KERJA', 'LIBUR'];

async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      verifyAuthToken(auth.slice(7));
      return true;
    } catch {}
  }
  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;
  return true;
}

function parseBodyDate(value, field) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string' && !value.trim()) {
    throw new Error(`Field '${field}' harus berupa tanggal yang valid.`);
  }
  const parsed = parseDateOnlyToUTC(value);
  if (!(parsed instanceof Date) || isNaN(+parsed)) {
    throw new Error(`Field '${field}' harus berupa tanggal yang valid.`);
  }
  return parsed;
}

function buildDateFilter(searchParams, field) {
  const from = searchParams.get(`${field}From`);
  const to = searchParams.get(`${field}To`);
  const filter = {};
  if (from) {
    const parsed = parseDateOnlyToUTC(from);
    if (!(parsed instanceof Date) || isNaN(+parsed)) {
      throw new Error(`Parameter '${field}From' tidak valid.`);
    }
    filter.gte = parsed;
  }
  if (to) {
    const parsed = parseDateOnlyToUTC(to);
    if (!(parsed instanceof Date) || isNaN(+parsed)) {
      throw new Error(`Parameter '${field}To' tidak valid.`);
    }
    filter.lte = parsed;
  }
  return Object.keys(filter).length > 0 ? filter : undefined;
}

export async function GET(req, { params }) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const { id } = params;
    const url = new URL(req.url);
    const searchParams = url.searchParams;

    const includeDeleted = ['1', 'true', 'yes'].includes((searchParams.get('includeDeleted') || '').toLowerCase());

    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get('pageSize') || '50', 10)));

    const orderBy = (searchParams.get('orderBy') || 'tanggal_mulai').trim();
    const sort = (searchParams.get('sort') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    const statusParam = (searchParams.get('status') || '').trim().toUpperCase();
    const hari = (searchParams.get('hari') || '').trim();

    // Normalize date-only filters (accept YYYY-MM-DD or full ISO)
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');
    const from = fromParam ? parseDateOnlyToUTC(fromParam) : null;
    const to = toParam ? parseDateOnlyToUTC(toParam) : null;

    // Build where
    const where = {
      id_user: id,
      ...(includeDeleted ? {} : { deleted_at: null }),
      ...(statusParam === 'KERJA' || statusParam === 'LIBUR' ? { status: statusParam } : {}),
      ...(hari ? { hari_kerja: { contains: hari, mode: 'insensitive' } } : {}),
      ...(from && to
        ? {
            // overlap range: shift intersects [from, to]
            tanggal_mulai: { lte: to },
            tanggal_selesai: { gte: from },
          }
        : from
        ? {
            // anything that is active on/after 'from'
            tanggal_selesai: { gte: from },
          }
        : to
        ? {
            // anything that starts on/before 'to'
            tanggal_mulai: { lte: to },
          }
        : {}),
    };

    const allowedOrderBy = new Set(['tanggal_mulai', 'tanggal_selesai', 'status', 'created_at', 'updated_at']);
    const safeOrderBy = allowedOrderBy.has(orderBy) ? orderBy : 'tanggal_mulai';

    const [total, rows] = await Promise.all([
      db.shiftKerja.count({ where }),
      db.shiftKerja.findMany({
        where,
        orderBy: { [safeOrderBy]: sort },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          polaKerja: true,
          user: true,
        },
      }),
    ]);

    const data = rows.map((r) => transformShiftRecord(r));

    return NextResponse.json(
      {
        data,
        meta: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    console.error('GET /admin/shift-kerja/user/[id] error:', error);
    return NextResponse.json({ message: 'Gagal mengambil shift kerja.' }, { status: 500 });
  }
}

export async function POST(req) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const body = await req.json();

    const idUser = body.id_user ? String(body.id_user).trim() : '';
    if (!idUser) {
      return NextResponse.json({ message: "Field 'id_user' wajib diisi." }, { status: 400 });
    }

    const targetUser = await db.user.findUnique({
      where: { id_user: idUser },
      select: { id_user: true, nama_pengguna: true },
    });
    if (!targetUser) {
      return NextResponse.json({ message: 'User tidak ditemukan.' }, { status: 404 });
    }

    const statusRaw = body.status ? String(body.status).toUpperCase().trim() : '';
    if (!SHIFT_STATUS.includes(statusRaw)) {
      return NextResponse.json({ message: "Field 'status' tidak valid." }, { status: 400 });
    }

    const weeklyScheduleInput = extractWeeklyScheduleInput(body);

    let hariKerjaValue;
    let tanggalMulai;
    let tanggalSelesai;

    if (weeklyScheduleInput !== undefined) {
      const fallbackStart =
        body.tanggal_mulai ??
        body.start_date ??
        body.startDate ??
        body.mulai ??
        body.referenceDate ??
        body.weekStart;

      const fallbackEnd =
        body.tanggal_selesai ??
        body.end_date ??
        body.endDate ??
        body.selesai ??
        body.until ??
        body.weekEnd;

      const normalized = normalizeWeeklySchedule(weeklyScheduleInput, {
        fallbackStartDate: fallbackStart,
        fallbackEndDate: fallbackEnd,
      });

      hariKerjaValue = serializeHariKerja(normalized.schedule);
      tanggalMulai = normalized.tanggalMulai;
      tanggalSelesai = normalized.tanggalSelesai;
    } else {
      const hariKerja = body.hari_kerja ? String(body.hari_kerja).trim() : '';
      if (!hariKerja) {
        return NextResponse.json({ message: "Field 'hari_kerja' wajib diisi." }, { status: 400 });
      }
      hariKerjaValue = hariKerja;

      tanggalMulai = parseBodyDate(body.tanggal_mulai, 'tanggal_mulai');
      // default single-day → tanggal_selesai = tanggal_mulai
      tanggalSelesai = parseBodyDate(body.tanggal_selesai ?? body.tanggal_mulai, 'tanggal_selesai');
    }

    if (!(tanggalMulai instanceof Date) || isNaN(+tanggalMulai)) {
      return NextResponse.json({ message: "Field 'tanggal_mulai' wajib diisi (tanggal valid)." }, { status: 400 });
    }
    if (!(tanggalSelesai instanceof Date) || isNaN(+tanggalSelesai)) {
      return NextResponse.json({ message: "Field 'tanggal_selesai' wajib diisi (tanggal valid)." }, { status: 400 });
    }
    if (tanggalSelesai < tanggalMulai) {
      return NextResponse.json({ message: "Field 'tanggal_selesai' tidak boleh lebih awal dari 'tanggal_mulai'." }, { status: 400 });
    }

    let idPolaKerja = null;
    if (body.id_pola_kerja !== undefined) {
      if (body.id_pola_kerja === null || body.id_pola_kerja === '') {
        idPolaKerja = null;
      } else {
        idPolaKerja = String(body.id_pola_kerja).trim();
        if (!idPolaKerja) {
          return NextResponse.json({ message: "Field 'id_pola_kerja' tidak valid." }, { status: 400 });
        }
        const polaExists = await db.polaKerja.findUnique({
          where: { id_pola_kerja: idPolaKerja },
          select: { id_pola_kerja: true },
        });
        if (!polaExists) {
          return NextResponse.json({ message: 'Pola kerja tidak ditemukan.' }, { status: 404 });
        }
      }
    }

    const payloadCreateOrUpdate = {
      id_user: idUser,
      hari_kerja: hariKerjaValue,
      status: statusRaw,
      tanggal_mulai: tanggalMulai,
      tanggal_selesai: tanggalSelesai ?? tanggalMulai,
      id_pola_kerja: statusRaw === 'LIBUR' ? null : idPolaKerja ?? null,
    };

    // =============== DEBUG: sebelum upsert ===============
    const toIsoOrNull = (d) =>
      d instanceof Date && !isNaN(+d) ? d.toISOString().slice(0, 10) : d;

    console.info('[DEBUG SHIFT UPSERT REQUEST]', {
      idUser,
      statusRaw,
      hariKerjaValue,
      tanggalMulai: toIsoOrNull(tanggalMulai),
      tanggalSelesai: toIsoOrNull(tanggalSelesai),
      idPolaKerja,
      payloadCreateOrUpdate,
    });

    // cek data existing user ini sekitar tanggal tersebut (±3 hari)
    const rangeBeforeFrom = new Date(tanggalMulai.getTime() - 3 * 24 * 60 * 60 * 1000);
    const rangeBeforeTo = new Date(tanggalMulai.getTime() + 3 * 24 * 60 * 60 * 1000);

    const sebelum = await db.shiftKerja.findMany({
      where: {
        id_user: idUser,
        tanggal_mulai: {
          gte: rangeBeforeFrom,
          lte: rangeBeforeTo,
        },
      },
      select: {
        id_shift_kerja: true,
        id_user: true,
        tanggal_mulai: true,
        tanggal_selesai: true,
        status: true,
        id_pola_kerja: true,
      },
    });

    console.info(
      '[DEBUG SHIFT SEBELUM UPSERT]',
      sebelum.map((s) => ({
        ...s,
        tanggal_mulai: toIsoOrNull(s.tanggal_mulai),
        tanggal_selesai: toIsoOrNull(s.tanggal_selesai),
      })),
    );
    // ======================================================

    // === Perbaikan penting: revive soft-deleted via deleted_at: null
    const upserted = await db.shiftKerja.upsert({
      where: {
        // gunakan nama @@unique di Prisma schema
        uniq_shift_per_user_per_date: {
          id_user: idUser,
          tanggal_mulai: tanggalMulai,
        },
      },
      create: {
        ...payloadCreateOrUpdate,
        deleted_at: null,
      },
      update: {
        ...payloadCreateOrUpdate,
        deleted_at: null, // pastikan bangkit dari soft delete
      },
      select: {
        id_shift_kerja: true,
        id_user: true,
        tanggal_mulai: true,
        tanggal_selesai: true,
        hari_kerja: true,
        status: true,
        id_pola_kerja: true,
        created_at: true,
      },
    });

    // =============== DEBUG: sesudah upsert ===============
    console.info('[DEBUG SHIFT UPSERT RESULT]', {
      ...upserted,
      tanggal_mulai: toIsoOrNull(upserted.tanggal_mulai),
      tanggal_selesai: toIsoOrNull(upserted.tanggal_selesai),
    });

    const sesudah = await db.shiftKerja.findMany({
      where: {
        id_user: idUser,
        tanggal_mulai: {
          gte: rangeBeforeFrom,
          lte: rangeBeforeTo,
        },
      },
      select: {
        id_shift_kerja: true,
        id_user: true,
        tanggal_mulai: true,
        tanggal_selesai: true,
        status: true,
        id_pola_kerja: true,
      },
    });

    console.info(
      '[DEBUG SHIFT SESUDAH UPSERT]',
      sesudah.map((s) => ({
        ...s,
        tanggal_mulai: toIsoOrNull(s.tanggal_mulai),
        tanggal_selesai: toIsoOrNull(s.tanggal_selesai),
      })),
    );
    // ======================================================

    const formatDateOnly = (value) => {
      if (!value) return '-';
      try {
        return value.toISOString().slice(0, 10);
      } catch {
        return '-';
      }
    };

    const notificationPayload = {
      nama_karyawan: targetUser.nama_pengguna || 'Karyawan',
      periode_mulai: formatDateOnly(upserted.tanggal_mulai),
      periode_selesai: formatDateOnly(upserted.tanggal_selesai),
    };

    console.info(
      '[NOTIF] Mengirim notifikasi NEW_SHIFT_PUBLISHED untuk user %s dengan payload %o',
      upserted.id_user,
      notificationPayload,
    );
    await sendNotification('NEW_SHIFT_PUBLISHED', upserted.id_user, notificationPayload);
    console.info(
      '[NOTIF] Notifikasi NEW_SHIFT_PUBLISHED selesai diproses untuk user %s',
      upserted.id_user,
    );

    return NextResponse.json(
      { message: 'Shift kerja disimpan.', data: transformShiftRecord(upserted) },
      { status: 201 },
    );
  } catch (err) {
    console.error('POST /shift-kerja error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
