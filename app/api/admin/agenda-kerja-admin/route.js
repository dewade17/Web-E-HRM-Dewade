// app/api/admin/agenda-kerja/route.js
import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { endOfUTCDay, parseDateTimeToUTC, startOfUTCDay } from '@/helpers/date-helper';
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
      return { actor: { id: payload?.sub || payload?.id_user || payload?.userId, role: payload?.role, source: 'bearer' } };
    } catch {
      /* fallback ke NextAuth */
    }
  }
  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;
  return { actor: { id: sessionOrRes?.user?.id || sessionOrRes?.user?.id_user, role: sessionOrRes?.user?.role, source: 'session' } };
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

function toDateOrNull(v) {
  if (!v) return null;
  const parsed = parseDateTimeToUTC(v);
  return parsed ?? null;
}
const startOfDay = (d) => startOfUTCDay(d);
const endOfDay = (d) => endOfUTCDay(d);

function overlapRangeFilter(fromSOD, toEOD) {
  return {
    AND: [{ OR: [{ start_date: null }, { start_date: { lte: toEOD } }] }, { OR: [{ end_date: null }, { end_date: { gte: fromSOD } }] }],
  };
}

function formatDateTime(value) {
  if (!value) return '-';
  try {
    return value.toISOString();
  } catch {
    return '-';
  }
}
function formatDateTimeDisplay(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeStyle: 'short' }).format(value instanceof Date ? value : new Date(value));
  } catch {
    return '';
  }
}

const VALID_STATUS = ['teragenda', 'diproses', 'ditunda', 'selesai'];
const MIN_RANGE_DATE = startOfUTCDay('1970-01-01') ?? new Date(Date.UTC(1970, 0, 1));
const MAX_RANGE_DATE = endOfUTCDay('2999-12-31') ?? new Date(Date.UTC(2999, 11, 31, 23, 59, 59, 999));

export async function GET(request) {
  const auth = await ensureAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const format = (searchParams.get('format') || '').trim().toLowerCase();
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get('perPage') || '20', 10)));

    const user_id = searchParams.get('user_id') || undefined;
    const id_agenda = searchParams.get('id_agenda') || undefined;
    const id_absensi = searchParams.get('id_absensi') || undefined;
    const status = searchParams.get('status') || undefined;

    const dateEq = searchParams.get('date');
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    const where = { deleted_at: null };
    const kebutuhan_agenda_raw = searchParams.get('kebutuhan_agenda');

    if (user_id) where.id_user = user_id;
    if (id_agenda) where.id_agenda = id_agenda;
    if (id_absensi) where.id_absensi = id_absensi;
    if (status && VALID_STATUS.includes(String(status).toLowerCase())) {
      where.status = String(status).toLowerCase();
    }
    if (kebutuhan_agenda_raw !== null) {
      const trimmed = String(kebutuhan_agenda_raw || '').trim();
      where.kebutuhan_agenda = trimmed ? trimmed : null;
    }

    const and = [];
    if (dateEq) {
      const d = toDateOrNull(dateEq);
      if (d) and.push(overlapRangeFilter(startOfDay(d), endOfDay(d)));
    } else if (from || to) {
      const gte = toDateOrNull(from);
      const lte = toDateOrNull(to);
      if (gte || lte) {
        and.push(overlapRangeFilter(gte ? startOfDay(gte) : MIN_RANGE_DATE, lte ? endOfDay(lte) : MAX_RANGE_DATE));
      }
    }
    if (and.length) where.AND = and;

    const [total, items] = await Promise.all([
      db.agendaKerja.count({ where }),
      db.agendaKerja.findMany({
        where,
        orderBy: [{ start_date: 'desc' }, { created_at: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          agenda: { select: { id_agenda: true, nama_agenda: true } },
          absensi: { select: { id_absensi: true, tanggal: true, jam_masuk: true, jam_pulang: true } },
          user: { select: { id_user: true, nama_pengguna: true, email: true, role: true } },
        },
      }),
    ]);

    // === EXPORT EXCEL (opsional): ?format=xlsx
    if (format === 'xlsx') {
      const XLSX = await import('xlsx');

      const fmtDate = (v) => {
        if (!v) return '';
        const d = v instanceof Date ? v : new Date(v);
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(d.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${dd}`;
      };
      const fmtDuration = (sec) => {
        if (!sec || sec < 1) return '';
        const h = Math.floor(sec / 3600);
        const mi = Math.floor((sec % 3600) / 60);
        const s = Math.floor(sec % 60);
        const parts = [];
        if (h) parts.push(`${h} jam`);
        if (mi) parts.push(`${mi} menit`);
        if (!h && !mi && s) parts.push(`${s} detik`);
        return parts.join(' ');
      };

      // === Per MINTAAN: kolom ekspor -> Proyek/Agenda, Tanggal Proyek, Aktivitas, Durasi, Status
      const sheetRows = items.map((r) => ({
        'Proyek/Agenda': r.agenda?.nama_agenda || '',
        'Tanggal Proyek': fmtDate(r.start_date || r.end_date || r.created_at),
        Aktivitas: r.deskripsi_kerja || '',
        Durasi: fmtDuration(r.duration_seconds),
        Status: r.status || 'teragenda',
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(sheetRows, {
        header: ['Proyek/Agenda', 'Tanggal Proyek', 'Aktivitas', 'Durasi', 'Status'],
      });
      XLSX.utils.book_append_sheet(wb, ws, 'Aktivitas');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      const from = searchParams.get('from') || '';
      const to = searchParams.get('to') || '';
      const fname = `timesheet-activity-${from.slice(0, 10)}-to-${to.slice(0, 10)}.xlsx`;

      return new Response(buf, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${fname}"`,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      data: items,
      meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, message: 'Failed to fetch agenda kerja' }, { status: 500 });
  }
}

