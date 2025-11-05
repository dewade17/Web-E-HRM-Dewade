import { parseDateOnlyToUTC } from '../../../../helpers/date-helper';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Pemetaan token hari → index 0..6 (0=Minggu, 6=Sabtu) */
const DAY_TOKEN_TO_INDEX = new Map([
  // angka/cetakan umum
  ['0', 0],
  ['7', 0], // 7 ≡ Minggu
  // EN
  ['SUNDAY', 0],
  ['SUN', 0],
  ['MONDAY', 1],
  ['MON', 1],
  ['TUESDAY', 2],
  ['TUE', 2],
  ['WEDNESDAY', 3],
  ['WED', 3],
  ['THURSDAY', 4],
  ['THU', 4],
  ['FRIDAY', 5],
  ['FRI', 5],
  ['SATURDAY', 6],
  ['SAT', 6],
  // ID
  ['MINGGU', 0],
  ['AHAD', 0],
  ['SENIN', 1],
  ['SELASA', 2],
  ['RABU', 3],
  ['KAMIS', 4],
  ['JUMAT', 5],
  ['JUM’AT', 5], // variasi apostrof (dinormalisasi di normalizeToken)
  ['SABTU', 6],
  // singkatan lokal yang kadang dipakai
  ['MIN', 0],
  ['SEN', 1],
  ['SEL', 2],
  ['RAB', 3],
  ['KAM', 4],
  ['JUM', 5],
  ['SAB', 6],
]);

const DAY_INDEX_TO_NAME = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

const DAY_INDEX_TO_LOCAL = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

