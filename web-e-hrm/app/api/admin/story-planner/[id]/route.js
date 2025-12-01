import { NextResponse } from 'next/server';
import db from '../../../../../lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '../../../../utils/auth/authUtils';
import { parseDateTimeToUTC } from '../../../../../helpers/date-helper';

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

function parseOptionalString(value) {
  if (value === undefined || value === null) return undefined;
  const str = String(value).trim();
  return str === '' ? null : str;
}

function parseOptionalDateTime(value, field) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = parseDateTimeToUTC(value);
  if (!(parsed instanceof Date)) {
    throw new Error("Field '" + field + "' harus berupa tanggal/waktu yang valid.");
  }
  return parsed;
}

const VALID_WORK_STATUS = new Set(['berjalan', 'berhenti', 'selesai']);

function parseStatus(value) {
  if (value === undefined || value === null) return undefined;
  const status = String(value).trim();
  if (!status) return undefined;
  if (!VALID_WORK_STATUS.has(status)) {
    throw new Error("Field 'status' harus salah satu dari: " + Array.from(VALID_WORK_STATUS).join(', ') + '.');
  }
  return status;
}

export async function GET(req, { params }) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const id = params.id;
    const row = await db.storyPlanner.findUnique({
      where: { id_story: id },
      select: {
        id_story: true,
        id_user: true,
        id_departement: true,
        deskripsi_kerja: true,
        count_time: true,
        status: true,
        created_at: true,
        updated_at: true,
        deleted_at: true,
        user: {
          select: { id_user: true, nama_pengguna: true, email: true },
        },
        departement: {
          select: { id_departement: true, nama_departement: true },
        },
      },
    });

    if (!row) {
      return NextResponse.json({ message: 'Story planner tidak ditemukan' }, { status: 404 });
    }

    const data = {
      ...row,
      user: row.user
        ? {
            id_user: row.user.id_user,
            email: row.user.email,
            nama_lengkap: row.user.nama_pengguna,
            nama_pengguna: row.user.nama_pengguna,
          }
        : null,
    };

    return NextResponse.json({ data });
  } catch (err) {
    console.error('GET /story-planner/[id] error:', err && err.code ? err.code : err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}

export async function PUT(req, { params }) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const id = params.id;
    const body = await req.json();

    let idDepartement;
    if (body.id_departement !== undefined) {
      const depVal = parseOptionalString(body.id_departement);
      if (depVal === null) {
        idDepartement = null;
      } else if (depVal !== undefined) {
        const depExists = await db.departement.findUnique({
          where: { id_departement: depVal },
          select: { id_departement: true },
        });
        if (!depExists) {
          return NextResponse.json({ message: 'Departement tidak ditemukan.' }, { status: 404 });
        }
        idDepartement = depVal;
      }
    }

    let countTime;
    try {
      countTime = parseOptionalDateTime(body.count_time, 'count_time');
    } catch (parseErr) {
      return NextResponse.json({ message: parseErr.message }, { status: 400 });
    }

    let status;
    try {
      status = parseStatus(body.status);
    } catch (parseErr) {
      return NextResponse.json({ message: parseErr.message }, { status: 400 });
    }

    const dataToUpdate = {
      ...(body.deskripsi_kerja !== undefined && {
        deskripsi_kerja: String(body.deskripsi_kerja).trim(),
      }),
      ...(countTime !== undefined && { count_time: countTime }),
      ...(status !== undefined && { status }),
      ...(idDepartement !== undefined && { id_departement: idDepartement }),
    };

    if (Object.keys(dataToUpdate).length === 0) {
      return NextResponse.json({ message: 'Tidak ada perubahan yang dikirim.' }, { status: 400 });
    }

    const updated = await db.storyPlanner.update({
      where: { id_story: id },
      data: dataToUpdate,
      select: {
        id_story: true,
        id_user: true,
        id_departement: true,
        deskripsi_kerja: true,
        count_time: true,
        status: true,
        updated_at: true,
      },
    });

    return NextResponse.json({
      message: 'Story planner diperbarui.',
      data: updated,
    });
  } catch (err) {
    if (err && err.code === 'P2025') {
      return NextResponse.json({ message: 'Story planner tidak ditemukan' }, { status: 404 });
    }
    console.error('PUT /story-planner/[id] error:', err && err.code ? err.code : err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const id = params.id;

    const existing = await db.storyPlanner.findUnique({
      where: { id_story: id },
      select: { id_story: true, deleted_at: true },
    });

    if (!existing) {
      return NextResponse.json({ message: 'Story planner tidak ditemukan' }, { status: 404 });
    }

    if (existing.deleted_at) {
      return NextResponse.json({
        message: 'Story planner sudah dihapus.',
      });
    }

    await db.storyPlanner.update({
      where: { id_story: id },
      data: { deleted_at: new Date() },
    });

    return NextResponse.json({ message: 'Story planner dihapus.' });
  } catch (err) {
    console.error('DELETE /story-planner/[id] error:', err && err.code ? err.code : err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
