// app/api/admin/agenda-kerja/[id]/route.js
import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { parseDateTimeToUTC } from '@/helpers/date-helper';
import { sendNotification } from '@/app/utils/services/notificationService';

const normRole = (r) =>
  String(r || '')
    .trim()
    .toUpperCase();
const canSeeAll = (role) => ['OPERASIONAL', 'HR', 'DIREKTUR', 'SUPERADMIN'].includes(normRole(role));
const canManageAll = (role) => ['OPERASIONAL', 'SUPERADMIN'].includes(normRole(role));

async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const payload = verifyAuthToken(auth.slice(7));
      return {
        actor: {
          id: payload?.sub || payload?.id_user || payload?.userId,
          role: payload?.role,
          source: 'bearer',
        },
      };
    } catch {
      /* fallback ke NextAuth */
    }
  }
  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes; // unauthorized
  return {
    actor: {
      id: sessionOrRes?.user?.id || sessionOrRes?.user?.id_user,
      role: sessionOrRes?.user?.role,
      source: 'session',
    },
  };
}

// === FIXED: izinkan OPERASIONAL **dan** SUPERADMIN
function guardOperational(actor) {
  const role = String(actor?.role || '')
    .trim()
    .toUpperCase();
  if (role !== 'OPERASIONAL' && role !== 'SUPERADMIN') {
    return NextResponse.json({ message: 'Forbidden: hanya role OPERASIONAL/SUPERADMIN yang dapat mengakses resource ini.' }, { status: 403 });
  }
  return null;
}

const VALID_STATUS = ['teragenda', 'diproses', 'ditunda', 'selesai'];

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
    console.warn('Gagal memformat tanggal agenda (admin detail):', err);
    return '-';
  }
}

function formatDateTimeDisplay(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'long',
      timeStyle: 'short',
    }).format(value instanceof Date ? value : new Date(value));
  } catch (err) {
    console.warn('Gagal memformat tanggal agenda (admin detail) untuk tampilan:', err);
    return '';
  }
}

function formatStatusDisplay(status) {
  if (!status) return '';
  return String(status)
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export async function GET(request, { params }) {
  const auth = await ensureAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
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

export async function PUT(request, { params }) {
  const auth = await ensureAuth(request);
  if (auth instanceof NextResponse) return auth;
  const forbidden = guardOperational(auth.actor);
  if (forbidden) return forbidden;

  const actorId = auth.actor?.id;
  const actorPromise = actorId ? db.user.findUnique({ where: { id_user: String(actorId) }, select: { nama_pengguna: true } }) : null;

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

    const actorUser = actorPromise ? await actorPromise : null;
    const actorName = (actorUser?.nama_pengguna || '').trim() || 'Pengguna';
    const agendaTitle = updated.agenda?.nama_agenda || 'Agenda Kerja';
    const friendlyDeadline = formatDateTimeDisplay(updated.end_date);
    const statusDisplay = formatStatusDisplay(updated.status);
    const adminTitle = `${actorName} Memperbarui Agenda: ${agendaTitle}`;
    const adminBody = [`${actorName} memperbarui agenda kerja "${agendaTitle}" untuk Anda.`, statusDisplay ? `Status terbaru: ${statusDisplay}.` : '', friendlyDeadline ? `Selesaikan sebelum ${friendlyDeadline}.` : '']
      .filter(Boolean)
      .join(' ')
      .trim();
    const assigneeTitle = `Agenda Diperbarui: ${agendaTitle}`;
    const assigneeBody = [`Detail agenda "${agendaTitle}" telah diperbarui oleh ${actorName}.`, statusDisplay ? `Status terbaru: ${statusDisplay}.` : '', friendlyDeadline ? `Deadline: ${friendlyDeadline}.` : ''];
    const notificationPayload = {
      nama_karyawan: updated.user?.nama_pengguna || 'Karyawan',
      judul_agenda: agendaTitle,
      nama_komentator: actorName,
      tanggal_deadline: formatDateTime(updated.end_date),
      tanggal_deadline_display: friendlyDeadline,
      status: updated.status,
      status_display: statusDisplay,
      pemberi_tugas: actorName,
      title: assigneeTitle,
      body: assigneeBody,
      overrideTitle: adminTitle,
      overrideBody: adminBody,
      title: `Agenda Diperbarui: ${agendaTitle}`,
      body: [`Detail agenda "${agendaTitle}" telah diperbarui oleh Panel Admin.`, statusDisplay ? `Status terbaru: ${statusDisplay}.` : '', friendlyDeadline ? `Deadline: ${friendlyDeadline}.` : ''].filter(Boolean).join(' ').trim(),
      related_table: 'agenda_kerja',
      related_id: updated.id_agenda_kerja,
      deeplink: `/agenda-kerja/${updated.id_agenda_kerja}`,
    };
    const notificationOptions = {
      dedupeKey: `AGENDA_COMMENTED:${updated.id_agenda_kerja}`,
      collapseKey: `AGENDA_${updated.id_agenda_kerja}`,
      deeplink: `/agenda-kerja/${updated.id_agenda_kerja}`,
    };

    console.info('[NOTIF] (Admin) Mengirim notifikasi AGENDA_COMMENTED untuk user %s dengan payload %o', updated.id_user, notificationPayload);
    try {
      await sendNotification('AGENDA_COMMENTED', updated.id_user, notificationPayload, notificationOptions);
      console.info('[NOTIF] (Admin) Notifikasi AGENDA_COMMENTED selesai diproses untuk user %s', updated.id_user);
    } catch (notifErr) {
      console.error('[NOTIF] (Admin) Gagal mengirim notifikasi AGENDA_COMMENTED untuk user %s: %o', updated.id_user, notifErr);
    }
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

export async function DELETE(request, { params }) {
  const auth = await ensureAuth(request);
  if (auth instanceof NextResponse) return auth;
  const forbidden = guardOperational(auth.actor);
  if (forbidden) return forbidden;

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
