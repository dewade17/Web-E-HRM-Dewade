const DATE_ONLY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_NO_TZ_REGEX = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?$/;

function cloneDateToUTC(date) {
  if (!(date instanceof Date)) return null;
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.toISOString());
}

function parseDateOnlyString(value) {
  const match = DATE_ONLY_REGEX.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

function parseDateTimeNoTzString(value) {
  const normalized = value.replace(' ', 'T');
  const match = DATETIME_NO_TZ_REGEX.exec(normalized);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = '0', millisecond = '0'] = match;
  const ms = `${millisecond}`.padEnd(3, '0').slice(0, 3);
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), Number(ms)));
}

export function parseDateOnlyToUTC(value) {
  if (value === undefined || value === null) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsedString = parseDateOnlyString(trimmed);
    if (parsedString) return parsedString;
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

export function parseDateTimeToUTC(value) {
  if (value === undefined || value === null) return null;

  if (value instanceof Date) {
    return cloneDateToUTC(value);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const noTz = parseDateTimeNoTzString(trimmed);
    if (noTz) return noTz;
    const parsed = new Date(trimmed);
    return cloneDateToUTC(parsed);
  }

  const parsed = new Date(value);
  return cloneDateToUTC(parsed);
}

export function startOfUTCDay(value) {
  const parsed = value instanceof Date ? cloneDateToUTC(value) : parseDateTimeToUTC(value);
  if (!parsed) return null;
  parsed.setUTCHours(0, 0, 0, 0);
  return parsed;
}

export function endOfUTCDay(value) {
  const parsed = value instanceof Date ? cloneDateToUTC(value) : parseDateTimeToUTC(value);
  if (!parsed) return null;
  parsed.setUTCHours(23, 59, 59, 999);
  return parsed;
}
