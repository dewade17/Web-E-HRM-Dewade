import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';

async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      verifyAuthToken(auth.slice(7));
      return true;
    } catch (_) {
      /* fallback ke NextAuth */
    }
  }
  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;
  return true;
}

const DAY_LABELS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const DAY_NAME_TO_INDEX = {
  MINGGU: 0,
  AHAD: 0,
  SUNDAY: 0,
  SUN: 0,
  SENIN: 1,
  SEN: 1,
  MONDAY: 1,
  MON: 1,
  SELASA: 2,
  SEL: 2,
  TUESDAY: 2,
  TUE: 2,
  RABU: 3,
  RAB: 3,
  WEDNESDAY: 3,
  WED: 3,
  KAMIS: 4,
  KAM: 4,
  THURSDAY: 4,
  THU: 4,
  JUMAT: 5,
  "JUM'AT": 5,
  JUM: 5,
  FRIDAY: 5,
  FRI: 5,
  SABTU: 6,
  SAB: 6,
  SATURDAY: 6,
  SAT: 6,
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function stringToColor(str) {
  const input = str || '';
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0; // force 32bit
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

function toUtcStart(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function toUtcEnd(date) {
  const end = toUtcStart(date);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

function combineDateTime(date, timeValue) {
  if (!date || !timeValue) return null;
  const base = new Date(date);
  const time = new Date(timeValue);
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), time.getUTCHours(), time.getUTCMinutes(), time.getUTCSeconds(), time.getUTCMilliseconds()));
}

function parseDayIndex(value) {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return ((value % 7) + 7) % 7;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toUpperCase();
    if (normalized in DAY_NAME_TO_INDEX) {
      return DAY_NAME_TO_INDEX[normalized];
    }
  }
  if (value && typeof value === 'object') {
    if (typeof value.index === 'number') {
      return parseDayIndex(value.index);
    }
    if (typeof value.day === 'string') {
      return parseDayIndex(value.day);
    }
    if (typeof value.name === 'string') {
      return parseDayIndex(value.name);
    }
    if (typeof value.localizedName === 'string') {
      return parseDayIndex(value.localizedName);
    }
  }
  return null;
}

function extractShiftDayIndexes(raw) {
  if (raw === undefined || raw === null) return null;
  let value = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      value = JSON.parse(trimmed);
    } catch (_) {
      const single = parseDayIndex(trimmed);
      return single !== null ? [single] : null;
    }
  }
  const indexes = new Set();
  const collect = (entry) => {
    const idx = parseDayIndex(entry);
    if (idx !== null) {
      indexes.add(idx);
    }
  };
  if (Array.isArray(value)) {
    value.forEach(collect);
  } else if (value && typeof value === 'object') {
    const candidates = [value.days, value.weekdays, value.hari_kerja, value.hariKerja, value.list];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        candidate.forEach(collect);
      }
    }
  }
  return indexes.size > 0 ? Array.from(indexes) : null;
}

function isShiftActiveOnDate(shift, date) {
  if (!shift) return false;
  const target = new Date(date);
  const start = shift.tanggal_mulai ? new Date(shift.tanggal_mulai) : null;
  const end = shift.tanggal_selesai ? new Date(shift.tanggal_selesai) : null;
  if (start && start > target) return false;
  if (end && end < target) return false;
  const indexes = extractShiftDayIndexes(shift.hari_kerja);
  if (indexes && indexes.length > 0) {
    const dayIndex = target.getUTCDay();
    if (!indexes.includes(dayIndex)) {
      return false;
    }
  }
  return true;
}

function findShiftForDate(shifts, date) {
  if (!Array.isArray(shifts) || shifts.length === 0) return null;
  for (const shift of shifts) {
    if (isShiftActiveOnDate(shift, date)) {
      return shift;
    }
  }
  return null;
}

