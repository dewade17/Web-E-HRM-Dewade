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

function formatDateDisplay(value) {
  const dt = toDate(value);
  if (!dt) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'long',
    timeZone: 'Asia/Jakarta',
  }).format(dt);
}

function formatTimeDisplay(value) {
  const dt = toDate(value);
  if (!dt) return '-';
  return new Intl.DateTimeFormat('id-ID', {
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

    const candidates = await db.kunjungan.findMany({
      where: {
        deleted_at: null,
        status_kunjungan: { in: ['diproses', 'berlangsung'] },
        jam_selesai: {
          not: null,
          gte: now,
          lte: windowEnd,
        },
      },
      select: {
        id_kunjungan: true,
        id_user: true,
        tanggal: true,
        jam_selesai: true,
        kategori: { select: { nama_kategori: true, kategori_kunjungan: true } },
        user: { select: { nama_pengguna: true } },
      },
    });

    let sent = 0;
    let skipped = 0;

    for (const visit of candidates) {
      const dedupeKey = `CLIENT_VISIT_REMINDER_END:${visit.id_kunjungan}:${isoStringOrNull(visit.jam_selesai) || ''}`;
      const existing = await db.notification.findFirst({
        where: {
          id_user: visit.id_user,
          data_json: { contains: dedupeKey },
        },
      });

      if (existing) {
        skipped += 1;
        continue;
      }

      const tanggalKunjunganDisplay = formatDateDisplay(visit.tanggal || visit.jam_selesai);
      const waktuSelesaiDisplay = formatTimeDisplay(visit.jam_selesai);

      const payload = {
        nama_karyawan: visit.user?.nama_pengguna || 'Rekan',
        kategori_kunjungan: visit.kategori?.nama_kategori || visit.kategori?.kategori_kunjungan || 'Kunjungan Klien',
        tanggal_kunjungan: isoStringOrNull(visit.tanggal) || '',
        tanggal_kunjungan_display: tanggalKunjunganDisplay,
        waktu_selesai_display: waktuSelesaiDisplay,
        related_table: 'kunjungan',
        related_id: visit.id_kunjungan,
        deeplink: `/kunjungan-klien/${visit.id_kunjungan}`,
      };

      try {
        await sendNotification('CLIENT_VISIT_REMINDER_END', visit.id_user, payload, {
          dedupeKey,
          collapseKey: `CLIENT_VISIT_${visit.id_kunjungan}`,
          deeplink: payload.deeplink,
        });
        sent += 1;
      } catch (notifErr) {
        console.error('[CLIENT_VISIT_REMINDER_END] gagal mengirim untuk', visit.id_kunjungan, notifErr);
      }
    }

    return NextResponse.json({
      ok: true,
      message: 'Reminder kunjungan klien selesai diproses.',
      data: {
        windowMinutes,
        totalCandidates: candidates.length,
        totalSent: sent,
        totalSkipped: skipped,
      },
    });
  } catch (err) {
    console.error('POST /api/mobile/kunjungan-klien/reminders error:', err);
    return NextResponse.json({ ok: false, message: 'Gagal memproses reminder kunjungan klien.' }, { status: 500 });
  }
}
