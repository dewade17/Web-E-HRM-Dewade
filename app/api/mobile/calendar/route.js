import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { endOfUTCDay, parseDateTimeToUTC, startOfUTCDay } from '@/helpers/date-helper';
import { resolveTargetUserAccess } from './access-control';
import { buildCutiCalendarItem, endOfDay, formatISO, startOfDay } from './calendar-utils';

async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const payload = verifyAuthToken(auth.slice(7));
      const id = payload?.sub || payload?.id_user || payload?.userId;
      if (id) return { actor: { id, role: payload?.role, source: 'bearer' } };
    } catch {}
  }
  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;
  const id = sessionOrRes?.user?.id || sessionOrRes?.user?.id_user;
  if (!id) return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
  return { actor: { id, role: sessionOrRes?.user?.role, source: 'session', session: sessionOrRes } };
}

function toDateOrNull(value) {
  if (!value) return null;
  const parsed = parseDateTimeToUTC(value);
  return parsed ?? null;
}

function normalizeDateRange(fromRaw, toRaw) {
  const MIN_RANGE_DATE = startOfUTCDay('1970-01-01') ?? new Date(Date.UTC(1970, 0, 1));
  const MAX_RANGE_DATE = endOfUTCDay('2999-12-31') ?? new Date(Date.UTC(2999, 11, 31, 23, 59, 59, 999));

  const fromParsed = toDateOrNull(fromRaw);
  const toParsed = toDateOrNull(toRaw);

  return {
    from: fromParsed ? startOfDay(fromParsed) : MIN_RANGE_DATE,
    to: toParsed ? endOfDay(toParsed) : MAX_RANGE_DATE,
  };
}

function sortByStartAsc(items) {
  return items.sort((a, b) => {
    const aTime = a.start ? new Date(a.start).getTime() : 0;
    const bTime = b.start ? new Date(b.start).getTime() : 0;
    if (aTime === bTime) return (a.end ? new Date(a.end).getTime() : 0) - (b.end ? new Date(b.end).getTime() : 0);
    return aTime - bTime;
  });
}