export async function GET(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(req.url);
    const divisionIdParam = (searchParams.get('divisionId') || '').trim();
    const divisionId = divisionIdParam || null;

    const now = new Date();
    const todayStart = toUtcStart(now);
    const todayEnd = toUtcEnd(now);
    const rangeStart = new Date(todayStart);
    rangeStart.setUTCDate(rangeStart.getUTCDate() - 6);

    const activeUserWhere = { deleted_at: null, status_kerja: 'AKTIF' };

    const [totalKaryawan, totalDivisi, divisions] = await Promise.all([
      db.user.count({ where: activeUserWhere }),
      db.departement.count({ where: { deleted_at: null } }),
      db.departement.findMany({
        where: { deleted_at: null },
        orderBy: { nama_departement: 'asc' },
        select: { id_departement: true, nama_departement: true },
      }),
    ]);

    const divisionOptions = divisions.map((item) => ({
      value: item.id_departement,
      label: item.nama_departement,
    }));

    const departementNameMap = new Map(divisions.map((item) => [item.id_departement, item.nama_departement]));

    const miniBarRaw = await db.user.groupBy({
      by: ['id_departement'],
      where: activeUserWhere,
      _count: { _all: true },
      orderBy: { _count: { _all: 'desc' } },
      take: 5,
    });

    const miniBars = miniBarRaw.map((item) => ({
      label: (item.id_departement && departementNameMap.get(item.id_departement)) || (item.id_departement ? 'Departemen Tidak Aktif' : 'Tanpa Departemen'),
      value: item._count._all,
    }));

    const leaveToday = await db.cuti.findMany({
      where: {
        deleted_at: null,
        status: 'disetujui',
        tanggal_mulai: { lte: todayEnd },
        tanggal_selesai: { gte: todayStart },
      },
      orderBy: { tanggal_mulai: 'asc' },
      select: {
        id_cuti: true,
        tanggal_mulai: true,
        tanggal_selesai: true,
        user: {
          select: {
            nama_pengguna: true,
            departement: { select: { nama_departement: true } },
          },
        },
      },
    });

    const leaveList = leaveToday.map((item) => {
      const start = item.tanggal_mulai ? new Date(item.tanggal_mulai) : null;
      const end = item.tanggal_selesai ? new Date(item.tanggal_selesai) : null;
      let durasiHari = 0;
      if (start && end) {
        durasiHari = Math.max(1, Math.round((end.getTime() - start.getTime()) / ONE_DAY_MS) + 1);
      }
      const nama = item.user?.nama_pengguna || 'Tanpa Nama';
      return {
        id: item.id_cuti,
        nama,
        departemen: item.user?.departement?.nama_departement || '-',
        tanggal_mulai: start ? start.toISOString() : null,
        tanggal_selesai: end ? end.toISOString() : null,
        durasiHari,
        warna: stringToColor(nama),
      };
    });

    const onLeaveCount = leaveList.length;

    const attendanceWhere = {
      deleted_at: null,
      tanggal: { gte: rangeStart, lte: todayEnd },
      ...(divisionId
        ? {
            user: {
              id_departement: divisionId,
            },
          }
        : {}),
    };

    const attendance = await db.absensi.findMany({
      where: attendanceWhere,
      select: {
        id_absensi: true,
        id_user: true,
        tanggal: true,
        jam_masuk: true,
        jam_pulang: true,
      },
    });

    const userIds = Array.from(new Set(attendance.map((item) => item.id_user))).filter(Boolean);

    let shiftsByUser = new Map();
    if (userIds.length > 0) {
      const shiftRecords = await db.shiftKerja.findMany({
        where: {
          deleted_at: null,
          status: 'KERJA',
          id_user: { in: userIds },
          AND: [
            {
              OR: [{ tanggal_mulai: null }, { tanggal_mulai: { lte: todayEnd } }],
            },
            {
              OR: [{ tanggal_selesai: null }, { tanggal_selesai: { gte: rangeStart } }],
            },
          ],
        },
        orderBy: [{ tanggal_mulai: 'desc' }, { updated_at: 'desc' }],
        select: {
          id_user: true,
          tanggal_mulai: true,
          tanggal_selesai: true,
          hari_kerja: true,
          polaKerja: {
            select: {
              jam_mulai: true,
              jam_selesai: true,
            },
          },
        },
      });

      shiftsByUser = shiftRecords.reduce((acc, item) => {
        if (!acc.has(item.id_user)) {
          acc.set(item.id_user, []);
        }
        acc.get(item.id_user).push(item);
        return acc;
      }, new Map());
    }

    const dayBuckets = new Map();
    for (let i = 6; i >= 0; i -= 1) {
      const day = new Date(todayStart);
      day.setUTCDate(day.getUTCDate() - i);
      const key = day.toISOString().slice(0, 10);
      dayBuckets.set(key, { date: day, Kedatangan: 0, Kepulangan: 0 });
    }

    for (const record of attendance) {
      if (!record.tanggal) continue;
      const day = new Date(record.tanggal);
      const key = day.toISOString().slice(0, 10);
      const bucket = dayBuckets.get(key);
      if (!bucket) continue;
      const shifts = shiftsByUser.get(record.id_user);
      const shift = findShiftForDate(shifts, day);
      const pola = shift?.polaKerja;
      if (!pola) continue;
      const scheduledStart = combineDateTime(day, pola.jam_mulai);
      const scheduledEnd = combineDateTime(day, pola.jam_selesai);
      const actualStart = record.jam_masuk ? new Date(record.jam_masuk) : null;
      const actualEnd = record.jam_pulang ? new Date(record.jam_pulang) : null;
      if (scheduledStart && actualStart) {
        const diff = Math.max(0, Math.round((actualStart.getTime() - scheduledStart.getTime()) / 60000));
        bucket.Kedatangan += diff;
      }
      if (scheduledEnd && actualEnd) {
        const diff = Math.max(0, Math.round((scheduledEnd.getTime() - actualEnd.getTime()) / 60000));
        bucket.Kepulangan += diff;
      }
    }

    const chartData = Array.from(dayBuckets.values()).map((item) => ({
      name: DAY_LABELS[item.date.getUTCDay()],
      Kedatangan: item.Kedatangan,
      Kepulangan: item.Kepulangan,
    }));

    return NextResponse.json({
      totalKaryawan,
      totalDivisi,
      miniBars,
      onLeaveCount,
      leaveList,
      chartData,
      divisionOptions,
      divisionId,
      defaultDivisionId: divisionOptions[0]?.value || null,
      tanggalTampilan: now.toISOString(),
    });
  } catch (err) {
    console.error('GET /api/admin/dashboard error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
