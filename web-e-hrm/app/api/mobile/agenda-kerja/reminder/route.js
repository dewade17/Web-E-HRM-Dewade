import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { sendNotification } from '@/app/utils/services/notificationService';

const DEFAULT_WINDOW_MINUTES = 60;
const MAX_WINDOW_MINUTES = 24 * 60;

function parseWindowMinutes(searchParams) {
  const raw = searchParams.get('windowMinutes') || searchParams.get('window_minutes');
  if (!raw) return DEFAULT_WINDOW_MINUTES;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_WINDOW_MINUTES;
  return Math.min(Math.round(value), MAX_WINDOW_MINUTES);
}

function toDate(value) {
  if (!value) return null;
  const dt = value instanceof Date ? value : new Date(value);
  return Number.isNaN(dt?.getTime?.()) ? null : dt;
}

function formatDateTimeDisplay(value) {
  const dt = toDate(value);
  if (!dt) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(dt);
}

function isoStringOrNull(value) {
  const dt = toDate(value);
  return dt ? dt.toISOString() : null;
}

export async function POST(request) {
  try {
    const { searchParams } = new URL(request.url);
    const windowMinutes = parseWindowMinutes(searchParams);
    const now = new Date();
    const windowEnd = new Date(now.getTime() + windowMinutes * 60 * 1000);

    const candidates = await db.agendaKerja.findMany({
      where: {
        deleted_at: null,
        status: { in: ['diproses', 'ditunda'] },
        end_date: {
          not: null,
          gte: now,
          lte: windowEnd,
        },
      },
      select: {
        id_agenda_kerja: true,
        id_user: true,
        end_date: true,
        agenda: { select: { nama_agenda: true } },
        user: { select: { nama_pengguna: true } },
      },
    });

    let sent = 0;
    let skipped = 0;

    for (const agenda of candidates) {
      const dedupeKey = `AGENDA_REMINDER_END:${agenda.id_agenda_kerja}:${isoStringOrNull(agenda.end_date) || ''}`;
      const existing = await db.notification.findFirst({
        where: {
          id_user: agenda.id_user,
          data_json: { contains: dedupeKey },
        },
      });

      if (existing) {
        skipped += 1;
        continue;
      }

      const tanggalSelesaiDisplay = formatDateTimeDisplay(agenda.end_date);
      const payload = {
        nama_karyawan: agenda.user?.nama_pengguna || 'Rekan',
        judul_agenda: agenda.agenda?.nama_agenda || 'Agenda Kerja',
        tanggal_selesai: isoStringOrNull(agenda.end_date) || '',
        tanggal_selesai_display: tanggalSelesaiDisplay,
        tanggal_deadline: tanggalSelesaiDisplay,
        related_table: 'agenda_kerja',
        related_id: agenda.id_agenda_kerja,
        deeplink: `/agenda-kerja/${agenda.id_agenda_kerja}`,
      };

      try {
        await sendNotification('AGENDA_REMINDER_END', agenda.id_user, payload, {
          dedupeKey,
          collapseKey: `AGENDA_${agenda.id_agenda_kerja}`,
          deeplink: payload.deeplink,
        });
        sent += 1;
      } catch (notifErr) {
        console.error('[AGENDA_REMINDER_END] gagal mengirim untuk', agenda.id_agenda_kerja, notifErr);
      }
    }

    return NextResponse.json({
      ok: true,
      message: 'Reminder agenda kerja selesai diproses.',
      data: {
        windowMinutes,
        totalCandidates: candidates.length,
        totalSent: sent,
        totalSkipped: skipped,
      },
    });
  } catch (err) {
    console.error('POST /api/mobile/agenda-kerja/reminders error:', err);
    return NextResponse.json({ ok: false, message: 'Gagal memproses reminder agenda kerja.' }, { status: 500 });
  }
}
