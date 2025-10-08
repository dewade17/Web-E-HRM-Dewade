import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { parseDateTimeToUTC } from '@/helpers/date-helper';

async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const payload = verifyAuthToken(auth.slice(7));
      return {
        actor: {
          id: payload?.sub || payload?.id_user || payload?.userId || null,
          role: payload?.role || null,
          source: 'bearer',
        },
      };
    } catch (err) {
      console.warn('Invalid bearer token for admin agenda-kerja detail API, fallback to session.', err);
      /* fallback ke NextAuth */
    }
  }

  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;

  return {
    actor: {
      id: sessionOrRes?.user?.id || null,
      role: sessionOrRes?.user?.role || null,
      source: 'session',
    },
  };
}

function guardOperational(actor) {
  if (!actor?.role || actor.role !== 'OPERASIONAL') {
    return NextResponse.json({ message: 'Forbidden: hanya role OPERASIONAL yang dapat mengakses resource ini.' }, { status: 403 });
  }
  return null;
}

const VALID_STATUS = ['diproses', 'ditunda', 'selesai'];
const VALID_KEBUTUHAN = ['PENTING_MENDESAK', 'TIDAK_PENTING_TAPI_MENDESAK', 'PENTING_TAK_MENDESAK', 'TIDAK_PENTING_TIDAK_MENDESAK'];

function toDateOrNull(v) {
  if (!v) return null;
  const parsed = parseDateTimeToUTC(v);
  return parsed ?? null;
}

export async function GET(request, { params }) {
  const auth = await ensureAuth(request);
  if (auth instanceof NextResponse) return auth;

  const forbidden = guardOperational(auth.actor);
  if (forbidden) return forbidden;

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
    console.error(`GET /api/admin/agenda-kerja/${params.id} error:`, err);
    return NextResponse.json({ ok: false, message: 'Gagal mengambil detail' }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  const auth = await ensureAuth(request);
  if (auth instanceof NextResponse) return auth;

  const forbidden = guardOperational(auth.actor);
  if (forbidden) return forbidden;

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
      ...(body.id_user !== undefined && { id_user: String(body.id_user ?? '').trim() }),
      ...(body.id_agenda !== undefined && { id_agenda: String(body.id_agenda ?? '').trim() }),
      ...(body.deskripsi_kerja !== undefined && { deskripsi_kerja: String(body.deskripsi_kerja ?? '').trim() }),
      ...(body.status !== undefined && { status: String(body.status).toLowerCase() }),
      ...(start_date !== undefined && { start_date }),
      ...(end_date !== undefined && { end_date }),
      ...(duration_seconds !== undefined && { duration_seconds }),
      ...(body.id_absensi !== undefined && { id_absensi: body.id_absensi ?? null }),
      ...(kebutuhanAgenda.value !== undefined && { kebutuhan_agenda: kebutuhanAgenda.value }),
    };

    if (data.deskripsi_kerja !== undefined && !String(data.deskripsi_kerja).trim()) {
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

    return NextResponse.json({ ok: true, data: updated });
  } catch (err) {
    console.error(`PUT /api/admin/agenda-kerja/${params.id} error:`, err);
    return NextResponse.json({ ok: false, message: 'Gagal mengubah agenda kerja' }, { status: 500 });
  }
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
    console.error(`DELETE /api/admin/agenda-kerja/${params.id} error:`, err);
    return NextResponse.json({ ok: false, message: 'Gagal menghapus agenda kerja' }, { status: 500 });
  }
}

function normalizeKebutuhanInput(input) {
  if (input === undefined) return { value: undefined };
  if (input === null) return { value: null };

  const trimmed = String(input).trim();
  if (!trimmed) return { value: null };

  const normalized = trimmed.toUpperCase();
  if (!VALID_KEBUTUHAN.includes(normalized)) {
    return { error: 'kebutuhan_agenda tidak valid' };
  }

  return { value: normalized };
}