function normalizeToken(raw) {
  if (raw === undefined || raw === null) return '';
  // hapus tanda aksen/apostrof & whitespace → uppercase
  return String(raw)
    .normalize('NFKD')
    .replace(/['`´’]/g, '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

export function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function parseSingleDayToken(token) {
  if (token === undefined || token === null) {
    throw new Error('Nilai hari kerja tidak boleh kosong.');
  }

  if (typeof token === 'number') {
    if (!Number.isInteger(token)) {
      throw new Error('Nilai hari kerja harus berupa bilangan bulat.');
    }
    if (token >= 1 && token <= 7) return token % 7; // 7 → 0 (Minggu)
    if (token >= 0 && token <= 6) return token;
    throw new Error('Nilai hari kerja berada di luar rentang yang diizinkan.');
  }

  if (typeof token === 'string') {
    const normalized = normalizeToken(token);
    if (!normalized) {
      throw new Error('Nilai hari kerja tidak boleh berupa string kosong.');
    }
    if (DAY_TOKEN_TO_INDEX.has(normalized)) {
      return DAY_TOKEN_TO_INDEX.get(normalized);
    }
    // HARI1 .. HARI7
    if (/^HARI\d$/.test(normalized)) {
      const dayNumber = Number.parseInt(normalized.slice(4), 10);
      if (dayNumber >= 1 && dayNumber <= 7) {
        return dayNumber % 7;
      }
    }
    throw new Error(`Nilai hari kerja '${token}' tidak dikenali.`);
  }

  if (isPlainObject(token)) {
    if ('index' in token) return parseSingleDayToken(token.index);
    if ('dayIndex' in token) return parseSingleDayToken(token.dayIndex);
    if ('day' in token) return parseSingleDayToken(token.day);
    if ('hari' in token) return parseSingleDayToken(token.hari);
    if ('name' in token) return parseSingleDayToken(token.name);
  }

  throw new Error('Format nilai hari kerja tidak didukung.');
}

function parseDayList(days) {
  const indices = new Set();
  for (const item of days) {
    const index = parseSingleDayToken(item);
    indices.add(index);
  }
  return Array.from(indices).sort((a, b) => a - b);
}

function cloneDate(date) {
  return new Date(date.getTime());
}

/** Cari occurrence pertama dayIndex (0..6) ≥ startDate (UTC) */
function computeFirstOccurrence(startDate, dayIndex) {
  const base = cloneDate(startDate);
  const diff = (dayIndex - base.getUTCDay() + 7) % 7;
  base.setUTCDate(base.getUTCDate() + diff);
  return base;
}

/** Cari occurrence terakhir ≤ endDate (UTC), atau null jika none */
function computeLastOccurrence(firstOccurrence, endDate) {
  if (firstOccurrence > endDate) return null;
  const diffDays = Math.floor((endDate.getTime() - firstOccurrence.getTime()) / ONE_DAY_MS);
  const weeks = Math.floor(diffDays / 7);
  const result = cloneDate(firstOccurrence);
  result.setUTCDate(result.getUTCDate() + weeks * 7);
  return result;
}

/** Monday-based week start (UTC) */
function getWeekStart(date) {
  const result = cloneDate(date);
  const day = result.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday = 1
  result.setUTCDate(result.getUTCDate() + diff);
  return result;
}

function serializeDate(date) {
  return date.toISOString().slice(0, 10);
}

/** Normalisasi input tanggal (YYYY-MM-DD / Date / dsb) → UTC midnight Date. */
function resolveDateCandidate(value, fallback) {
  if (value === undefined || value === null || value === '') {
    if (fallback === undefined) return undefined;
    return resolveDateCandidate(fallback, undefined);
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined;
    // Normalisasi ke UTC 00:00
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const parsed = parseDateOnlyToUTC(value);
  if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) return undefined;
  return parsed; // parseDateOnlyToUTC sudah UTC midnight
}

/**
 * Normalisasi jadwal mingguan → { schedule, tanggalMulai, tanggalSelesai }
 * CATATAN: Agar kompatibel dengan schema baru (kolom non-null),
 * - Jika endDate tidak diberikan, tanggalSelesai akan otomatis = tanggalMulai (single-day).
 */
export function normalizeWeeklySchedule(rawInput, options = {}) {
  if (rawInput === undefined || rawInput === null) return null;

  const { fallbackStartDate, fallbackEndDate } = options;

  // Terima array → bungkus sebagai { days: [...] }
  let scheduleInput = rawInput;
  if (Array.isArray(scheduleInput)) {
    scheduleInput = { days: scheduleInput };
  }
  if (!isPlainObject(scheduleInput)) {
    throw new Error("Field 'hari_kerja' harus berupa objek jadwal mingguan yang valid.");
  }

  const typeRaw = scheduleInput.type ?? scheduleInput.pattern ?? scheduleInput.mode ?? scheduleInput.patternType ?? scheduleInput.jenis ?? 'WEEKLY';
  const type = String(typeRaw).trim().toUpperCase();
  if (type !== 'WEEKLY') {
    throw new Error("Saat ini hanya tipe jadwal mingguan ('WEEKLY') yang didukung.");
  }

  const startCandidate = scheduleInput.start_date ?? scheduleInput.startDate ?? scheduleInput.mulai ?? scheduleInput.referenceDate ?? scheduleInput.weekStart ?? fallbackStartDate;

  const startDate = resolveDateCandidate(startCandidate, undefined);
  if (!startDate) {
    throw new Error("Jadwal mingguan memerlukan 'start_date' yang valid.");
  }

  const endCandidate = scheduleInput.end_date ?? scheduleInput.endDate ?? scheduleInput.selesai ?? scheduleInput.until ?? scheduleInput.weekEnd ?? fallbackEndDate;

  const endDate = resolveDateCandidate(endCandidate, undefined);
  if (endDate && endDate < startDate) {
    throw new Error("Field 'end_date' tidak boleh lebih awal dari 'start_date'.");
  }

  const daysInput = scheduleInput.days ?? scheduleInput.day ?? scheduleInput.hari ?? scheduleInput.hari_kerja ?? scheduleInput.weekdays ?? scheduleInput.list;

  if (!Array.isArray(daysInput) || daysInput.length === 0) {
    throw new Error('Jadwal mingguan wajib memiliki minimal satu hari kerja.');
  }

  const dayIndexes = parseDayList(daysInput);
  if (dayIndexes.length === 0) {
    throw new Error('Jadwal mingguan wajib memiliki minimal satu hari kerja yang valid.');
  }

  const firstOccurrences = dayIndexes.map((dayIndex) => {
    const first = computeFirstOccurrence(startDate, dayIndex);
    return { dayIndex, first };
  });

  // earliestOccurrence = occurrence paling awal di ≥ startDate
  let earliestOccurrence = null;
  for (const { first } of firstOccurrences) {
    if (!earliestOccurrence || first < earliestOccurrence) earliestOccurrence = first;
  }
  if (!earliestOccurrence) {
    // fallback teoretis, harusnya tidak terjadi
    earliestOccurrence = startDate;
  }

  // latestOccurrence = occurrence terakhir ≤ endDate (jika ada endDate)
  let latestOccurrence = null;
  if (endDate) {
    for (const { first } of firstOccurrences) {
      const candidate = computeLastOccurrence(first, endDate);
      if (!candidate) continue;
      if (!latestOccurrence || candidate > latestOccurrence) {
        latestOccurrence = candidate;
      }
    }
    if (!latestOccurrence) {
      throw new Error('Rentang tanggal yang diberikan tidak mengandung hari kerja yang dipilih.');
    }
  } else {
    // **Schema DB non-null** → defaultkan ke earliestOccurrence (single-day)
    latestOccurrence = earliestOccurrence;
  }

  const weekStart = getWeekStart(earliestOccurrence);
  const weekEnd = cloneDate(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);

  const schedulePayload = {
    type: 'WEEKLY',
    startDate: serializeDate(startDate),
    endDate: endDate ? serializeDate(endDate) : serializeDate(latestOccurrence), // tampilkan tanggal akhir yang efektif
    days: firstOccurrences.map(({ dayIndex, first }) => ({
      index: dayIndex,
      day: DAY_INDEX_TO_NAME[dayIndex],
      localizedName: DAY_INDEX_TO_LOCAL[dayIndex],
      firstDate: serializeDate(first),
      offsetFromStart: Math.floor((first.getTime() - startDate.getTime()) / ONE_DAY_MS),
    })),
    weekReference: {
      firstWeekStart: serializeDate(weekStart),
      firstWeekEnd: serializeDate(weekEnd),
    },
  };

  return {
    schedule: schedulePayload,
    tanggalMulai: earliestOccurrence,
    tanggalSelesai: latestOccurrence,
  };
}

export function serializeHariKerja(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed;
  }
  return JSON.stringify(value);
}

export function parseHariKerjaField(value) {
  if (value === undefined || value === null) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return trimmed;
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

export function transformShiftRecord(record) {
  if (!record || typeof record !== 'object') return record;
  const hariKerjaParsed = parseHariKerjaField(record.hari_kerja);
  return { ...record, hari_kerja: hariKerjaParsed };
}

/** Ambil bentuk jadwal mingguan dari body (fleksibel: weekly_schedule / hari_kerja / days / dst.) */
export function extractWeeklyScheduleInput(body) {
  if (!body || typeof body !== 'object') return undefined;
  const candidates = [body.weekly_schedule, body.weeklySchedule, body.jadwal_mingguan, body.jadwalMingguan];
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null) {
      return candidate;
    }
  }
  const direct = body.hari_kerja ?? body.hariKerja ?? body.weekdays ?? body.days;
  if (direct !== undefined && direct !== null && (Array.isArray(direct) || isPlainObject(direct))) {
    return direct;
  }
  return undefined;
}