export async function POST(request) {
  const auth = await ensureAuth(request);
  if (auth instanceof NextResponse) return auth;
  const forbidden = guardOperational(auth.actor);
  if (forbidden) return forbidden;

  try {
    const body = await request.json();

    const id_user = (body.id_user || '').trim();
    const id_agenda = (body.id_agenda || '').trim();
    const deskripsi_kerja = (body.deskripsi_kerja || '').trim();

    if (!id_user) return NextResponse.json({ ok: false, message: 'id_user wajib diisi' }, { status: 400 });
    if (!id_agenda) return NextResponse.json({ ok: false, message: 'id_agenda wajib diisi' }, { status: 400 });
    if (!deskripsi_kerja) return NextResponse.json({ ok: false, message: 'deskripsi_kerja wajib diisi' }, { status: 400 });

    const [userExists, agendaExists] = await Promise.all([db.user.findUnique({ where: { id_user: id_user }, select: { id_user: true } }), db.agenda.findUnique({ where: { id_agenda: id_agenda }, select: { id_agenda: true } })]);

    if (!userExists) return NextResponse.json({ ok: false, message: 'User dengan ID yang diberikan tidak ditemukan.' }, { status: 404 });
    if (!agendaExists) return NextResponse.json({ ok: false, message: 'Agenda dengan ID yang diberikan tidak ditemukan.' }, { status: 404 });

    const statusValue = String(body.status || 'teragenda').toLowerCase();
    if (!['teragenda', 'diproses', 'ditunda', 'selesai'].includes(statusValue)) {
      return NextResponse.json({ ok: false, message: 'status tidak valid' }, { status: 400 });
    }

    const start_date = toDateOrNull(body.start_date);
    const end_date = toDateOrNull(body.end_date);
    if (start_date && end_date && end_date < start_date) {
      return NextResponse.json({ ok: false, message: 'end_date tidak boleh sebelum start_date' }, { status: 400 });
    }

    let duration_seconds = body.duration_seconds ?? null;
    if (duration_seconds == null && start_date && end_date) {
      duration_seconds = Math.max(0, Math.floor((end_date - start_date) / 1000));
    }

    const data = {
      id_user,
      id_agenda,
      deskripsi_kerja,
      status: statusValue,
      start_date,
      end_date,
      duration_seconds,
      id_absensi: body.id_absensi ?? null,
    };

    const created = await db.agendaKerja.create({
      data,
      include: {
        agenda: { select: { id_agenda: true, nama_agenda: true } },
        absensi: { select: { id_absensi: true, tanggal: true, jam_masuk: true, jam_pulang: true } },
        user: { select: { id_user: true, nama_pengguna: true, email: true, role: true } },
      },
    });

    // Notifikasi (tetap sama)
    const agendaTitle = created.agenda?.nama_agenda || 'Agenda Baru';
    const friendlyDeadline = formatDateTimeDisplay(created.end_date);
    const adminTitle = `Admin Menambahkan Agenda: ${agendaTitle}`;
    const adminBody = [`Admin menambahkan agenda kerja "${agendaTitle}" untuk Anda.`, friendlyDeadline ? `Selesaikan sebelum ${friendlyDeadline}.` : ''].filter(Boolean).join(' ').trim();

    try {
      await sendNotification(
        'NEW_AGENDA_ASSIGNED',
        created.id_user,
        {
          nama_karyawan: created.user?.nama_pengguna || 'Karyawan',
          judul_agenda: agendaTitle,
          tanggal_deadline: formatDateTime(created.end_date),
          tanggal_deadline_display: friendlyDeadline,
          pemberi_tugas: 'Panel Admin',
          title: adminTitle,
          body: adminBody,
          overrideTitle: adminTitle,
          overrideBody: adminBody,
          related_table: 'agenda_kerja',
          related_id: created.id_agenda_kerja,
          deeplink: `/agenda-kerja/${created.id_agenda_kerja}`,
        },
        {
          dedupeKey: `NEW_AGENDA_ASSIGNED:${created.id_agenda_kerja}`,
          collapseKey: `AGENDA_${created.id_agenda_kerja}`,
          deeplink: `/agenda-kerja/${created.id_agenda_kerja}`,
        }
      );
    } catch (notifErr) {
      console.error('[NOTIF] gagal:', notifErr);
    }

    return NextResponse.json({ ok: true, data: created }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, message: 'Gagal membuat agenda kerja' }, { status: 500 });
  }
}