export async function GET(request) {
  const auth = await ensureAuth(request);
  if (auth instanceof NextResponse) return auth;

  const actorId = String(auth.actor.id);

  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get('perPage') || '20', 10)));

    const userIdFilter = (searchParams.get('user_id') || '').trim();
    const { targetUserId, allowed } = resolveTargetUserAccess(auth.actor, userIdFilter);
    if (!allowed && userIdFilter && userIdFilter !== actorId) {
      return NextResponse.json({ ok: false, message: 'Forbidden: tidak boleh mengakses kalender pengguna lain.' }, { status: 403 });
    }
    const fromRaw = searchParams.get('from');
    const toRaw = searchParams.get('to');
    const { from: rangeFrom, to: rangeTo } = normalizeDateRange(fromRaw, toRaw);

    const [storyPlanners, pengajuanCuti, pengajuanIzinSakit, pengajuanIzinJam, shiftKerja] = await Promise.all([
      db.storyPlanner.findMany({
        where: {
          deleted_at: null,
          id_user: targetUserId,
          count_time: {
            gte: rangeFrom,
            lte: rangeTo,
          },
        },
        select: {
          id_story: true,
          id_user: true,
          deskripsi_kerja: true,
          count_time: true,
          status: true,
        },
      }),
      db.pengajuanCuti.findMany({
        where: {
          deleted_at: null,
          status: 'disetujui',
          jenis_pengajuan: 'cuti',
          id_user: targetUserId,
          tanggal_list: {
            some: {
              tanggal_cuti: {
                gte: rangeFrom,
                lte: rangeTo,
              },
            },
          },
        },
        select: {
          id_pengajuan_cuti: true,
          id_user: true,
          keperluan: true,
          tanggal_list: { select: { tanggal_cuti: true } },
        },
      }),
      db.pengajuanIzinSakit.findMany({
        where: {
          deleted_at: null,
          status: 'disetujui',
          jenis_pengajuan: 'sakit',
          id_user: targetUserId,
          OR: [{ tanggal_pengajuan: { gte: rangeFrom, lte: rangeTo } }, { AND: [{ tanggal_pengajuan: null }, { created_at: { gte: rangeFrom, lte: rangeTo } }] }],
        },
        select: {
          id_pengajuan_izin_sakit: true,
          id_user: true,
          handover: true,
          tanggal_pengajuan: true,
          created_at: true,
        },
      }),
      db.pengajuanIzinJam.findMany({
        where: {
          deleted_at: null,
          status: 'disetujui',
          jenis_pengajuan: 'jam',
          id_user: targetUserId,
          jam_mulai: { lte: rangeTo },
          jam_selesai: { gte: rangeFrom },
        },
        select: {
          id_pengajuan_izin_jam: true,
          id_user: true,
          keperluan: true,
          tanggal_izin: true,
          jam_mulai: true,
          jam_selesai: true,
        },
      }),
      db.shiftKerja.findMany({
        where: {
          deleted_at: null,
          id_user: targetUserId,
          tanggal_mulai: { lte: rangeTo },
          tanggal_selesai: { gte: rangeFrom },
        },
        select: {
          id_shift_kerja: true,
          id_user: true,
          hari_kerja: true,
          tanggal_mulai: true,
          tanggal_selesai: true,
          status: true,
        },
      }),
    ]);

    const calendarItems = [];

    for (const item of storyPlanners) {
      const when = item.count_time instanceof Date ? item.count_time : new Date(item.count_time);
      calendarItems.push({
        type: 'story_planner',
        id: item.id_story,
        user_id: item.id_user,
        title: item.deskripsi_kerja || 'Story Planner',
        description: item.deskripsi_kerja || null,
        status: item.status,
        start: formatISO(when),
        end: formatISO(when),
      });
    }

    for (const item of pengajuanCuti) {
      const cutiItem = buildCutiCalendarItem(item, rangeFrom, rangeTo);
      if (cutiItem) calendarItems.push(cutiItem);
    }

    for (const item of pengajuanIzinSakit) {
      const startDate = item.tanggal_pengajuan || item.created_at;
      calendarItems.push({
        type: 'izin_sakit',
        id: item.id_pengajuan_izin_sakit,
        user_id: item.id_user,
        title: 'Pengajuan Izin Sakit Disetujui',
        description: item.handover || null,
        start: formatISO(startOfDay(startDate)),
        end: formatISO(endOfDay(startDate)),
      });
    }

    for (const item of pengajuanIzinJam) {
      const startDate = item.jam_mulai;
      const endDate = item.jam_selesai;
      calendarItems.push({
        type: 'izin_jam',
        id: item.id_pengajuan_izin_jam,
        user_id: item.id_user,
        title: 'Pengajuan Izin Jam Disetujui',
        description: item.keperluan || null,
        start: formatISO(startDate),
        end: formatISO(endDate),
      });
    }

    for (const shift of shiftKerja) {
      calendarItems.push({
        type: 'shift_kerja',
        id: shift.id_shift_kerja,
        user_id: shift.id_user,
        title: shift.hari_kerja || 'Shift Kerja',
        description: shift.status || null,
        start: formatISO(startOfDay(shift.tanggal_mulai)),
        end: formatISO(endOfDay(shift.tanggal_selesai)),
      });
    }

    sortByStartAsc(calendarItems);

    const total = calendarItems.length;
    const startIndex = (page - 1) * perPage;
    const data = calendarItems.slice(startIndex, startIndex + perPage);

    return NextResponse.json({
      ok: true,
      data,
      meta: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
      },
    });
  } catch (err) {
    console.error('GET /mobile/calendar error:', err);
    return NextResponse.json({ ok: false, message: 'Failed to fetch calendar data.' }, { status: 500 });
  }
}
