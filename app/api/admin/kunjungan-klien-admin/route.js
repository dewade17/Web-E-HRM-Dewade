export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';

const normRole = (r) => String(r || '').trim().toUpperCase();
const canSeeAll = (role) => ['OPERASIONAL', 'HR', 'DIREKTUR', 'SUPERADMIN'].includes(normRole(role));
const canManageAll = (role) => ['OPERASIONAL', 'SUPERADMIN'].includes(normRole(role));

async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const payload = verifyAuthToken(auth.slice(7));
      const id = payload?.sub || payload?.id_user || payload?.userId;
      if (id) {
        return { actor: { id, role: payload?.role, source: 'bearer' } };
      }
    } catch (_) {}
  }
  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;
  const id = sessionOrRes?.user?.id || sessionOrRes?.user?.id_user;
  if (!id) return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
  return { actor: { id, role: sessionOrRes?.user?.role, source: 'session' } };
}

function isNullLike(v) {
  if (v == null) return true;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    return !t || t === 'null' || t === 'undefined';
  }
  return false;
}

/** ⬇️ include YANG VALID sesuai schema */
const kunjunganInclude = {
  kategori: { select: { id_kategori_kunjungan: true, kategori_kunjungan: true } },
  user: {
    select: {
      id_user: true,
      nama_pengguna: true,
      email: true,
      foto_profil_user: true,   // ada di schema
      role: true,
      divisi: true,
      id_departement: true,
      id_jabatan: true,
      // nama relasi di schema: Departement (tabel), field relasi di User: 'departement'
      departement: { select: { id_departement: true, nama_departement: true } },
      jabatan:     { select: { id_jabatan: true,     nama_jabatan: true     } },
    },
  },
  reports: {
    where: { deleted_at: null },
    select: {
      id_kunjungan_report_recipient: true,
      id_user: true,
      recipient_role_snapshot: true,
      recipient_nama_snapshot: true,
      catatan: true,
      status: true,
      notified_at: true,
      read_at: true,
      acted_at: true,
      created_at: true,
      updated_at: true,
    },
  },
};

export async function GET(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
    const rawPageSize = parseInt(searchParams.get('pageSize') || searchParams.get('perPage') || '10', 10);
    const pageSize = Math.min(Math.max(Number.isNaN(rawPageSize) ? 10 : rawPageSize, 1), 50);

    const q = (searchParams.get('q') || searchParams.get('search') || '').trim();
    const kategoriId = (searchParams.get('id_kategori_kunjungan') || '').trim();
    const userId = (searchParams.get('id_user') || '').trim();
    const status = (searchParams.get('status_kunjungan') || '').trim().toLowerCase();
    const tanggalMulai = (searchParams.get('tanggal_mulai') || '').trim();
    const tanggalSelesai = (searchParams.get('tanggal_selesai') || '').trim();

    const filters = [{ deleted_at: null }];

    // role filter
    if (!canSeeAll(auth.actor?.role)) {
      filters.push({ id_user: auth.actor.id });
    }

    if (userId) filters.push({ id_user: userId });
    if (kategoriId) filters.push({ id_kategori_kunjungan: kategoriId });
    if (status) filters.push({ status_kunjungan: status });

    // rentang tanggal (kolom 'tanggal' bertipe Date-only di schema)
    if (tanggalMulai || tanggalSelesai) {
      const range = {};
      if (tanggalMulai) {
        const d = new Date(tanggalMulai);
        if (!Number.isNaN(d.getTime())) range.gte = d;
      }
      if (tanggalSelesai) {
        const d = new Date(tanggalSelesai);
        if (!Number.isNaN(d.getTime())) {
          // eksklusif < esok harinya
          const end = new Date(d);
          end.setDate(end.getDate() + 1);
          range.lt = end;
        }
      }
      if (Object.keys(range).length) filters.push({ tanggal: range });
    }

    if (q) {
      filters.push({
        OR: [
          { deskripsi: { contains: q, mode: 'insensitive' } },
          { hand_over: { contains: q, mode: 'insensitive' } },
        ],
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
    console.error('GET /admin/kunjungan-klien error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function POST(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  // hanya OP/SUPERADMIN boleh assign ke orang lain, tapi untuk ringkasnya skip validasi lanjutan di sini
  try {
    const body = await req.json();
    const {
      id_user,
      id_kategori_kunjungan,
      deskripsi,
      hand_over,
      tanggal,
      jam_mulai,
      jam_selesai,
    } = body;

    if (isNullLike(id_kategori_kunjungan)) {
      return NextResponse.json({ message: "Field 'id_kategori_kunjungan' wajib diisi." }, { status: 400 });
    }
    if (isNullLike(tanggal)) {
      return NextResponse.json({ message: "Field 'tanggal' wajib diisi." }, { status: 400 });
    }

    const tgl = new Date(String(tanggal)); // date-only
    if (Number.isNaN(tgl.getTime())) {
      return NextResponse.json({ message: "Field 'tanggal' tidak valid." }, { status: 400 });
    }

    const jm = isNullLike(jam_mulai) ? null : new Date(String(jam_mulai));
    const js = isNullLike(jam_selesai) ? null : new Date(String(jam_selesai));
    if (jm && Number.isNaN(jm.getTime())) return NextResponse.json({ message: "Field 'jam_mulai' tidak valid." }, { status: 400 });
    if (js && Number.isNaN(js.getTime())) return NextResponse.json({ message: "Field 'jam_selesai' tidak valid." }, { status: 400 });

    const targetUserId = id_user && canManageAll(auth.actor?.role) ? String(id_user) : auth.actor.id;

    // Snapshot pembuat (admin/operator yang membuat entri kunjungan)
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
        created_by_snapshot = [label, role ? `(${String(role)})` : null]
          .filter(Boolean)
          .join(' ')
          .slice(0, 255);
      }
    } catch (_) {
      // biarkan null jika gagal mengambil snapshot
      created_by_snapshot = null;
    }

    const created = await db.kunjungan.create({
      data: {
        id_user: targetUserId,
        id_kategori_kunjungan: String(id_kategori_kunjungan),
        deskripsi: isNullLike(deskripsi) ? null : String(deskripsi),
        hand_over: isNullLike(hand_over) ? null : String(hand_over),
        tanggal: tgl,
        jam_mulai: jm,
        jam_selesai: js,
        status_kunjungan: 'diproses',
        created_by_snapshot,
      },
      include: kunjunganInclude,
    });

    return NextResponse.json({ message: 'Kunjungan klien dibuat.', data: created }, { status: 201 });
  } catch (err) {
    if (err?.code === 'P2003') {
      return NextResponse.json({ message: 'Kategori kunjungan tidak valid.' }, { status: 400 });
    }
    console.error('POST /admin/kunjungan-klien error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}
