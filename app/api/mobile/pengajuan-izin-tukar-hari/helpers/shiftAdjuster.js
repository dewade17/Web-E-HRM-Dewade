import { parseHariKerjaField } from '@/app/api/admin/shift-kerja/schedul-utils';

function toDateOnly(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function formatDateOnly(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date.toISOString().split('T')[0];
}

async function findExactShift(tx, userId, dateOnly) {
  return tx.shiftKerja.findFirst({
    where: {
      id_user: userId,
      deleted_at: null,
      tanggal_mulai: dateOnly,
      tanggal_selesai: dateOnly,
    },
    orderBy: { updated_at: 'desc' },
  });
}

async function findCoveringShift(tx, userId, dateOnly) {
  return tx.shiftKerja.findFirst({
    where: {
      id_user: userId,
      deleted_at: null,
      OR: [
        {
          AND: [{ tanggal_mulai: { lte: dateOnly } }, { tanggal_selesai: { gte: dateOnly } }],
        },
        {
          tanggal_mulai: null,
          tanggal_selesai: null,
        },
        {
          tanggal_mulai: null,
          tanggal_selesai: { gte: dateOnly },
        },
        {
          tanggal_mulai: { lte: dateOnly },
          tanggal_selesai: null,
        },
      ],
    },
    orderBy: [{ tanggal_mulai: 'desc' }, { updated_at: 'desc' }],
  });
}

async function ensureShiftStatusForDate(tx, { userId, targetDate, desiredStatus }) {
  const dateOnly = toDateOnly(targetDate);
  if (!userId || !dateOnly || !desiredStatus) {
    return {
      date: targetDate ? formatDateOnly(toDateOnly(targetDate)) : null,
      status: desiredStatus || null,
      action: 'skipped',
      reason: 'Parameter tidak lengkap untuk pembaruan shift.',
    };
  }

  const isoDate = formatDateOnly(dateOnly);
  const adjustments = { date: isoDate, status: desiredStatus, action: null };

  const existingExact = await findExactShift(tx, userId, dateOnly);
  if (existingExact) {
    if (existingExact.status === desiredStatus) {
      adjustments.action = 'noop';
      adjustments.shift_id = existingExact.id_shift_kerja;
      return adjustments;
    }

    const updated = await tx.shiftKerja.update({
      where: { id_shift_kerja: existingExact.id_shift_kerja },
      data: { status: desiredStatus },
      select: { id_shift_kerja: true },
    });

    adjustments.action = 'update';
    adjustments.shift_id = updated.id_shift_kerja;
    return adjustments;
  }

  const covering = await findCoveringShift(tx, userId, dateOnly);

  const created = await tx.shiftKerja.create({
    data: {
      id_user: userId,
      status: desiredStatus,
      tanggal_mulai: dateOnly,
      tanggal_selesai: dateOnly,
      hari_kerja: isoDate,
      id_pola_kerja: covering?.id_pola_kerja ?? null,
    },
    select: { id_shift_kerja: true, hari_kerja: true },
  });

  adjustments.action = 'create';
  adjustments.shift_id = created.id_shift_kerja;
  adjustments.copied_schedule = covering ? summarizeHariKerja(covering.hari_kerja) : null;
  return adjustments;
}

function summarizeHariKerja(rawValue) {
  if (!rawValue) return null;
  try {
    const parsed = parseHariKerjaField(rawValue);
    if (!parsed) return null;
    if (typeof parsed === 'string') return parsed;
    if (Array.isArray(parsed)) return { days: parsed.length };
    if (typeof parsed === 'object') {
      const summary = { type: parsed.type || null };
      if (Array.isArray(parsed.days)) {
        summary.days = parsed.days.map((day) => day.index ?? day.dayIndex ?? day.day ?? day);
      }
      return summary;
    }
    return null;
  } catch (_) {
    return null;
  }
}

export async function applyShiftSwapForIzinTukarHari(tx, submission) {
  if (!tx || !submission) {
    return { adjustments: [], issues: [{ message: 'Data transaksi atau pengajuan tidak valid.' }] };
  }

  const { id_user: userId, hari_izin: hariIzinRaw, hari_pengganti: hariPenggantiRaw } = submission;
  const hariIzin = toDateOnly(hariIzinRaw);
  const hariPengganti = toDateOnly(hariPenggantiRaw);

  const adjustments = [];
  const issues = [];

  if (!userId) {
    issues.push({ message: 'Pengajuan tidak memiliki pemohon yang valid.' });
    return { adjustments, issues };
  }

  if (!hariIzin) {
    issues.push({ message: 'Tanggal hari izin tidak ditemukan atau tidak valid.' });
  }
  if (!hariPengganti) {
    issues.push({ message: 'Tanggal hari pengganti tidak ditemukan atau tidak valid.' });
  }

  if (hariIzin) {
    try {
      adjustments.push(await ensureShiftStatusForDate(tx, { userId, targetDate: hariIzin, desiredStatus: 'LIBUR' }));
    } catch (err) {
      issues.push({
        message: 'Gagal memperbarui shift untuk hari izin.',
        detail: err?.message || String(err),
        date: formatDateOnly(hariIzin),
      });
    }
  }

  if (hariPengganti) {
    try {
      adjustments.push(await ensureShiftStatusForDate(tx, { userId, targetDate: hariPengganti, desiredStatus: 'KERJA' }));
    } catch (err) {
      issues.push({
        message: 'Gagal memperbarui shift untuk hari pengganti.',
        detail: err?.message || String(err),
        date: formatDateOnly(hariPengganti),
      });
    }
  }

  return { adjustments, issues };
}

export default applyShiftSwapForIzinTukarHari;
