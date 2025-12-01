// app/api/admin/departements/route.js
import { NextResponse } from 'next/server';
import db from '../../../../lib/prisma';
import { verifyAuthToken } from '../../../../lib/jwt';
import { authenticateRequest } from '../../../utils/auth/authUtils';

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

export async function GET(req) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
    const pageSize = Math.min(Math.max(parseInt(searchParams.get('pageSize') || '10', 10), 1), 100);
    const search = (searchParams.get('search') || '').trim();
    const includeDeleted = searchParams.get('includeDeleted') === '1';

    // sanitize orderBy + sort
    const rawOrderBy = (searchParams.get('orderBy') || 'created_at').trim().toLowerCase();
    const sort = (searchParams.get('sort') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    const allowedOrderFields = new Set(['created_at', 'updated_at', 'nama_departement']);
    const orderAliasMap = { name: 'nama_departement' };

    let orderByField = allowedOrderFields.has(rawOrderBy) ? rawOrderBy : allowedOrderFields.has(orderAliasMap[rawOrderBy]) ? orderAliasMap[rawOrderBy] : 'created_at';

    // jika minta "members", urutkan setelah enrichment
    const sortByMembers = rawOrderBy === 'members';

    const where = {
      ...(includeDeleted ? {} : { deleted_at: null }),
      ...(search ? { nama_departement: { contains: search, mode: 'insensitive' } } : {}),
    };

    const [total, pageData] = await Promise.all([
      db.departement.count({ where }),
      db.departement.findMany({
        where,
        orderBy: sortByMembers ? { created_at: 'desc' } : { [orderByField]: sort },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id_departement: true,
          nama_departement: true,
          id_supervisor: true,
          created_at: true,
          updated_at: true,
          deleted_at: true,
          supervisor: {
            select: { id_user: true, nama_pengguna: true, email: true },
          },
        },
      }),
    ]);

    const ids = pageData.map((d) => d.id_departement);

    let activeCountsMap = {};
    let totalCountsMap = {};

    if (ids.length > 0) {
      const [activeCounts, totalCounts] = await Promise.all([
        db.user.groupBy({
          by: ['id_departement'],
          where: { id_departement: { in: ids }, deleted_at: null },
          _count: { _all: true },
        }),
        db.user.groupBy({
          by: ['id_departement'],
          where: { id_departement: { in: ids } },
          _count: { _all: true },
        }),
      ]);

      activeCountsMap = Object.fromEntries(activeCounts.map((r) => [r.id_departement, r._count._all]));
      totalCountsMap = Object.fromEntries(totalCounts.map((r) => [r.id_departement, r._count._all]));
    }

    // alias supervisor.nama_pengguna -> supervisor.nama_lengkap
    let enriched = pageData.map((d) => ({
      ...d,
      supervisor: d.supervisor
        ? {
            id_user: d.supervisor.id_user,
            email: d.supervisor.email,
            nama_lengkap: d.supervisor.nama_pengguna,
            nama_pengguna: d.supervisor.nama_pengguna,
          }
        : null,
      users_active_count: activeCountsMap[d.id_departement] ?? 0,
      users_total_count: totalCountsMap[d.id_departement] ?? 0,
    }));

    if (sortByMembers) {
      enriched.sort((a, b) => (sort === 'asc' ? a.users_active_count - b.users_active_count : b.users_active_count - a.users_active_count));
    }

    return NextResponse.json({
      data: enriched,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (err) {
    console.error('GET /departements error:', err?.code || err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}

export async function POST(req) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const body = await req.json();
    if (!body.nama_departement || String(body.nama_departement).trim() === '') {
      return NextResponse.json({ message: "Field 'nama_departement' wajib diisi." }, { status: 400 });
    }

    let supervisorConnect = undefined;
    if (body.id_supervisor !== undefined) {
      const idSupervisor = String(body.id_supervisor).trim();
      if (idSupervisor === '') {
        supervisorConnect = null; // eksplisit lepas supervisor
      } else {
        const supervisor = await db.user.findUnique({
          where: { id_user: idSupervisor },
          select: { id_user: true },
        });
        if (!supervisor) {
          return NextResponse.json({ message: 'Supervisor tidak ditemukan.' }, { status: 404 });
        }
        supervisorConnect = idSupervisor;
      }
    }

    const created = await db.departement.create({
      data: {
        nama_departement: String(body.nama_departement).trim(),
        ...(supervisorConnect !== undefined && { id_supervisor: supervisorConnect }),
      },
      select: {
        id_departement: true,
        nama_departement: true,
        id_supervisor: true,
        created_at: true,
      },
    });

    return NextResponse.json({ message: 'Departement dibuat.', data: created }, { status: 201 });
  } catch (err) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ message: 'Supervisor sudah terpasang pada departement lain.' }, { status: 409 });
    }
    console.error('POST /departements error:', err?.code || err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
