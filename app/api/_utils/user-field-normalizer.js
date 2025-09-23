import { parseDateOnlyToUTC } from '@/helpers/date-helper';

export const JENIS_KELAMIN_VALUES = new Set(['LAKI_LAKI', 'PEREMPUAN']);
export const STATUS_KERJA_VALUES = new Set(['AKTIF', 'TIDAK_AKTIF', 'CUTI']);

export function normalizeNullableString(input) {
  if (input === undefined) return { value: undefined };
  if (input === null) return { value: null };
  const trimmed = String(input).trim();
  return { value: trimmed === '' ? null : trimmed };
}

export function normalizeNullableLowercaseString(input) {
  const base = normalizeNullableString(input);
  if (base.value === undefined || base.value === null) return base;
  return { value: String(base.value).toLowerCase() };
}

export function normalizeOptionalDate(input, fieldLabel) {
  if (input === undefined) return { value: undefined };
  if (input === null) return { value: null };
  if (typeof input === 'string' && input.trim() === '') return { value: null };

  const parsed = parseDateOnlyToUTC(input);
  if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) {
    return { error: `Field '${fieldLabel}' harus berupa tanggal yang valid.` };
  }
  return { value: parsed };
}

export function normalizeNullableInt(input, fieldLabel) {
  if (input === undefined) return { value: undefined };
  if (input === null || (typeof input === 'string' && input.trim() === '')) {
    return { value: null };
  }
  const num = Number(input);
  if (!Number.isFinite(num)) {
    return { error: `Field '${fieldLabel}' harus berupa angka yang valid.` };
  }
  return { value: Math.trunc(num) };
}

export function normalizeNullableEnum(input, allowed, fieldLabel) {
  if (input === undefined) return { value: undefined };
  if (input === null || (typeof input === 'string' && input.trim() === '')) {
    return { value: null };
  }
  const normalized = String(input).trim().toUpperCase();
  if (!allowed.has(normalized)) {
    const options = Array.from(allowed).join(', ');
    return { error: `Field '${fieldLabel}' harus salah satu dari: ${options}.` };
  }
  return { value: normalized };
}
