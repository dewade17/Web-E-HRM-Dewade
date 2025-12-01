import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { parseDateOnlyToUTC } from '@/helpers/date-helper';
import {
  extractWeeklyScheduleInput,
  normalizeWeeklySchedule,
  parseHariKerjaField,
  serializeHariKerja,
  transformShiftRecord
} from '../schedul-utils';
import { sendNotification } from '@/app/utils/services/notificationService';

const SHIFT_STATUS = ['KERJA', 'LIBUR'];

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

function parseBodyDate(value, field) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string' && !value.trim()) {
    throw new Error(`Field '${field}' harus berupa tanggal yang valid.`);
  }
  const parsed = parseDateOnlyToUTC(value);
  if (!(parsed instanceof Date)) {
    throw new Error(`Field '${field}' harus berupa tanggal yang valid.`);
  }
  return parsed;
}

export async function GET(req, { params }) {
  const ok = await ensureAuth(req); // <-- perbaikan: auth
  if (ok instanceof NextResponse) return ok;

  try {
    const { id } = params;
    const rawData = await db.shiftKerja.findUnique({
      where: { id_shift_kerja: id },
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
        user: {
          select: {
            id_user: true,
            nama_pengguna: true,
            email: true,
          },
        },
        polaKerja: {
          select: {
            id_pola_kerja: true,
            nama_pola_kerja: true,
          },
        },
      },
    });
    if (!rawData) {
      return NextResponse.json({ message: 'Shift kerja tidak ditemukan' }, { status: 404 });
    }
    return NextResponse.json({ data: transformShiftRecord(rawData) });
  } catch (err) {
    console.error('GET /shift-kerja/[id] error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}

function formatDateOnly(value) {
  if (!value) return '-';
  try {
    return value.toISOString().slice(0, 10);
  } catch (err) {
    console.warn('Gagal memformat tanggal shift:', err);
    return '-';
  }
}

function formatTimeValue(value) {
  if (!value) return '-';
  try {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toISOString().slice(11, 16);
  } catch (err) {
    console.warn('Gagal memformat waktu shift:', err);
    return '-';
  }
}

export async function PUT(req, { params }) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const { id } = params;
    const existing = await db.shiftKerja.findUnique({ where: { id_shift_kerja: id } });
    if (!existing) {
      return NextResponse.json({ message: 'Shift kerja tidak ditemukan' }, { status: 404 });
    }

    const existingSchedule = parseHariKerjaField(existing.hari_kerja);

    const body = await req.json();
    const data = {};

    const weeklyScheduleInput = extractWeeklyScheduleInput(body);

    if (body.id_user !== undefined) {
      const idUser = String(body.id_user).trim();
      if (!idUser) {
        return NextResponse.json({ message: "Field 'id_user' tidak boleh kosong." }, { status: 400 });
      }
      const userExists = await db.user.findUnique({ where: { id_user: idUser }, select: { id_user: true } });
      if (!userExists) {
        return NextResponse.json({ message: 'User tidak ditemukan.' }, { status: 404 });
      }
      data.id_user = idUser;
    }

    if (body.status !== undefined) {
      const status = String(body.status).toUpperCase().trim();
      if (!SHIFT_STATUS.includes(status)) {
        return NextResponse.json({ message: "Field 'status' tidak valid." }, { status: 400 });
      }
      data.status = status;
    }

    let tanggalMulai = existing.tanggal_mulai;
    let tanggalSelesai = existing.tanggal_selesai;

    if (weeklyScheduleInput !== undefined) {
      const fallbackStart =
        body.tanggal_mulai ??
        body.start_date ??
        body.startDate ??
        body.mulai ??
        body.referenceDate ??
        body.weekStart ??
        existing.tanggal_mulai ??
        existingSchedule?.startDate ??
        existingSchedule?.start_date ??
        existingSchedule?.weekReference?.firstWeekStart;
      const fallbackEnd =
        body.tanggal_selesai ??
        body.end_date ??
        body.endDate ??
        body.selesai ??
        body.until ??
        body.weekEnd ??
        existing.tanggal_selesai ??
        existingSchedule?.endDate ??
        existingSchedule?.end_date ??
        null;

      try {
        const normalized = normalizeWeeklySchedule(weeklyScheduleInput, {
          fallbackStartDate: fallbackStart,
          fallbackEndDate: fallbackEnd,
        });
        data.hari_kerja = serializeHariKerja(normalized.schedule);
        tanggalMulai = normalized.tanggalMulai ?? null;
        tanggalSelesai = normalized.tanggalSelesai ?? null;
        data.tanggal_mulai = tanggalMulai;
        data.tanggal_selesai = tanggalSelesai;
      } catch (scheduleErr) {
        return NextResponse.json({ message: scheduleErr.message }, { status: 400 });
      }
    } else {
      if (body.hari_kerja !== undefined) {
        const hariKerja = String(body.hari_kerja).trim();
        if (!hariKerja) {
          return NextResponse.json({ message: "Field 'hari_kerja' tidak boleh kosong." }, { status: 400 });
        }
        data.hari_kerja = hariKerja;
      }

      try {
        const parsedMulai = parseBodyDate(body.tanggal_mulai, 'tanggal_mulai');
        if (parsedMulai !== undefined) {
          tanggalMulai = parsedMulai;
          data.tanggal_mulai = parsedMulai;
        }
        const parsedSelesai = parseBodyDate(body.tanggal_selesai, 'tanggal_selesai');
        if (parsedSelesai !== undefined) {
          tanggalSelesai = parsedSelesai;
          data.tanggal_selesai = parsedSelesai;
        }
      } catch (parseErr) {
        return NextResponse.json({ message: parseErr.message }, { status: 400 });
      }

      if (
        (body.tanggal_mulai !== undefined || body.tanggal_selesai !== undefined) &&
        tanggalMulai instanceof Date &&
        tanggalSelesai instanceof Date &&
        tanggalSelesai < tanggalMulai
      ) {
        return NextResponse.json({ message: "Field 'tanggal_selesai' tidak boleh lebih awal dari 'tanggal_mulai'." }, { status: 400 });
      }
    }

    // === Perbaikan: status LIBUR harus memaksa pola null
    if (data.status === 'LIBUR') {
      data.id_pola_kerja = null;
    } else if (body.id_pola_kerja !== undefined) {
      if (body.id_pola_kerja === null || body.id_pola_kerja === '') {
        data.id_pola_kerja = null;
      } else {
        const idPola = String(body.id_pola_kerja).trim();
        if (!idPola) {
          return NextResponse.json({ message: "Field 'id_pola_kerja' tidak valid." }, { status: 400 });
        }
        const polaExists = await db.polaKerja.findUnique({
          where: { id_pola_kerja: idPola },
          select: { id_pola_kerja: true },
        });
        if (!polaExists) {
          return NextResponse.json({ message: 'Pola kerja tidak ditemukan.' }, { status: 404 });
        }
        data.id_pola_kerja = idPola;
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ message: 'Tidak ada perubahan yang diberikan.' }, { status: 400 });
    }

    try {
      const updated = await db.shiftKerja.update({
        where: { id_shift_kerja: id },
        data,
        select: {
          id_shift_kerja: true,
          id_user: true,
          tanggal_mulai: true,
          tanggal_selesai: true,
          hari_kerja: true,
          status: true,
          id_pola_kerja: true,
          updated_at: true,
          deleted_at: true,
          user: { select: { id_user: true, nama_pengguna: true } },
          polaKerja: {
            select: {
              id_pola_kerja: true,
              nama_pola_kerja: true,
              jam_mulai: true,
              jam_selesai: true,
            },
          },
        },
      });

      const notificationPayload = {
        nama_karyawan: updated.user?.nama_pengguna || 'Karyawan',
        tanggal_shift: formatDateOnly(updated.tanggal_mulai ?? updated.tanggal_selesai),
        nama_shift: updated.polaKerja?.nama_pola_kerja || 'Shift',
        jam_masuk: formatTimeValue(updated.polaKerja?.jam_mulai),
        jam_pulang: formatTimeValue(updated.polaKerja?.jam_selesai),
      };

      console.info('[NOTIF] Mengirim notifikasi SHIFT_UPDATED untuk user %s dengan payload %o', updated.id_user, notificationPayload);
      await sendNotification('SHIFT_UPDATED', updated.id_user, notificationPayload);
      console.info('[NOTIF] Notifikasi SHIFT_UPDATED selesai diproses untuk user %s', updated.id_user);

      return NextResponse.json({ message: 'Shift kerja diperbarui.', data: transformShiftRecord(updated) });
    } catch (err) {
      // === Perbaikan: tangkap konflik unik (ubah id_user/tanggal_ke_yang_sudah_ada)
      if (err?.code === 'P2002') {
        return NextResponse.json(
          {
            message: 'Sudah ada shift untuk kombinasi pengguna & tanggal tersebut.',
          },
          { status: 409 }
        );
      }
      throw err;
    }
  } catch (err) {
    if (err?.code === 'P2025') {
      return NextResponse.json({ message: 'Shift kerja tidak ditemukan' }, { status: 404 });
    }
    console.error('PUT /shift-kerja/[id] error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const { id } = params;
    const { searchParams } = new URL(req.url);
    const hardDelete = searchParams.get('hard') === '1' || searchParams.get('force') === '1';

    const existing = await db.shiftKerja.findUnique({
      where: { id_shift_kerja: id },
      select: { id_shift_kerja: true, deleted_at: true },
    });
    if (!existing) {
      return NextResponse.json({ message: 'Shift kerja tidak ditemukan' }, { status: 404 });
    }

    if (hardDelete) {
      try {
        await db.shiftKerja.delete({ where: { id_shift_kerja: id } });
        return NextResponse.json({ message: 'Shift kerja dihapus permanen.' });
      } catch (err) {
        if (err?.code === 'P2003') {
          return NextResponse.json({ message: 'Gagal menghapus: shift masih direferensikan oleh entitas lain.' }, { status: 409 });
        }
        throw err;
      }
    }

    if (existing.deleted_at) {
      return NextResponse.json({ message: 'Shift kerja sudah dalam status terhapus.' });
    }

    await db.shiftKerja.update({
      where: { id_shift_kerja: id },
      data: { deleted_at: new Date() },
    });

    return NextResponse.json({ message: 'Shift kerja dihapus (soft delete).' });
  } catch (err) {
    if (err?.code === 'P2025') {
      return NextResponse.json({ message: 'Shift kerja tidak ditemukan' }, { status: 404 });
    }
    console.error('DELETE /shift-kerja/[id] error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
