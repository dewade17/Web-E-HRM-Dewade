import { NextResponse } from 'next/server';
import db from '../../../../lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '../../../utils/auth/authUtils';
import { parseDateTimeToUTC } from '../../../../helpers/date-helper';

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

function parseRequiredString(value, field) {
  const str = value !== undefined && value !== null ? String(value).trim() : '';
  if (!str) {
    throw new Error(`Field '${field}' wajib diisi.`);
  }
  return str;
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
    throw new Error(`Field '${field}' harus berupa tanggal/waktu yang valid.`);
  }
  return parsed;
}

const VALID_WORK_STATUS = new Set(['berjalan', 'berhenti', 'selesai']);

function parseStatus(value) {
  const status = value !== undefined && value !== null ? String(value).trim() : '';
  if (!status) return undefined;
  if (!VALID_WORK_STATUS.has(status)) {
    throw new Error(`Field 'status' harus salah satu dari: ${Array.from(VALID_WORK_STATUS).join(', ')}.`);
  }
  return status;
}

export async function GET(req) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
    const pageSize = Math.min(Math.max(parseInt(searchParams.get('pageSize') || '10', 10), 1), 100);
    const search = (searchParams.get('search') || '').trim();
    const includeDeleted = searchParams.get('includeDeleted') === '1';
    const status = parseStatus(searchParams.get('status'));
    const idUser = (searchParams.get('id_user') || '').trim();
    const idDepartement = (searchParams.get('id_departement') || '').trim();

    // NEW: filter range count_time (per minggu)
    let countTimeFrom;
    let countTimeTo;
    try {
      countTimeFrom = parseOptionalDateTime(searchParams.get('countTimeFrom'), 'countTimeFrom');
      countTimeTo = parseOptionalDateTime(searchParams.get('countTimeTo'), 'countTimeTo');
    } catch (parseErr) {
      return NextResponse.json({ message: parseErr.message }, { status: 400 });
    }

    const allowedOrder = new Set(['deskripsi_kerja', 'count_time', 'status', 'created_at', 'updated_at', 'deleted_at']);
    const orderByParam = (searchParams.get('orderBy') || 'created_at').trim();
    const orderByField = allowedOrder.has(orderByParam) ? orderByParam : 'created_at';
    const sort = (searchParams.get('sort') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    const where = {
      ...(includeDeleted ? {} : { deleted_at: null }),
      ...(search
        ? {
            deskripsi_kerja: {
              contains: search,
              mode: 'insensitive',
            },
          }
        : {}),
      ...(status ? { status } : {}),
      ...(idUser ? { id_user: idUser } : {}),
      ...(idDepartement ? { id_departement: idDepartement } : {}),
      ...(countTimeFrom || countTimeTo
        ? {
            count_time: {
              ...(countTimeFrom && { gte: countTimeFrom }),
              ...(countTimeTo && { lte: countTimeTo }),
            },
          }
        : {}),
    };

    const [total, data] = await Promise.all([
      db.storyPlanner.count({ where }),
      db.storyPlanner.findMany({
        where,
        orderBy: { [orderByField]: sort },
        skip: (page - 1) * pageSize,
        take: pageSize,
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
      }),
    ]);

    const enriched = data.map((row) => ({
      ...row,
      user: row.user
        ? {
            id_user: row.user.id_user,
            email: row.user.email,
            nama_lengkap: row.user.nama_pengguna,
            nama_pengguna: row.user.nama_pengguna,
          }
        : null,
    }));

    return NextResponse.json({
      data: enriched,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err) {
    console.error('GET /story-planner error:', err && err.code ? err.code : err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}

export async function POST(req) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const body = await req.json();

    let idUser;
    try {
      idUser = parseRequiredString(body.id_user, 'id_user');
    } catch (parseErr) {
      return NextResponse.json({ message: parseErr.message }, { status: 400 });
    }

    const userExists = await db.user.findUnique({
      where: { id_user: idUser },
      select: { id_user: true },
    });
    if (!userExists) {
      return NextResponse.json({ message: 'User tidak ditemukan.' }, { status: 404 });
    }

    let idDepartement = undefined;
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

    let deskripsi;
    try {
      deskripsi = parseRequiredString(body.deskripsi_kerja, 'deskripsi_kerja');
    } catch (parseErr) {
      return NextResponse.json({ message: parseErr.message }, { status: 400 });
    }

    let countTime;
    try {
      countTime = parseOptionalDateTime(body.count_time, 'count_time');
    } catch (parseErr) {
      return NextResponse.json({ message: parseErr.message }, { status: 400 });
    }

    let status = 'berjalan';
    try {
      status = parseStatus(body.status) || 'berjalan';
    } catch (parseErr) {
      return NextResponse.json({ message: parseErr.message }, { status: 400 });
    }

    const created = await db.storyPlanner.create({
      data: {
        id_user: idUser,
        deskripsi_kerja: deskripsi,
        status: status,
        ...(countTime !== undefined && { count_time: countTime }),
        ...(idDepartement !== undefined && { id_departement: idDepartement }),
      },
      select: {
        id_story: true,
        id_user: true,
        id_departement: true,
        deskripsi_kerja: true,
        count_time: true,
        status: true,
        created_at: true,
      },
    });

    return NextResponse.json({ message: 'Story planner dibuat.', data: created }, { status: 201 });
  } catch (err) {
    console.error('POST /story-planner error:', err && err.code ? err.code : err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
