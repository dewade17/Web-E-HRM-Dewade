export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { parseDateOnlyToUTC, parseDateTimeToUTC } from '@/helpers/date-helper';

const SUPABASE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? 'e-hrm';

// === RBAC helpers (DITAMBAHKAN) ===
const normRole = (r) =>
  String(r || '')
    .trim()
    .toUpperCase();
const canSeeAll = (role) => ['OPERASIONAL', 'HR', 'DIREKTUR'].includes(normRole(role));
const canManageAll = (role) => ['OPERASIONAL'].includes(normRole(role)); // hanya Operasional yang full manage

async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const payload = verifyAuthToken(auth.slice(7));
      const id = payload?.sub || payload?.id_user || payload?.userId;
      if (id) {
        return {
          actor: {
            id,
            role: payload?.role,
            source: 'bearer',
          },
        };
      }
    } catch (_) {
      /* fallback ke NextAuth */
    }
  }

  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;

  const id = sessionOrRes?.user?.id || sessionOrRes?.user?.id_user;
  if (!id) {
    return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
  }

  return {
    actor: {
      id,
      role: sessionOrRes?.user?.role,
      source: 'session',
    },
  };
}

function isNullLike(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return true;
    const lowered = trimmed.toLowerCase();
    if (lowered === 'null' || lowered === 'undefined') return true;
  }
  return false;
}

const kunjunganInclude = {
  kategori: {
    select: {
      id_kategori_kunjungan: true,
      kategori_kunjungan: true,
    },
  },
  reports: {
    where: { deleted_at: null },
    select: {
      id_kunjungan_report_recipient: true,
      id_user: true,
      recipient_nama_snapshot: true,
      recipient_role_snapshot: true,
      catatan: true,
      status: true,
      created_at: true,
      updated_at: true,
    },
  },
};

export async function GET(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  const actorRole = auth.actor?.role; // ambil role

  if (!actorId) {
    return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
    const rawPageSize = parseInt(searchParams.get('pageSize') || searchParams.get('perPage') || '10', 10);
    const pageSize = Math.min(Math.max(Number.isNaN(rawPageSize) ? 10 : rawPageSize, 1), 50);
    const searchTerm = (searchParams.get('q') || searchParams.get('search') || '').trim();
    const kategoriId = (searchParams.get('id_kategori_kunjungan') || searchParams.get('kategoriId') || '').trim();
    const tanggalParam = (searchParams.get('tanggal') || '').trim();

    const filters = [{ deleted_at: null }];

    // RBAC: HR, DIREKTUR, OPERASIONAL bisa lihat semua
    if (!canSeeAll(actorRole)) {
      filters.push({ id_user: actorId });
    }

    if (kategoriId) {
      filters.push({ id_kategori_kunjungan: kategoriId });
    }

    if (tanggalParam) {
      const tanggal = new Date(tanggalParam);
      if (Number.isNaN(tanggal.getTime())) {
        return NextResponse.json({ message: "Parameter 'tanggal' tidak valid." }, { status: 400 });
      }
      const start = new Date(tanggal);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      filters.push({ tanggal: { gte: start, lt: end } });
    }

    if (searchTerm) {
      filters.push({
        OR: [{ deskripsi: { contains: searchTerm, mode: 'insensitive' } }, { hand_over: { contains: searchTerm, mode: 'insensitive' } }],
      });
    }

    const where = { AND: filters };

    const [total, items] = await Promise.all([
      db.kunjungan.count({ where }),
      db.kunjungan.findMany({
        where,
        orderBy: [{ tanggal: 'desc' }, { created_at: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: kunjunganInclude,
      }),
    ]);

    return NextResponse.json({
      data: items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err) {
    console.error('GET /mobile/kunjungan-klien error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function POST(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  const actorRole = auth.actor?.role;

  if (!actorId) {
    return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const body = await req.json();

    const { id_kategori_kunjungan, deskripsi, tanggal, jam_mulai, jam_selesai } = body;

    if (isNullLike(id_kategori_kunjungan)) {
      return NextResponse.json({ message: "Field 'id_kategori_kunjungan' wajib diisi." }, { status: 400 });
    }
    if (isNullLike(tanggal)) {
      return NextResponse.json({ message: "Field 'tanggal' wajib diisi." }, { status: 400 });
    }

    const tanggalDate = parseDateOnlyToUTC(tanggal);
    if (!tanggalDate) {
      return NextResponse.json({ message: "Field 'tanggal' tidak valid." }, { status: 400 });
    }

    const jamMulaiDate = !isNullLike(jam_mulai) ? parseDateTimeToUTC(jam_mulai) : null;
    if (jamMulaiDate === null && !isNullLike(jam_mulai)) {
      return NextResponse.json({ message: "Field 'jam_mulai' tidak valid." }, { status: 400 });
    }

    const jamSelesaiDate = !isNullLike(jam_selesai) ? parseDateTimeToUTC(jam_selesai) : null;
    if (jamSelesaiDate === null && !isNullLike(jam_selesai)) {
      return NextResponse.json({ message: "Field 'jam_selesai' tidak valid." }, { status: 400 });
    }

    // RBAC: Operasional boleh menetapkan rencana untuk user lain; lainnya pakai dirinya sendiri
    const targetUserId = canManageAll(actorRole) && !isNullLike(body.id_user) ? String(body.id_user).trim() : actorId;

    const data = {
      id_user: targetUserId, // <-- perbaikan inti
      id_kategori_kunjungan: String(id_kategori_kunjungan).trim(),
      deskripsi: isNullLike(deskripsi) ? null : String(deskripsi).trim(),
      tanggal: tanggalDate,
      jam_mulai: jamMulaiDate,
      jam_selesai: jamSelesaiDate,
      status_kunjungan: 'diproses',
    };

    const created = await db.kunjungan.create({
      data,
      include: kunjunganInclude,
    });

    return NextResponse.json({ message: 'Kunjungan klien dibuat.', data: created }, { status: 201 });
  } catch (err) {
    if (err?.code === 'P2003') {
      return NextResponse.json({ message: 'Kategori kunjungan tidak valid.' }, { status: 400 });
    }
    console.error('POST /mobile/kunjungan-klien error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}
