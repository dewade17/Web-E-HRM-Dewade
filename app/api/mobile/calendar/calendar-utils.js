import { endOfUTCDay, startOfUTCDay } from '../../../../helpers/date-helper.js';

export function startOfDay(value) {
  return startOfUTCDay(value);
}

export function endOfDay(value) {
  return endOfUTCDay(value);
}

export function formatISO(value) {
  if (!value) return null;
  try {
    return value.toISOString();
  } catch {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
}

export function buildCutiCalendarItem(item, rangeFrom, rangeTo) {
  const dates = (item?.tanggal_list || [])
    .map((d) => (d?.tanggal_cuti instanceof Date ? d.tanggal_cuti : new Date(d.tanggal_cuti)))
    .filter((d) => !Number.isNaN(d.getTime()))
    .filter((d) => d.getTime() >= rangeFrom.getTime() && d.getTime() <= rangeTo.getTime())
    .sort((a, b) => a.getTime() - b.getTime());

  if (!dates.length) return null;

  const startDate = dates[0];
  const endDate = dates[dates.length - 1];

  return {
    type: 'cuti',
    id: item.id_pengajuan_cuti,
    user_id: item.id_user,
    title: 'Pengajuan Cuti Disetujui',
    description: item.keperluan || null,
    start: formatISO(startOfDay(startDate)),
    end: formatISO(endOfDay(endDate)),
  };
}
