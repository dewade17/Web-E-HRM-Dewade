// app/api/admin/cuti-konfigurasi/matrix/route.js
import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';

const MONTHS = ['JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI', 'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'];
const ALLOWED_MONTHS = new Set(MONTHS);

/* ========= AUTH HELPERS ========= */
async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const payload = verifyAuthToken(auth.slice(7));
      return { actor: { id: payload?.sub || payload?.id_user || payload?.userId, role: payload?.role, source: 'bearer' } };
    } catch (_) {}
  }
  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;
  return { actor: { id: sessionOrRes.user.id, role: sessionOrRes.user.role, source: 'session' } };
}

function guardHr(actor) {
  const role = String(actor?.role || '')
    .trim()
    .toUpperCase();
  if (!['HR', 'OPERASIONAL', 'SUPERADMIN'].includes(role)) {
    return NextResponse.json({ message: 'Forbidden: hanya HR/OPERASIONAL/SUPERADMIN yang dapat mengakses resource ini.' }, { status: 403 });
  }
  return null;
}

/* ========= GET MATRIX ========= */
export async function GET(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;
  const forbidden = guardHr(auth.actor);
  if (forbidden) return forbidden;

  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') || '').trim();
    const deptId = (searchParams.get('deptId') || '').trim();
    const jabatanId = (searchParams.get('jabatanId') || '').trim();

    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
    const pageSize = Math.min(Math.max(parseInt(searchParams.get('pageSize') || '50', 10), 1), 200);

    // filter user aktif
    const userWhere = {
      status_kerja: 'AKTIF',
      deleted_at: null,
      ...(deptId ? { id_departement: deptId } : {}),
      ...(jabatanId ? { id_jabatan: jabatanId } : {}),
      ...(q
        ? {
            OR: [{ nama_pengguna: { contains: q } }, { email: { contains: q } }],
          }
        : {}),
    };

    const total = await db.user.count({ where: userWhere });
    const users = await db.user.findMany({
      where: userWhere,
      orderBy: { nama_pengguna: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id_user: true,
        nama_pengguna: true,
        email: true,
        foto_profil_user: true,
        id_departement: true,
        id_jabatan: true,
        departement: { select: { nama_departement: true } },
        jabatan: { select: { nama_jabatan: true } },
      },
    });

    const ids = users.map((u) => u.id_user);
    const configs = ids.length
      ? await db.cutiKonfigurasi.findMany({
          where: { id_user: { in: ids }, deleted_at: null },
          select: { id_cuti_konfigurasi: true, id_user: true, bulan: true, kouta_cuti: true },
        })
      : [];

    // map id_user -> { bulan -> kouta }
    const byUser = new Map();
    for (const u of users) {
      const quotas = {};
      for (const m of MONTHS) quotas[m] = 0; // default 0
      byUser.set(u.id_user, {
        id: u.id_user,
        name: u.nama_pengguna,
        email: u.email,
        jabatan: u.jabatan?.nama_jabatan || null,
        departemen: u.departement?.nama_departement || null,
        foto_profil_user: u.foto_profil_user || null,
        quotas,
      });
    }

    for (const c of configs) {
      const row = byUser.get(c.id_user);
      if (!row) continue;
      const mk = String(c.bulan || '').toUpperCase();
      if (ALLOWED_MONTHS.has(mk)) row.quotas[mk] = c.kouta_cuti ?? 0;
    }

    const data = Array.from(byUser.values());

    return NextResponse.json({
      data,
      months: MONTHS, // agar FE pakai urutan yang sama
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (err) {
    console.error('GET /admin/cuti-konfigurasi/matrix error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

/* ========= BULK SAVE ========= */
export async function POST(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;
  const forbidden = guardHr(auth.actor);
  if (forbidden) return forbidden;

  try {
    const body = await req.json();
    const items = Array.isArray(body?.items) ? body.items : [];

    if (!items.length) {
      return NextResponse.json({ message: 'items[] kosong.' }, { status: 400 });
    }

    // validasi ringan
    for (const [i, it] of items.entries()) {
      const id_user = String(it?.id_user || '').trim();
      const bulan = String(it?.bulan || '')
        .trim()
        .toUpperCase();
      const kouta = Number(it?.kouta_cuti);
      if (!id_user) return NextResponse.json({ message: `items[${i}].id_user wajib.` }, { status: 400 });
      if (!ALLOWED_MONTHS.has(bulan)) return NextResponse.json({ message: `items[${i}].bulan tidak valid.` }, { status: 400 });
      if (!Number.isInteger(kouta) || kouta < 0) return NextResponse.json({ message: `items[${i}].kouta_cuti harus bilangan bulat >= 0.` }, { status: 400 });
    }

    // transaksi upsert manual agar tidak bergantung pada unique composite schema
    await db.$transaction(async (tx) => {
      for (const it of items) {
        const id_user = String(it.id_user).trim();
        const bulan = String(it.bulan).trim().toUpperCase();
        const kouta = Number(it.kouta_cuti);

        const existing = await tx.cutiKonfigurasi.findFirst({
          where: { id_user, bulan },
          select: { id_cuti_konfigurasi: true },
        });

        if (existing) {
          await tx.cutiKonfigurasi.update({
            where: { id_cuti_konfigurasi: existing.id_cuti_konfigurasi },
            data: { kouta_cuti: kouta, deleted_at: null },
          });
        } else {
          await tx.cutiKonfigurasi.create({
            data: { id_user, bulan, kouta_cuti: kouta },
          });
        }
      }
    });

    return NextResponse.json({ message: 'Tersimpan.' });
  } catch (err) {
    console.error('POST /admin/cuti-konfigurasi/matrix error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}
