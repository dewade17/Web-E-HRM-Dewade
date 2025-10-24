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
      if (id) return { actor: { id, role: payload?.role, source: 'bearer' } };
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
      foto_profil_user: true,
      role: true,
      divisi: true,
      id_departement: true,
      id_jabatan: true,
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

export async function GET(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = params || {};
    if (!id) return NextResponse.json({ message: "Parameter 'id' wajib diisi." }, { status: 400 });

    const where = { AND: [{ id_kunjungan: id }, { deleted_at: null }] };
    if (!canSeeAll(auth.actor?.role)) where.AND.push({ id_user: auth.actor.id });

    const data = await db.kunjungan.findFirst({ where, include: kunjunganInclude });
    if (!data) return NextResponse.json({ message: 'Kunjungan tidak ditemukan.' }, { status: 404 });

    return NextResponse.json({ data });
  } catch (err) {
    console.error('GET /admin/kunjungan-klien/[id] error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function PUT(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = params || {};
    if (!id) return NextResponse.json({ message: "Parameter 'id' wajib diisi." }, { status: 400 });

    const existing = await db.kunjungan.findUnique({
      where: { id_kunjungan: id },
      include: kunjunganInclude,
    });
    if (!existing || existing.deleted_at) {
      return NextResponse.json({ message: 'Kunjungan tidak ditemukan.' }, { status: 404 });
    }
    if (!canManageAll(auth.actor?.role) && existing.id_user !== auth.actor.id) {
      return NextResponse.json({ message: 'Forbidden.' }, { status: 403 });
    }

    const body = await req.json();
    const updates = {};

    if ('id_kategori_kunjungan' in body) {
      if (isNullLike(body.id_kategori_kunjungan)) {
        return NextResponse.json({ message: "Field 'id_kategori_kunjungan' tidak boleh kosong." }, { status: 400 });
      }
      updates.id_kategori_kunjungan = String(body.id_kategori_kunjungan).trim();
    }

    if ('deskripsi' in body) updates.deskripsi = isNullLike(body.deskripsi) ? null : String(body.deskripsi);
    if ('hand_over' in body) updates.hand_over = isNullLike(body.hand_over) ? null : String(body.hand_over);

    if ('tanggal' in body) {
      if (isNullLike(body.tanggal)) {
        return NextResponse.json({ message: "Field 'tanggal' tidak boleh kosong." }, { status: 400 });
      }
      const tgl = new Date(String(body.tanggal));
      if (Number.isNaN(tgl.getTime())) return NextResponse.json({ message: "Field 'tanggal' tidak valid." }, { status: 400 });
      updates.tanggal = tgl;
    }

    if ('jam_mulai' in body) {
      if (isNullLike(body.jam_mulai)) updates.jam_mulai = null;
      else {
        const jm = new Date(String(body.jam_mulai));
        if (Number.isNaN(jm.getTime())) return NextResponse.json({ message: "Field 'jam_mulai' tidak valid." }, { status: 400 });
        updates.jam_mulai = jm;
      }
    }
    if ('jam_selesai' in body) {
      if (isNullLike(body.jam_selesai)) updates.jam_selesai = null;
      else {
        const js = new Date(String(body.jam_selesai));
        if (Number.isNaN(js.getTime())) return NextResponse.json({ message: "Field 'jam_selesai' tidak valid." }, { status: 400 });
        updates.jam_selesai = js;
      }
    }

    if ('status_kunjungan' in body) {
      const val = String(body.status_kunjungan || '').trim().toLowerCase();
      const allowed = new Set(['diproses', 'berlangsung', 'selesai', 'batal']);
      if (!allowed.has(val)) return NextResponse.json({ message: "Field 'status_kunjungan' tidak valid." }, { status: 400 });
      updates.status_kunjungan = val;
    }

    if (!Object.keys(updates).length) {
      return NextResponse.json({ message: 'Tidak ada perubahan yang diterapkan.' }, { status: 400 });
    }

    const updated = await db.kunjungan.update({
      where: { id_kunjungan: id },
      data: updates,
      include: kunjunganInclude,
    });

    return NextResponse.json({ message: 'Kunjungan diperbarui.', data: updated });
  } catch (err) {
    if (err?.code === 'P2003') {
      return NextResponse.json({ message: 'Referensi kategori kunjungan tidak valid.' }, { status: 400 });
    }
    console.error('PUT /admin/kunjungan-klien/[id] error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = params || {};
    if (!id) return NextResponse.json({ message: "Parameter 'id' wajib diisi." }, { status: 400 });

    const existing = await db.kunjungan.findUnique({
      where: { id_kunjungan: id },
      include: kunjunganInclude,
    });
    if (!existing || existing.deleted_at) {
      return NextResponse.json({ message: 'Kunjungan tidak ditemukan.' }, { status: 404 });
    }
    if (!canManageAll(auth.actor?.role) && existing.id_user !== auth.actor.id) {
      return NextResponse.json({ message: 'Forbidden.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const hard = (searchParams.get('hard') || '').toLowerCase();

    if (hard === '1' || hard === 'true') {
      await db.kunjungan.delete({ where: { id_kunjungan: id } });
      return NextResponse.json({ message: 'Kunjungan dihapus permanen.' });
    }

    await db.kunjungan.update({
      where: { id_kunjungan: id },
      data: { deleted_at: new Date() },
    });
    return NextResponse.json({ message: 'Kunjungan diarsipkan.' });
  } catch (err) {
    console.error('DELETE /admin/kunjungan-klien/[id] error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}
