import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { parseDateOnlyToUTC } from '@/helpers/date-helper';
import {
  extractWeeklyScheduleInput,
  normalizeWeeklySchedule,
  serializeHariKerja,
  transformShiftRecord,
} from './schedul-utils';
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

export async function GET(req) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
    const pageSize = Math.min(Math.max(parseInt(searchParams.get('pageSize') || '10', 10), 1), 100);
    const includeDeleted = searchParams.get('includeDeleted') === '1';

    const allowedOrder = new Set(['tanggal_mulai', 'tanggal_selesai', 'created_at', 'updated_at', 'status']);
    const orderByParam = (searchParams.get('orderBy') || 'created_at').trim();
    const orderByField = allowedOrder.has(orderByParam) ? orderByParam : 'created_at';
    const sort = (searchParams.get('sort') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    const where = {
      ...(includeDeleted ? {} : { deleted_at: null }),
    };

    const idUser = (searchParams.get('id_user') || '').trim();
    if (idUser) where.id_user = idUser;

    const idPolaKerjaRaw = searchParams.get('id_pola_kerja');
    if (idPolaKerjaRaw !== null) {
      const trimmed = idPolaKerjaRaw.trim();
      if (trimmed === 'null') where.id_pola_kerja = null;
      else if (trimmed) where.id_pola_kerja = trimmed;
    }

    // === Perbaikan: relation filter pakai { is: ... } ===
    const userFilter = {};
    const jabatanParam = searchParams.get('id_jabatan');
    if (jabatanParam !== null) {
      const trimmed = jabatanParam.trim();
      if (trimmed === 'null') userFilter.id_jabatan = null;
      else if (trimmed) userFilter.id_jabatan = trimmed;
    }
    const jabatanSearch = (searchParams.get('searchJabatan') || '').trim();
    if (jabatanSearch) {
      userFilter.jabatan = {
        ...(userFilter.jabatan ?? {}),
        is: {
          ...(userFilter.jabatan?.is ?? {}),
          nama_jabatan: { contains: jabatanSearch, mode: 'insensitive' },
        },
      };
    }
    if (Object.keys(userFilter).length > 0) {
      where.user = { is: userFilter }; // <-- penting
    }

    const status = (searchParams.get('status') || '').trim();
    if (status) {
      const normalized = status.toUpperCase();
      if (!SHIFT_STATUS.includes(normalized)) {
        return NextResponse.json({ message: "Parameter 'status' tidak valid." }, { status: 400 });
      }
      where.status = normalized;
    }

    const tanggalMulaiFilter = buildDateFilter(searchParams, 'tanggalMulai');
    if (tanggalMulaiFilter) where.tanggal_mulai = tanggalMulaiFilter;
    const tanggalSelesaiFilter = buildDateFilter(searchParams, 'tanggalSelesai');
    if (tanggalSelesaiFilter) where.tanggal_selesai = tanggalSelesaiFilter;

    const [total, rawData] = await Promise.all([
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
          user: { select: { id_user: true, nama_pengguna: true, email: true } },
          polaKerja: { select: { id_pola_kerja: true, nama_pola_kerja: true } },
        },
      }),
    ]);

    const data = rawData.map(transformShiftRecord);
    return NextResponse.json({
      data,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('tanggal')) {
      return NextResponse.json({ message: err.message }, { status: 400 });
    }
    console.error('GET /shift-kerja error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
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
      const fallbackStart = body.tanggal_mulai ?? body.start_date ?? body.startDate ?? body.mulai ?? body.referenceDate ?? body.weekStart;

      const fallbackEnd = body.tanggal_selesai ?? body.end_date ?? body.endDate ?? body.selesai ?? body.until ?? body.weekEnd;

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

    console.info('[NOTIF] Mengirim notifikasi NEW_SHIFT_PUBLISHED untuk user %s dengan payload %o', upserted.id_user, notificationPayload);
    await sendNotification('NEW_SHIFT_PUBLISHED', upserted.id_user, notificationPayload);
    console.info('[NOTIF] Notifikasi NEW_SHIFT_PUBLISHED selesai diproses untuk user %s', upserted.id_user);

    return NextResponse.json({ message: 'Shift kerja disimpan.', data: transformShiftRecord(upserted) }, { status: 201 });
  } catch (err) {
    console.error('POST /shift-kerja error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
