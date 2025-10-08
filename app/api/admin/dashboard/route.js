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

const PERFORMANCE_TABS = [
  { key: 'onTime', label: 'Tepat Waktu' },
  { key: 'late', label: 'Terlambat' },
  { key: 'absent', label: 'Tidak/belum hadir' },
  { key: 'autoOut', label: 'Presensi Keluar Otomatis' },
  { key: 'leave', label: 'Cuti' },
  { key: 'permit', label: 'Izin' },
];

const CALENDAR_TYPE_META = {
  cuti: { color: 'bg-emerald-500', label: 'Cuti' },
  sakit: { color: 'bg-rose-500', label: 'Sakit' },
  izin: { color: 'bg-amber-500', label: 'Izin' },
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
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
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

function formatIndonesianDate(date) {
  return new Date(date).toLocaleDateString('id-ID', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function formatTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(11, 19);
}

function formatDurationFromMinutes(totalMinutes) {
  const minutes = Math.max(0, Math.round(totalMinutes || 0));
  if (minutes === 0) return '0 menit';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const parts = [];
  if (hours > 0) parts.push(`${hours} jam`);
  if (mins > 0) parts.push(`${mins} menit`);
  return parts.join(' ');
}

function buildCalendarEvents(leaves, year, monthIndex) {
  if (!Array.isArray(leaves) || leaves.length === 0) {
    return {};
  }
  const events = new Map();
  const monthStart = new Date(Date.UTC(year, monthIndex, 1));
  const monthEnd = toUtcEnd(new Date(Date.UTC(year, monthIndex + 1, 0)));
  for (const leave of leaves) {
    const start = leave.tanggal_mulai ? toUtcStart(leave.tanggal_mulai) : null;
    const end = leave.tanggal_selesai ? toUtcEnd(leave.tanggal_selesai) : null;
    if (!start || !end) continue;
    const effectiveStart = start > monthStart ? start : monthStart;
    const effectiveEnd = end < monthEnd ? end : monthEnd;
    for (let cursor = new Date(effectiveStart); cursor <= effectiveEnd; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const day = cursor.getUTCDate();
      if (!events.has(day)) {
        events.set(day, {
          total: 0,
          counts: { cuti: 0, sakit: 0, izin: 0 },
          names: [],
        });
      }
      const entry = events.get(day);
      entry.total += 1;
      const type = leave.keterangan || 'cuti';
      if (entry.counts[type] !== undefined) {
        entry.counts[type] += 1;
      }
      if (leave.userName) {
        entry.names.push(leave.userName);
      }
    }
  }
  const result = {};
  for (const [day, info] of events.entries()) {
    const dominantType = ['cuti', 'sakit', 'izin'].reduce((acc, type) => {
      if ((info.counts[type] || 0) > (info.counts[acc] || 0)) {
        return type;
      }
      return acc;
    }, 'cuti');
    const meta = CALENDAR_TYPE_META[dominantType] || { color: 'bg-slate-400', label: 'Kegiatan' };
    const parts = [];
    for (const [type, count] of Object.entries(info.counts)) {
      if (count > 0) {
        const label = CALENDAR_TYPE_META[type]?.label || type;
        parts.push(`${count} ${label}`);
      }
    }
    const tip = parts.join(', ');
    result[day] = {
      color: meta.color,
      tip: tip || `${info.total} ${meta.label}`,
      total: info.total,
      counts: info.counts,
    };
  }
  return result;
}

function applySearchFilter(rows, query) {
  if (!query) return rows;
  const q = query.toLowerCase();
  return rows.filter((row) => {
    const name = row.name ? row.name.toLowerCase() : '';
    const division = row.division ? row.division.toLowerCase() : '';
    return name.includes(q) || division.includes(q);
  });
}

function buildPerformanceRows({ attendance, leaves, activeUsers, shiftsByUser }) {
  const rows = {
    onTime: [],
    late: [],
    absent: [],
    autoOut: [],
    leave: [],
    permit: [],
  };

  const attendanceByUser = new Map();
  for (const record of attendance) {
    attendanceByUser.set(record.id_user, record);
    const division = record.user?.departement?.nama_departement || '-';
    const name = record.user?.nama_pengguna || 'Tanpa Nama';
    const recordDate = record.tanggal ? new Date(record.tanggal) : null;
    const actualStart = record.jam_masuk ? new Date(record.jam_masuk) : null;
    const actualEnd = record.jam_pulang ? new Date(record.jam_pulang) : null;

    const shiftList = shiftsByUser.get(record.id_user) || [];
    const shift = recordDate ? findShiftForDate(shiftList, recordDate) : null;
    const scheduledStart = shift?.polaKerja ? combineDateTime(recordDate, shift.polaKerja.jam_mulai) : null;
    const scheduledEnd = shift?.polaKerja ? combineDateTime(recordDate, shift.polaKerja.jam_selesai) : null;

    let minutesLate = 0;
    if (scheduledStart && actualStart) {
      const diffMs = actualStart.getTime() - scheduledStart.getTime();
      if (diffMs > 0) {
        minutesLate = Math.round(diffMs / 60000);
      }
    }
    if (!scheduledStart && record.status_masuk === 'terlambat') {
      minutesLate = Math.max(minutesLate, 1);
    }

    const baseRow = {
      id: record.id_absensi,
      userId: record.id_user,
      name,
      division,
      date: recordDate ? recordDate.toISOString() : null,
    };

    if (actualStart) {
      const time = formatTime(actualStart);
      if (minutesLate > 0 || record.status_masuk === 'terlambat') {
        rows.late.push({ ...baseRow, time, minutesLate });
      } else {
        rows.onTime.push({ ...baseRow, time });
      }
    } else {
      rows.absent.push({ ...baseRow, time: '—' });
    }

    const isAutoOut = !record.face_verified_pulang && !!actualEnd;
    if (isAutoOut || (!actualEnd && scheduledEnd)) {
      rows.autoOut.push({ ...baseRow, time: actualEnd ? formatTime(actualEnd) : null });
    }
  }

  for (const user of activeUsers) {
    if (!attendanceByUser.has(user.id_user)) {
      rows.absent.push({
        id: `absent-${user.id_user}`,
        userId: user.id_user,
        name: user.nama_pengguna || 'Tanpa Nama',
        division: user.departement?.nama_departement || '-',
        time: '—',
      });
    }
  }

  for (const leave of leaves) {
    const division = leave.user?.departement?.nama_departement || '-';
    const name = leave.user?.nama_pengguna || 'Tanpa Nama';
    const row = {
      id: leave.id_cuti,
      userId: leave.user?.id_user || null,
      name,
      division,
      time: leave.alasan || CALENDAR_TYPE_META[leave.keterangan || 'cuti']?.label || 'Cuti',
      type: leave.keterangan || 'cuti',
    };
    if (leave.keterangan === 'izin') {
      rows.permit.push(row);
    } else {
      rows.leave.push(row);
    }
  }

  rows.onTime.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  rows.late.sort((a, b) => (b.minutesLate || 0) - (a.minutesLate || 0) || (a.time || '').localeCompare(b.time || ''));
  rows.autoOut.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  rows.absent.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  rows.leave.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  rows.permit.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  return rows;
}

function buildTopMetrics(records, shiftsByUser) {
  const metrics = new Map();
  for (const record of records) {
    if (!record.user) continue;
    const userId = record.id_user;
    if (!metrics.has(userId)) {
      metrics.set(userId, {
        userId,
        name: record.user.nama_pengguna || 'Tanpa Nama',
        division: record.user.departement?.nama_departement || '-',
        lateCount: 0,
        totalLateMinutes: 0,
        totalAttendance: 0,
      });
    }
    const metric = metrics.get(userId);
    metric.totalAttendance += 1;

    const recordDate = record.tanggal ? new Date(record.tanggal) : null;
    const actualStart = record.jam_masuk ? new Date(record.jam_masuk) : null;
    const shiftList = shiftsByUser.get(userId) || [];
    const shift = recordDate ? findShiftForDate(shiftList, recordDate) : null;
    const scheduledStart = shift?.polaKerja ? combineDateTime(recordDate, shift.polaKerja.jam_mulai) : null;

    let minutesLate = 0;
    if (scheduledStart && actualStart) {
      const diffMs = actualStart.getTime() - scheduledStart.getTime();
      if (diffMs > 0) {
        minutesLate = Math.round(diffMs / 60000);
      }
    }
    if (!scheduledStart && record.status_masuk === 'terlambat') {
      minutesLate = Math.max(minutesLate, 1);
    }

    if (minutesLate > 0 || record.status_masuk === 'terlambat') {
      metric.lateCount += 1;
      metric.totalLateMinutes += minutesLate;
    }
  }
  return metrics;
}

function buildTopLateRows(metrics) {
  return Array.from(metrics.values())
    .filter((item) => item.lateCount > 0)
    .sort((a, b) => b.lateCount - a.lateCount || b.totalLateMinutes - a.totalLateMinutes || (a.name || '').localeCompare(b.name || ''))
    .slice(0, 5)
    .map((item, index) => ({
      rank: index + 1,
      userId: item.userId,
      name: item.name,
      division: item.division,
      count: `${item.lateCount} hari`,
      duration: formatDurationFromMinutes(item.totalLateMinutes),
    }));
}

function buildTopDisciplineRows(metrics) {
  return Array.from(metrics.values())
    .filter((item) => item.totalAttendance > 0)
    .map((item) => {
      const punctual = item.totalAttendance - item.lateCount;
      const score = item.totalAttendance > 0 ? (punctual / item.totalAttendance) * 100 : 0;
      return {
        ...item,
        score,
      };
    })
    .sort((a, b) => b.score - a.score || b.totalAttendance - a.totalAttendance || (a.name || '').localeCompare(b.name || ''))
    .slice(0, 5)
    .map((item, index) => ({
      rank: index + 1,
      userId: item.userId,
      name: item.name,
      division: item.division,
      score: `${Math.round(item.score)}%`,
    }));
}

export async function GET(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(req.url);
    const divisionIdParam = (searchParams.get('divisionId') || '').trim();
    const divisionId = divisionIdParam || null;
    const performanceDateParam = searchParams.get('performanceDate');
    const performanceDivisionParam = (searchParams.get('performanceDivisionId') || '').trim();
    const performanceDivisionId = performanceDivisionParam || null;
    const performanceQuery = (searchParams.get('performanceQuery') || '').trim();
    const calendarYearParam = searchParams.get('calendarYear');
    const calendarMonthParam = searchParams.get('calendarMonth');

    const now = new Date();
    const todayStart = toUtcStart(now);
    const todayEnd = toUtcEnd(now);
    const chartRangeStart = new Date(todayStart);
    chartRangeStart.setUTCDate(chartRangeStart.getUTCDate() - 6);

    const performanceDate = performanceDateParam ? new Date(performanceDateParam) : now;
    if (Number.isNaN(performanceDate.getTime())) {
      performanceDate.setTime(now.getTime());
    }
    const performanceStart = toUtcStart(performanceDate);
    const performanceEnd = toUtcEnd(performanceDate);

    const calendarYear = calendarYearParam ? Number.parseInt(calendarYearParam, 10) : now.getUTCFullYear();
    const calendarMonthRaw = calendarMonthParam ? Number.parseInt(calendarMonthParam, 10) : now.getUTCMonth();
    const calendarMonth = Number.isNaN(calendarMonthRaw) ? now.getUTCMonth() : calendarMonthRaw;
    const calendarMonthStart = new Date(Date.UTC(calendarYear, calendarMonth, 1));
    const calendarMonthEnd = toUtcEnd(new Date(Date.UTC(calendarYear, calendarMonth + 1, 0)));

    const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const thisMonthEnd = toUtcEnd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)));
    const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const lastMonthEnd = toUtcEnd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)));

    const activeUserWhere = { deleted_at: null, status_kerja: 'AKTIF' };

    const [totalKaryawan, totalDivisi, divisions, miniBarRaw, chartAttendance, leaveToday, performanceAttendance, performanceLeaves, performanceActiveUsers, topThisAttendance, topLastAttendance, calendarLeaves] = await Promise.all([
      db.user.count({ where: activeUserWhere }),
      db.departement.count({ where: { deleted_at: null } }),
      db.departement.findMany({
        where: { deleted_at: null },
        orderBy: { nama_departement: 'asc' },
        select: { id_departement: true, nama_departement: true },
      }),
      db.user.groupBy({
        by: ['id_departement'],
        where: activeUserWhere,
        _count: { _all: true },
        orderBy: { _count: { _all: 'desc' } },
        take: 5,
      }),
      db.absensi.findMany({
        where: {
          deleted_at: null,
          tanggal: { gte: chartRangeStart, lte: todayEnd },
          ...(divisionId
            ? {
                user: {
                  id_departement: divisionId,
                },
              }
            : {}),
        },
        select: {
          id_absensi: true,
          id_user: true,
          tanggal: true,
          jam_masuk: true,
          jam_pulang: true,
        },
      }),
      db.cuti.findMany({
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
              id_user: true,
              nama_pengguna: true,
              departement: { select: { nama_departement: true } },
            },
          },
        },
      }),
      db.absensi.findMany({
        where: {
          deleted_at: null,
          tanggal: { gte: performanceStart, lte: performanceEnd },
          ...(performanceDivisionId
            ? {
                user: {
                  id_departement: performanceDivisionId,
                },
              }
            : {}),
        },
        select: {
          id_absensi: true,
          id_user: true,
          tanggal: true,
          jam_masuk: true,
          jam_pulang: true,
          status_masuk: true,
          face_verified_pulang: true,
          user: {
            select: {
              id_user: true,
              nama_pengguna: true,
              departement: { select: { nama_departement: true } },
            },
          },
        },
      }),
      db.cuti.findMany({
        where: {
          deleted_at: null,
          status: 'disetujui',
          tanggal_mulai: { lte: performanceEnd },
          tanggal_selesai: { gte: performanceStart },
          ...(performanceDivisionId
            ? {
                user: {
                  id_departement: performanceDivisionId,
                },
              }
            : {}),
        },
        select: {
          id_cuti: true,
          tanggal_mulai: true,
          tanggal_selesai: true,
          keterangan: true,
          alasan: true,
          user: {
            select: {
              id_user: true,
              nama_pengguna: true,
              departement: { select: { nama_departement: true } },
            },
          },
        },
      }),
      db.user.findMany({
        where: {
          ...activeUserWhere,
          ...(performanceDivisionId ? { id_departement: performanceDivisionId } : {}),
        },
        select: {
          id_user: true,
          nama_pengguna: true,
          departement: { select: { nama_departement: true } },
        },
      }),
      db.absensi.findMany({
        where: {
          deleted_at: null,
          tanggal: { gte: thisMonthStart, lte: thisMonthEnd },
        },
        select: {
          id_absensi: true,
          id_user: true,
          tanggal: true,
          jam_masuk: true,
          status_masuk: true,
          user: {
            select: {
              id_user: true,
              nama_pengguna: true,
              departement: { select: { nama_departement: true } },
            },
          },
        },
      }),
      db.absensi.findMany({
        where: {
          deleted_at: null,
          tanggal: { gte: lastMonthStart, lte: lastMonthEnd },
        },
        select: {
          id_absensi: true,
          id_user: true,
          tanggal: true,
          jam_masuk: true,
          status_masuk: true,
          user: {
            select: {
              id_user: true,
              nama_pengguna: true,
              departement: { select: { nama_departement: true } },
            },
          },
        },
      }),
      db.cuti.findMany({
        where: {
          deleted_at: null,
          status: 'disetujui',
          tanggal_mulai: { lte: calendarMonthEnd },
          tanggal_selesai: { gte: calendarMonthStart },
        },
        select: {
          id_cuti: true,
          tanggal_mulai: true,
          tanggal_selesai: true,
          keterangan: true,
          user: {
            select: {
              id_user: true,
              nama_pengguna: true,
            },
          },
        },
      }),
    ]);

    const departementNameMap = new Map(divisions.map((item) => [item.id_departement, item.nama_departement]));

    const miniBars = miniBarRaw.map((item) => ({
      label: (item.id_departement && departementNameMap.get(item.id_departement)) || (item.id_departement ? 'Departemen Tidak Aktif' : 'Tanpa Departemen'),
      value: item._count._all,
    }));

    const leaveList = leaveToday.map((item) => {
      const start = item.tanggal_mulai ? new Date(item.tanggal_mulai) : null;
      const end = item.tanggal_selesai ? new Date(item.tanggal_selesai) : null;
      let durasiHari = 0;
      if (start && end) {
        durasiHari = Math.max(1, Math.round((end.getTime() - start.getTime()) / ONE_DAY_MS) + 1);
      }
      const name = item.user?.nama_pengguna || 'Tanpa Nama';
      const division = item.user?.departement?.nama_departement || '-';
      return {
        id: item.id_cuti,
        name,
        nama: name,
        division,
        departemen: division,
        startDate: start ? start.toISOString() : null,
        endDate: end ? end.toISOString() : null,
        days: durasiHari,
        durasiHari,
        color: stringToColor(name),
      };
    });

    const onLeaveCount = leaveList.length;

    const userIdSet = new Set();
    const collectUserId = (record) => {
      if (record?.id_user) {
        userIdSet.add(record.id_user);
      }
    };
    chartAttendance.forEach(collectUserId);
    performanceAttendance.forEach(collectUserId);
    topThisAttendance.forEach(collectUserId);
    topLastAttendance.forEach(collectUserId);

    const shiftRangeStart = [chartRangeStart, performanceStart, thisMonthStart, lastMonthStart].reduce((min, date) => (date < min ? date : min), chartRangeStart);
    const shiftRangeEnd = [todayEnd, performanceEnd, thisMonthEnd, lastMonthEnd].reduce((max, date) => (date > max ? date : max), todayEnd);

    let shiftsByUser = new Map();
    if (userIdSet.size > 0) {
      const shiftRecords = await db.shiftKerja.findMany({
        where: {
          deleted_at: null,
          status: 'KERJA',
          id_user: { in: Array.from(userIdSet) },
          AND: [
            {
              OR: [{ tanggal_mulai: null }, { tanggal_mulai: { lte: shiftRangeEnd } }],
            },
            {
              OR: [{ tanggal_selesai: null }, { tanggal_selesai: { gte: shiftRangeStart } }],
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

    for (const record of chartAttendance) {
      if (!record.tanggal) continue;
      const day = new Date(record.tanggal);
      const key = day.toISOString().slice(0, 10);
      const bucket = dayBuckets.get(key);
      if (!bucket) continue;
      const shifts = shiftsByUser.get(record.id_user) || [];
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

    const performanceRowsAll = buildPerformanceRows({
      attendance: performanceAttendance,
      leaves: performanceLeaves,
      activeUsers: performanceActiveUsers,
      shiftsByUser,
    });

    const performanceRows = Object.fromEntries(Object.entries(performanceRowsAll).map(([key, value]) => [key, applySearchFilter(value, performanceQuery)]));

    const topThisMetrics = buildTopMetrics(topThisAttendance, shiftsByUser);
    const topLastMetrics = buildTopMetrics(topLastAttendance, shiftsByUser);

    const top5Late = {
      this: buildTopLateRows(topThisMetrics),
      last: buildTopLateRows(topLastMetrics),
    };

    const top5Discipline = {
      this: buildTopDisciplineRows(topThisMetrics),
      last: buildTopDisciplineRows(topLastMetrics),
    };

    const calendarEvents = buildCalendarEvents(
      calendarLeaves.map((item) => ({
        tanggal_mulai: item.tanggal_mulai,
        tanggal_selesai: item.tanggal_selesai,
        keterangan: item.keterangan,
        userName: item.user?.nama_pengguna || null,
      })),
      calendarYear,
      calendarMonth
    );

    const divisionOptions = divisions.map((item) => ({
      value: item.id_departement,
      label: item.nama_departement,
    }));

    return NextResponse.json({
      tanggalTampilan: formatIndonesianDate(now),
      todayIso: now.toISOString(),
      totalKaryawan,
      totalDivisi,
      miniBars,
      onLeaveCount,
      leaveList,
      chartData,
      divisionOptions,
      divisionId,
      defaultDivisionId: divisionOptions[0]?.value || null,
      perfTabs: PERFORMANCE_TABS,
      perfDate: performanceStart.toISOString(),
      perfDivisionId: performanceDivisionId,
      perfDivisionOptions: [{ label: '--Semua Divisi--', value: '' }, ...divisionOptions],
      perfRows: performanceRows,
      top5Late,
      top5Discipline,
      calendar: {
        year: calendarYear,
        month: calendarMonth,
        eventsByDay: calendarEvents,
      },
    });
  } catch (err) {
    console.error('GET /api/admin/dashboard error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
