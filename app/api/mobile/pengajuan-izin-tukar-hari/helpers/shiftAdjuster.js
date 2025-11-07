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

function normalizePolaKerjaOverride(rawOverride) {
  if (rawOverride === undefined || rawOverride === null) {
    return { provided: false, value: null };
  }

  if (typeof rawOverride === 'string') {
    const normalized = rawOverride.trim();
    if (!normalized) {
      throw new Error('id_pola_kerja tidak boleh berupa string kosong.');
    }
    return { provided: true, value: normalized };
  }

  if (typeof rawOverride !== 'object') {
    return { provided: false, value: null };
  }

  if (Object.prototype.hasOwnProperty.call(rawOverride, 'provided') || Object.prototype.hasOwnProperty.call(rawOverride, 'value')) {
    const provided = Boolean(rawOverride.provided);
    if (!provided) {
      return { provided: false, value: null };
    }

    const overrideValue = rawOverride.value;
    if (overrideValue === undefined || overrideValue === null) {
      throw new Error('id_pola_kerja tidak boleh bernilai null.');
    }

    const normalizedValue = String(overrideValue).trim();
    if (!normalizedValue) {
      throw new Error('id_pola_kerja tidak boleh berupa string kosong.');
    }

    return { provided: true, value: normalizedValue };
  }

  if (!Object.prototype.hasOwnProperty.call(rawOverride, 'id_pola_kerja')) {
    return { provided: false, value: null };
  }

  const value = rawOverride.id_pola_kerja;
  if (value === undefined || value === null) {
    throw new Error('id_pola_kerja tidak boleh bernilai null.');
  }

  const normalized = String(value).trim();
  if (!normalized) {
    throw new Error('id_pola_kerja tidak boleh berupa string kosong.');
  }

  return { provided: true, value: normalized };
}

export async function ensureShiftStatusForDate(tx, { userId, targetDate, desiredStatus, polaKerjaOverride }) {
  const dateOnly = toDateOnly(targetDate);
  if (!userId || !dateOnly || !desiredStatus) {
    return {
      date: targetDate ? formatDateOnly(toDateOnly(targetDate)) : null,
      status: desiredStatus || null,
      action: 'skipped',
      reason: 'Parameter tidak lengkap untuk pembaruan shift.',
    };
  }

  const override = normalizePolaKerjaOverride(polaKerjaOverride);

  const isoDate = formatDateOnly(dateOnly);
  const adjustments = {
    date: isoDate,
    status: desiredStatus,
    action: null,
    applied_pola_kerja_id: override.provided ? override.value : null,
  };

  const existingExact = await findExactShift(tx, userId, dateOnly);
  if (existingExact) {
    const shouldUpdateStatus = existingExact.status !== desiredStatus;
    const existingPolaKerjaId = existingExact.id_pola_kerja ?? null;
    const targetPolaKerjaId = override.provided ? override.value : existingPolaKerjaId;
    const shouldUpdatePolaKerja = override.provided && targetPolaKerjaId !== existingPolaKerjaId;

    if (!shouldUpdateStatus && !shouldUpdatePolaKerja) {
      adjustments.action = 'noop';
      adjustments.shift_id = existingExact.id_shift_kerja;
      adjustments.applied_pola_kerja_id = targetPolaKerjaId;
      return adjustments;
    }

    const updatePayload = {};
    if (shouldUpdateStatus) {
      updatePayload.status = desiredStatus;
    }
    if (shouldUpdatePolaKerja) {
      updatePayload.id_pola_kerja = targetPolaKerjaId;
    }

    const updated = await tx.shiftKerja.update({
      where: { id_shift_kerja: existingExact.id_shift_kerja },
      data: updatePayload,
      select: { id_shift_kerja: true, id_pola_kerja: true },
    });

    adjustments.action = 'update';
    adjustments.shift_id = updated.id_shift_kerja;
    adjustments.applied_pola_kerja_id = override.provided ? targetPolaKerjaId : updated.id_pola_kerja ?? existingPolaKerjaId ?? null;
    return adjustments;
  }

  const covering = await findCoveringShift(tx, userId, dateOnly);

  const appliedPolaKerjaId = override.provided ? override.value : covering?.id_pola_kerja ?? null;

  const created = await tx.shiftKerja.create({
    data: {
      id_user: userId,
      status: desiredStatus,
      tanggal_mulai: dateOnly,
      tanggal_selesai: dateOnly,
      hari_kerja: isoDate,
      id_pola_kerja: appliedPolaKerjaId,
    },
    select: { id_shift_kerja: true, hari_kerja: true, id_pola_kerja: true },
  });

  adjustments.action = 'create';
  adjustments.shift_id = created.id_shift_kerja;
  adjustments.applied_pola_kerja_id = created.id_pola_kerja ?? appliedPolaKerjaId;
  adjustments.copied_schedule = !override.provided && covering ? summarizeHariKerja(covering.hari_kerja) : null;
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

export async function applyShiftSwapForIzinTukarHari(tx, submission, overrides = {}) {
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
      const result = await ensureShiftStatusForDate(tx, {
        userId,
        targetDate: hariIzin,
        desiredStatus: 'LIBUR',
        polaKerjaOverride: overrides?.hari_izin,
      });
      adjustments.push({ ...result, target: 'hari_izin' });
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
      const result = await ensureShiftStatusForDate(tx, {
        userId,
        targetDate: hariPengganti,
        desiredStatus: 'KERJA',
        polaKerjaOverride: overrides?.hari_pengganti,
      });
      adjustments.push({ ...result, target: 'hari_pengganti' });
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
