// app/api/agenda-kerja/[id]/route.js
import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { parseDateTimeToUTC } from '@/helpers/date-helper';
import { sendNotification } from '@/app/utils/services/notificationService';

// Autentikasi (JWT/NextAuth)
async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      verifyAuthToken(auth.slice(7));
      return true;
    } catch {
      /* fallback ke NextAuth */
    }
  }
  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes; // unauthorized
  return true;
}

const VALID_STATUS = ['diproses', 'ditunda', 'selesai'];

function toDateOrNull(v) {
  if (!v) return null;
  const parsed = parseDateTimeToUTC(v);
  return parsed ?? null;
}

function formatDateTime(value) {
  if (!value) return '-';
  try {
    return value.toISOString();
  } catch (err) {
    console.warn('Gagal memformat tanggal agenda (mobile detail):', err);
    return '-';
  }
}

// GET /api/agenda-kerja/[id]
export async function GET(_req, { params }) {
  try {
    // per skema baru: primary key = id_agenda_kerja
    const agenda = await db.agendaKerja.findFirst({
      where: { id_agenda_kerja: params.id, deleted_at: null },
      include: {
        agenda: { select: { id_agenda: true, nama_agenda: true } },
        absensi: { select: { id_absensi: true, tanggal: true, jam_masuk: true, jam_pulang: true } },
        user: { select: { id_user: true, nama_pengguna: true, email: true, role: true } },
      },
    });

    if (!agenda) {
      return NextResponse.json({ ok: false, message: 'Agenda kerja tidak ditemukan' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, data: agenda });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, message: 'Gagal mengambil detail' }, { status: 500 });
  }
}

// PUT /api/agenda-kerja/[id]
export async function PUT(request, { params }) {
  const okAuth = await ensureAuth(request);
  if (okAuth instanceof NextResponse) return okAuth;

  try {
    const current = await db.agendaKerja.findUnique({ where: { id_agenda_kerja: params.id } });
    if (!current || current.deleted_at) {
      return NextResponse.json({ ok: false, message: 'Agenda kerja tidak ditemukan' }, { status: 404 });
    }

    const body = await request.json();

    if (body.status !== undefined) {
      const st = String(body.status).toLowerCase();
      if (!VALID_STATUS.includes(st)) {
        return NextResponse.json({ ok: false, message: 'status tidak valid' }, { status: 400 });
      }
    }

    const start_date = body.start_date !== undefined ? toDateOrNull(body.start_date) : undefined;
    const end_date = body.end_date !== undefined ? toDateOrNull(body.end_date) : undefined;

    if (start_date && end_date && end_date < start_date) {
      return NextResponse.json({ ok: false, message: 'end_date tidak boleh sebelum start_date' }, { status: 400 });
    }

    let duration_seconds = body.duration_seconds;
    // Jika duration tidak dikirim, namun ada perubahan start/end dan keduanya terisi => hitung otomatis
    const willCalcDuration = duration_seconds === undefined && (start_date !== undefined || end_date !== undefined);

    const nextStart = start_date !== undefined ? start_date : current.start_date;
    const nextEnd = end_date !== undefined ? end_date : current.end_date;

    if (willCalcDuration && nextStart && nextEnd) {
      duration_seconds = Math.max(0, Math.floor((nextEnd - nextStart) / 1000));
    }
    const kebutuhanAgenda = normalizeKebutuhanInput(body.kebutuhan_agenda);
    if (kebutuhanAgenda.error) {
      return NextResponse.json({ ok: false, message: kebutuhanAgenda.error }, { status: 400 });
    }

    const data = {
      ...(body.id_user !== undefined && { id_user: String(body.id_user) }),
      ...(body.id_agenda !== undefined && { id_agenda: String(body.id_agenda) }),
      ...(body.deskripsi_kerja !== undefined && { deskripsi_kerja: String(body.deskripsi_kerja) }),
      ...(body.status !== undefined && { status: String(body.status).toLowerCase() }),
      ...(start_date !== undefined && { start_date }),
      ...(end_date !== undefined && { end_date }),
      ...(duration_seconds !== undefined && { duration_seconds }),
      ...(body.id_absensi !== undefined && { id_absensi: body.id_absensi ?? null }),
      ...(kebutuhanAgenda.value !== undefined && { kebutuhan_agenda: kebutuhanAgenda.value }),
    };

    if (data.deskripsi_kerja !== undefined && !data.deskripsi_kerja.trim()) {
      return NextResponse.json({ ok: false, message: 'deskripsi_kerja tidak boleh kosong' }, { status: 400 });
    }

    if (data.id_user !== undefined && !data.id_user) {
      return NextResponse.json({ ok: false, message: 'id_user tidak boleh kosong' }, { status: 400 });
    }
    if (data.id_agenda !== undefined && !data.id_agenda) {
      return NextResponse.json({ ok: false, message: 'id_agenda tidak boleh kosong' }, { status: 400 });
    }

    const updated = await db.agendaKerja.update({
      where: { id_agenda_kerja: params.id },
      data,
      include: {
        agenda: { select: { id_agenda: true, nama_agenda: true } },
        absensi: { select: { id_absensi: true, tanggal: true, jam_masuk: true, jam_pulang: true } },
        user: { select: { id_user: true, nama_pengguna: true, email: true, role: true } },
      },
    });

    const notificationPayload = {
      nama_karyawan: updated.user?.nama_pengguna || 'Karyawan',
      judul_agenda: updated.agenda?.nama_agenda || 'Agenda Kerja',
      nama_komentator: 'Anda',
      tanggal_deadline: formatDateTime(updated.end_date),
    };

    console.info('[NOTIF] (Mobile) Mengirim notifikasi AGENDA_COMMENTED untuk user %s dengan payload %o', updated.id_user, notificationPayload);
    await sendNotification('AGENDA_COMMENTED', updated.id_user, notificationPayload);
    console.info('[NOTIF] (Mobile) Notifikasi AGENDA_COMMENTED selesai diproses untuk user %s', updated.id_user);

    return NextResponse.json({ ok: true, data: updated });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, message: 'Gagal mengubah agenda kerja' }, { status: 500 });
  }
}

function normalizeKebutuhanInput(input) {
  if (input === undefined) return { value: undefined };
  if (input === null) return { value: null };

  const trimmed = String(input).trim();
  if (!trimmed) return { value: null };
  return { value: trimmed };
}

// DELETE /api/agenda-kerja/[id]?hard=0|1
export async function DELETE(request, { params }) {
  const okAuth = await ensureAuth(request);
  if (okAuth instanceof NextResponse) return okAuth;

  try {
    const current = await db.agendaKerja.findUnique({ where: { id_agenda_kerja: params.id } });
    if (!current || current.deleted_at) {
      return NextResponse.json({ ok: false, message: 'Agenda kerja tidak ditemukan' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const hard = searchParams.get('hard');

    if (hard === '1' || hard === 'true') {
      await db.agendaKerja.delete({ where: { id_agenda_kerja: params.id } });
      return NextResponse.json({ ok: true, data: { id: params.id, deleted: true, hard: true } });
    }

    await db.agendaKerja.update({
      where: { id_agenda_kerja: params.id },
      data: { deleted_at: new Date() },
    });

    return NextResponse.json({ ok: true, data: { id: params.id, deleted: true, hard: false } });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, message: 'Gagal menghapus agenda kerja' }, { status: 500 });
  }
}
