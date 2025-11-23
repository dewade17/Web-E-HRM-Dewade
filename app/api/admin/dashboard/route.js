import { NextResponse } from 'next/server';
import db from '../../../../lib/prisma';
import { verifyAuthToken } from '../../../../lib/jwt';
import { authenticateRequest } from '../../../../app/utils/auth/authUtils';

// --- AUTH ---
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

// --- CONST & HELPERS ---
const DAY_LABELS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
// Tabs: hapus 'leave' & 'permit'
const PERFORMANCE_TABS = [
  { key: 'onTime', label: 'Tepat Waktu' },
  { key: 'late', label: 'Terlambat' },
  { key: 'absent', label: 'Tidak/belum hadir' },
  // { key: 'autoOut', label: 'Presensi Keluar Otomatis' },
];
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

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
  return new Date(
    Date.UTC(
      base.getUTCFullYear(),
      base.getUTCMonth(),
      base.getUTCDate(),
      time.getUTCHours(),
      time.getUTCMinutes(),
      time.getUTCSeconds()
    )
  );
}
function findShiftForDate(shifts, date) {
  if (!Array.isArray(shifts)) return null;
  const target = toUtcStart(date);
  for (const shift of shifts) {
    const start = shift.tanggal_mulai ? toUtcStart(shift.tanggal_mulai) : null;
    if (start && start <= target) {
      const end = shift.tanggal_selesai ? toUtcStart(shift.tanggal_selesai) : null;
      if (!end || end >= target) return shift;
    }
  }
  for (const shift of shifts) {
    if (!shift.tanggal_mulai) return shift;
  }
  return null;
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
function formatTime(date) {
  if (!(date instanceof Date) || isNaN(date)) return '—';
  return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
}

// Kalender: karena cuti/izin dihapus, kembalikan objek kosong
function buildEmptyCalendarEvents() {
  return {};
}

// === Top 5 builder (tanpa perubahan logika) ===
function buildTopRankings(attendanceRecords, shiftsByUser) {
  const metrics = new Map();
  for (const record of attendanceRecords) {
    const { user } = record;
    if (!user) continue;
    if (!metrics.has(user.id_user)) {
      metrics.set(user.id_user, {
        userId: user.id_user,
        name: user.nama_pengguna,
        division: user.departement?.nama_departement || '-',
        photo: user.foto_profil_user || null,
        jobTitle: user.jabatan?.nama_jabatan || '',
        lateCount: 0,
        totalLateMinutes: 0,
        attendanceCount: 0,
      });
    }
    const m = metrics.get(user.id_user);
    m.attendanceCount++;
    const shift = findShiftForDate(shiftsByUser.get(user.id_user) || [], record.tanggal);
    if (record.status_masuk === 'terlambat' && shift?.polaKerja) {
      m.lateCount++;
      const scheduledStart = combineDateTime(record.tanggal, shift.polaKerja.jam_mulai);
      const actualStart = record.jam_masuk ? new Date(record.jam_masuk) : null;
      if (scheduledStart && actualStart && actualStart > scheduledStart) {
        m.totalLateMinutes += Math.round((actualStart - scheduledStart) / 60000);
      }
    }
  }
  const allUsers = Array.from(metrics.values());
  const topLate = allUsers
    .filter((u) => u.lateCount > 0)
    .sort((a, b) => b.lateCount - a.lateCount || b.totalLateMinutes - a.totalLateMinutes)
    .slice(0, 5)
    .map((item, i) => ({
      rank: i + 1,
      userId: item.userId,
      name: item.name,
      division: item.division,
      photo: item.photo,
      jobTitle: item.jobTitle,
      count: `${item.lateCount} kali`,
      duration: formatDurationFromMinutes(item.totalLateMinutes),
    }));
  const topDiscipline = allUsers
    .map((item) => ({
      ...item,
      score: item.attendanceCount > 0 ? ((item.attendanceCount - item.lateCount) / item.attendanceCount) * 100 : 0,
    }))
    .sort((a, b) => b.score - a.score || b.attendanceCount - a.attendanceCount)
    .slice(0, 5)
    .map((item, i) => ({
      rank: i + 1,
      userId: item.userId,
      name: item.name,
      division: item.division,
      photo: item.photo,
      jobTitle: item.jobTitle,
      score: `${item.score.toFixed(0)}%`,
    }));
  return { topLate, topDiscipline };
}

// === Performa rows (leaves dikosongkan) ===
function buildPerformanceRows({ attendance, activeUsers }) {
  const rows = { onTime: [], late: [], absent: [], autoOut: [] };
  const attendedUserIds = new Set();

  for (const record of attendance) {
    attendedUserIds.add(record.id_user);
    const user = record.user;
    const baseRow = {
      id: record.id_absensi,
      userId: user.id_user,
      name: user.nama_pengguna,
      division: user.departement?.nama_departement || '-',
      photo: user.foto_profil_user || null,
      jobTitle: user.jabatan?.nama_jabatan || '',
    };
    if (record.jam_masuk) {
      if (record.status_masuk === 'terlambat') rows.late.push({ ...baseRow, time: formatTime(record.jam_masuk) });
      else rows.onTime.push({ ...baseRow, time: formatTime(record.jam_masuk) });
    }
    if (!record.face_verified_pulang && record.jam_pulang) {
      rows.autoOut.push({ ...baseRow, time: formatTime(record.jam_pulang) });
    }
  }

  for (const user of activeUsers) {
    if (!attendedUserIds.has(user.id_user)) {
      rows.absent.push({
        id: `absent-${user.id_user}`,
        userId: user.id_user,
        name: user.nama_pengguna,
        division: user.departement?.nama_departement || '-',
        photo: user.foto_profil_user || null,
        jobTitle: user.jabatan?.nama_jabatan || '',
        time: '—',
      });
    }
  }

  return rows;
}

function applySearchFilter(allRows, query) {
  if (!query) return allRows;
  const q = query.toLowerCase();
  const filteredRows = {};
  for (const key in allRows) {
    filteredRows[key] = allRows[key].filter((row) => {
      const hay = [row.name, row.division, row.jobTitle].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }
  return filteredRows;
}

// --- HANDLER ---
export async function GET(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(req.url);
    const now = new Date();

    const divisionId = searchParams.get('divisionId') || null;
    const calendarYear = parseInt(searchParams.get('calendarYear') || now.getFullYear(), 10);
    const calendarMonth = parseInt(searchParams.get('calendarMonth') || now.getMonth(), 10);

    const perfDateStr = searchParams.get('performanceDate');
    const perfDivisionId = searchParams.get('performanceDivisionId') || null;
    const perfQuery = searchParams.get('performanceQuery') || '';

    const performanceDate = perfDateStr ? toUtcStart(new Date(perfDateStr)) : toUtcStart(now);

    const todayEnd = toUtcEnd(now);
    const chartRangeStart = toUtcStart(new Date(now.getTime() - 6 * ONE_DAY_MS));
    const thisMonthStart = toUtcStart(new Date(now.getFullYear(), now.getMonth(), 1));
    const lastMonthStart = toUtcStart(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const lastMonthEnd = toUtcEnd(new Date(now.getFullYear(), now.getMonth(), 0));
    const perfDateEnd = toUtcEnd(performanceDate);

    const [
      totalKaryawan,
      totalDivisi,
      totalLokasi,
      totalPolaKerja,
      totalAdmin,
      divisions,
      miniBarRaw,
      chartAttendance,
      topThisMonthAttendance,
      topLastMonthAttendance,
      performanceAttendance,
      performanceActiveUsers,
    ] = await db.$transaction([
      db.user.count({ where: { status_kerja: 'AKTIF', deleted_at: null } }),
      db.departement.count({ where: { deleted_at: null } }),
      db.location.count({ where: { deleted_at: null } }),
      db.polaKerja.count({ where: { deleted_at: null } }),
      db.user.count({ where: { role: { in: ['HR', 'SUPERADMIN', 'DIREKTUR'] }, deleted_at: null } }),
      db.departement.findMany({
        where: { deleted_at: null },
        select: { id_departement: true, nama_departement: true },
        orderBy: { nama_departement: 'asc' },
      }),
      db.user.groupBy({
        by: ['id_departement'],
        where: { status_kerja: 'AKTIF', deleted_at: null },
        _count: { id_user: true },
        orderBy: { _count: { id_user: 'desc' } },
        take: 5,
      }),
      // chart (7 hari)
      db.absensi.findMany({
        where: {
          tanggal: { gte: chartRangeStart, lte: todayEnd },
          deleted_at: null,
          ...(divisionId && { user: { id_departement: divisionId } }),
        },
        select: { id_user: true, tanggal: true, jam_masuk: true, jam_pulang: true },
      }),
      // top 5 (bulan ini)
      db.absensi.findMany({
        where: { tanggal: { gte: thisMonthStart, lte: todayEnd }, deleted_at: null },
        include: {
          user: {
            select: {
              id_user: true,
              nama_pengguna: true,
              foto_profil_user: true,
              jabatan: { select: { id_jabatan: true, nama_jabatan: true } },
              departement: { select: { nama_departement: true } },
            },
          },
        },
      }),
      // top 5 (bulan lalu)
      db.absensi.findMany({
        where: { tanggal: { gte: lastMonthStart, lte: lastMonthEnd }, deleted_at: null },
        include: {
          user: {
            select: {
              id_user: true,
              nama_pengguna: true,
              foto_profil_user: true,
              jabatan: { select: { id_jabatan: true, nama_jabatan: true } },
              departement: { select: { nama_departement: true } },
            },
          },
        },
      }),
      // Performance (tanggal dipilih)
      db.absensi.findMany({
        where: {
          tanggal: { gte: performanceDate, lte: perfDateEnd },
          deleted_at: null,
          ...(perfDivisionId && { user: { id_departement: perfDivisionId } }),
        },
        include: {
          user: {
            select: {
              id_user: true,
              nama_pengguna: true,
              foto_profil_user: true,
              jabatan: { select: { id_jabatan: true, nama_jabatan: true } },
              departement: { select: { nama_departement: true } },
            },
          },
        },
      }),
      db.user.findMany({
        where: { status_kerja: 'AKTIF', deleted_at: null, ...(perfDivisionId && { id_departement: perfDivisionId }) },
        select: {
          id_user: true,
          nama_pengguna: true,
          foto_profil_user: true,
          jabatan: { select: { id_jabatan: true, nama_jabatan: true } },
          departement: { select: { nama_departement: true } },
        },
      }),
    ]);

    // shift untuk hitung telat
    const userIdSet = new Set();
    [...topThisMonthAttendance, ...topLastMonthAttendance, ...performanceAttendance.map((p) => p.user)].forEach((rec) => {
      if (rec?.id_user) userIdSet.add(rec.id_user);
    });
    const shiftRecords =
      userIdSet.size > 0
        ? await db.shiftKerja.findMany({
            where: { id_user: { in: [...userIdSet] }, status: 'KERJA', deleted_at: null },
            include: { polaKerja: { select: { jam_mulai: true, jam_selesai: true } } },
            orderBy: { tanggal_mulai: 'desc' },
          })
        : [];
    const shiftsByUser = new Map();
    shiftRecords.forEach((s) => {
      if (!shiftsByUser.has(s.id_user)) shiftsByUser.set(s.id_user, []);
      shiftsByUser.get(s.id_user).push(s);
    });

    // mini bars per divisi
    const departementNameMap = new Map(divisions.map((d) => [d.id_departement, d.nama_departement]));
    const miniBars = miniBarRaw.map((item) => ({
      label: departementNameMap.get(item.id_departement) || 'Lainnya',
      value: item._count.id_user,
    }));

    // CHART (7 hari): jumlah jam_masuk / jam_pulang
    const chartDayBuckets = new Map();
    for (let i = 0; i < 7; i++) {
      const date = new Date(chartRangeStart.getTime() + i * ONE_DAY_MS);
      chartDayBuckets.set(date.toISOString().slice(0, 10), {
        name: DAY_LABELS[date.getUTCDay()],
        Kedatangan: 0,
        Kepulangan: 0,
      });
    }
    for (const record of chartAttendance) {
      const key = record.tanggal.toISOString().slice(0, 10);
      if (!chartDayBuckets.has(key)) continue;
      const bucket = chartDayBuckets.get(key);
      if (record.jam_masuk) bucket.Kedatangan += 1;
      if (record.jam_pulang) bucket.Kepulangan += 1;
    }
    const chartData = Array.from(chartDayBuckets.values());

    // Top 5
    const top5ThisMonth = buildTopRankings(topThisMonthAttendance, shiftsByUser);
    const top5LastMonth = buildTopRankings(topLastMonthAttendance, shiftsByUser);

    // Performance rows (leaves ditiadakan)
    const perfRowsAll = buildPerformanceRows({
      attendance: performanceAttendance,
      activeUsers: performanceActiveUsers,
    });
    const perfRows = applySearchFilter(perfRowsAll, perfQuery);

    // response
    const divisionOptions = divisions.map((d) => ({ label: d.nama_departement, value: d.id_departement }));

    return NextResponse.json({
      tanggalTampilan: now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      totalKaryawan,
      totalDivisi,
      statCards: {
        lokasi: totalLokasi,
        presensi: await db.absensi.count({ where: { deleted_at: null } }),
        admin: totalAdmin,
        polaKerja: totalPolaKerja,
        izin: 0, // di-nolkan sementara
      },
      miniBars,
      chartData,

      // Seksi "Karyawan Cuti" tetap ada di UI, tapi kosong
      onLeaveCount: 0,
      leaveList: [],

      divisionOptions,

      top5Late: { this: top5ThisMonth.topLate, last: top5LastMonth.topLate },
      top5Discipline: { this: top5ThisMonth.topDiscipline, last: top5LastMonth.topDiscipline },

      // Kalender kosong (tidak ambil cuti/izin)
      calendar: { year: calendarYear, month: calendarMonth, eventsByDay: buildEmptyCalendarEvents() },

      perfTabs: PERFORMANCE_TABS,
      perfDivisionOptions: [{ label: '--Semua Divisi--', value: '' }, ...divisionOptions],
      perfDate: performanceDate.toISOString(),
      perfRows,
    });
  } catch (err) {
    console.error('GET /api/admin/dashboard error:', err);
    const errorMessage = process.env.NODE_ENV === 'development' ? err.message : 'Terjadi kesalahan pada server.';
    return NextResponse.json({ message: errorMessage }, { status: 500 });
  }
}
