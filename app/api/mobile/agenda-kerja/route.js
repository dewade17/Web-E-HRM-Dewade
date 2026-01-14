// app/api/mobile/agenda-kerja/route.js
import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { endOfUTCDay, parseDateTimeToUTC, startOfUTCDay } from '@/helpers/date-helper';
import { sendNotification } from '@/app/utils/services/notificationService';

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
  if (sessionOrRes instanceof NextResponse) return sessionOrRes; // unauthorized
  return { actor: { id: sessionOrRes?.user?.id || sessionOrRes?.user?.id_user, role: sessionOrRes?.user?.role, source: 'session' } };
}

function toDateOrNull(v) {
  if (!v) return null;
  const parsed = parseDateTimeToUTC(v);
  return parsed ?? null;
}

function startOfDay(d) {
  return startOfUTCDay(d);
}

function endOfDay(d) {
  return endOfUTCDay(d);
}

function overlapRangeFilter(fromSOD, toEOD) {
  return {
    AND: [{ OR: [{ start_date: null }, { start_date: { lte: toEOD } }] }, { OR: [{ end_date: null }, { end_date: { gte: fromSOD } }] }],
  };
}

function formatDateTime(value) {
  if (!value) return '-';
  try {
    return value.toISOString();
  } catch (err) {
    console.warn('Gagal memformat tanggal agenda (mobile):', err);
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
    console.warn('Gagal memformat tanggal agenda untuk tampilan (mobile):', err);
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

  try {
    const body = await request.json();

    const id_user = (body.id_user || '').trim();
    const id_agenda = (body.id_agenda || '').trim();
    const deskripsi_kerja = (body.deskripsi_kerja || '').trim();

    if (!id_user) return NextResponse.json({ ok: false, message: 'id_user wajib diisi' }, { status: 400 });
    if (!id_agenda) return NextResponse.json({ ok: false, message: 'id_agenda wajib diisi' }, { status: 400 });
    if (!deskripsi_kerja) return NextResponse.json({ ok: false, message: 'deskripsi_kerja wajib diisi' }, { status: 400 });

    // --- PERBAIKAN: VALIDASI FOREIGN KEY SEBELUM CREATE ---
    // 1. Validasi id_user dan id_agenda secara bersamaan
    const [userExists, agendaExists] = await Promise.all([
      db.user.findUnique({
        where: { id_user: id_user },
        select: { id_user: true },
      }),
      db.agenda.findUnique({
        where: { id_agenda: id_agenda },
        select: { id_agenda: true },
      }),
    ]);

    if (!userExists) {
      return NextResponse.json({ ok: false, message: 'User dengan ID yang diberikan tidak ditemukan.' }, { status: 404 });
    }

    if (!agendaExists) {
      return NextResponse.json({ ok: false, message: 'Agenda dengan ID yang diberikan tidak ditemukan.' }, { status: 404 });
    }
    // --- AKHIR PERBAIKAN ---

    const statusValue = String(body.status || 'teragenda').toLowerCase();
    if (!VALID_STATUS.includes(statusValue)) {
      return NextResponse.json({ ok: false, message: 'status tidak valid' }, { status: 400 });
    }

    const rawStartDates = body.start_dates;
    const hasStartDates = rawStartDates !== undefined;
    const startDates = [];

    if (hasStartDates) {
      if (!Array.isArray(rawStartDates)) {
        return NextResponse.json({ ok: false, message: 'start_dates harus berupa array tanggal' }, { status: 400 });
      }
      if (!rawStartDates.length && !body.start_date) {
        return NextResponse.json({ ok: false, message: 'start_dates tidak boleh kosong' }, { status: 400 });
      }
      for (const [index, value] of rawStartDates.entries()) {
        const parsed = toDateOrNull(value);
        if (!parsed) {
          return NextResponse.json({ ok: false, message: `start_dates[${index}] tidak valid` }, { status: 400 });
        }
        startDates.push(parsed);
      }
    }

    const singleStartDate = toDateOrNull(body.start_date);
    if (!hasStartDates) {
      startDates.push(singleStartDate ?? null);
    } else if (singleStartDate) {
      const alreadyIncluded = startDates.some((d) => d.getTime() === singleStartDate.getTime());
      if (!alreadyIncluded) startDates.push(singleStartDate);
    }

    if (hasStartDates && startDates.length === 0) {
      return NextResponse.json({ ok: false, message: 'start_dates tidak boleh kosong' }, { status: 400 });
    }

    const endDateInput = toDateOrNull(body.end_date);
    let durationSecondsInput = body.duration_seconds ?? null;
    if (durationSecondsInput !== null) {
      const parsed = Number(durationSecondsInput);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return NextResponse.json({ ok: false, message: 'duration_seconds tidak valid' }, { status: 400 });
      }
      durationSecondsInput = Math.floor(parsed);
    }

    const kebutuhanAgenda = normalizeKebutuhanInput(body.kebutuhan_agenda);
    if (kebutuhanAgenda.error) {
      return NextResponse.json({ ok: false, message: kebutuhanAgenda.error }, { status: 400 });
    }

    // Snapshot pembuat (umumnya user mobile itu sendiri)
    let created_by_snapshot = null;
    try {
      const actorId = auth?.actor?.id ? String(auth.actor.id).trim() : '';
      if (actorId) {
        const creator = await db.user.findUnique({
          where: { id_user: actorId },
          select: { nama_pengguna: true, email: true, role: true },
        });
        const label = creator?.nama_pengguna || creator?.email || actorId;
        const role = creator?.role || auth?.actor?.role || '';
        created_by_snapshot = [label, role ? `(${String(role)})` : null].filter(Boolean).join(' ').slice(0, 255);
      }
    } catch (e) {
      created_by_snapshot = null;
    }

    const createdItems = await db.$transaction(
      startDates.map((startDate) => {
        let endDate = endDateInput;
        let durationSeconds = durationSecondsInput;

        if (startDate && endDate && endDate < startDate) {
          throw new Error('end_date tidak boleh sebelum start_date');
        }

        if (durationSeconds == null && startDate && endDate) {
          durationSeconds = Math.max(0, Math.floor((endDate - startDate) / 1000));
        }

        if (!endDate && startDate && durationSeconds != null) {
          endDate = new Date(startDate.getTime() + durationSeconds * 1000);
        }

        const data = {
          id_user,
          id_agenda,
          deskripsi_kerja,
          status: statusValue,
          start_date: startDate,
          end_date: endDate,
          duration_seconds: durationSeconds,
          id_absensi: body.id_absensi ?? null,
          created_by_snapshot,
          ...(kebutuhanAgenda.value !== undefined && { kebutuhan_agenda: kebutuhanAgenda.value }),
        };

        return db.agendaKerja.create({
          data,
          include: {
            agenda: { select: { id_agenda: true, nama_agenda: true } },
            absensi: { select: { id_absensi: true, tanggal: true, jam_masuk: true, jam_pulang: true } },
            user: { select: { id_user: true, nama_pengguna: true, email: true, role: true } },
          },
        });
      })
    );

    for (const created of createdItems) {
      const agendaTitle = created.agenda?.nama_agenda || 'Agenda Baru';
      const friendlyDeadline = formatDateTimeDisplay(created.end_date);
      const mobileTitle = `Agenda Kerja Ditambahkan: ${agendaTitle}`;
      const mobileBody = [`Anda baru saja menambahkan agenda kerja "${agendaTitle}".`, friendlyDeadline ? `Tenggat agenda pada ${friendlyDeadline}.` : ''].filter(Boolean).join(' ').trim();

      const notificationPayload = {
        nama_karyawan: created.user?.nama_pengguna || 'Karyawan',
        judul_agenda: agendaTitle,
        tanggal_deadline: formatDateTime(created.end_date),
        tanggal_deadline_display: friendlyDeadline,
        pemberi_tugas: 'Aplikasi Mobile',
        title: mobileTitle,
        body: mobileBody,
        overrideTitle: mobileTitle,
        overrideBody: mobileBody,
        related_table: 'agenda_kerja',
        related_id: created.id_agenda_kerja,
        deeplink: `/agenda-kerja/${created.id_agenda_kerja}`,
      };

      console.info('[NOTIF] (Mobile) Mengirim notifikasi NEW_AGENDA_ASSIGNED untuk user %s dengan payload %o', created.id_user, notificationPayload);
      await sendNotification('NEW_AGENDA_ASSIGNED', created.id_user, notificationPayload);
      console.info('[NOTIF] (Mobile) Notifikasi NEW_AGENDA_ASSIGNED selesai diproses untuk user %s', created.id_user);
    }

    return NextResponse.json({ ok: true, message: 'Anda berhasil menambahkan agenda kerja.', data: createdItems, meta: { created: createdItems.length } }, { status: 201 });
  } catch (err) {
    // Blok catch ini sekarang menjadi fallback jika ada error lain
    console.error(err);
    if (err instanceof Error && err.message === 'end_date tidak boleh sebelum start_date') {
      return NextResponse.json({ ok: false, message: err.message }, { status: 400 });
    }
    return NextResponse.json({ ok: false, message: 'Gagal membuat agenda kerja' }, { status: 500 });
  }
}

function normalizeKebutuhanInput(input) {
  if (input === undefined) return { value: undefined };
  if (input === null) return { value: null };

  const trimmed = String(input).trim();
  if (!trimmed) return { value: null };
  return { value: trimmed };
}
