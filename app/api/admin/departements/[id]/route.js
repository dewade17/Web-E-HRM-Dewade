import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';

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

export async function GET(_req, { params }) {
  try {
    const { id } = params;
    const data = await db.departement.findUnique({
      where: { id_departement: id },
      select: {
        id_departement: true,
        nama_departement: true,
        created_at: true,
        updated_at: true,
        deleted_at: true,
      },
    });
    if (!data) return NextResponse.json({ message: 'Departement tidak ditemukan' }, { status: 404 });
    return NextResponse.json({ data });
  } catch (err) {
    console.error('GET /departements/[id] error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}

export async function PUT(req, { params }) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const { id } = params;
    const body = await req.json();

    if (body.nama_departement !== undefined && String(body.nama_departement).trim() === '') {
      return NextResponse.json({ message: 'departement tidak boleh kosong.' }, { status: 400 });
    }

    const updated = await db.departement.update({
      where: { id_departement: id },
      data: {
        ...(body.nama_departement !== undefined && { nama_departement: String(body.nama_departement).trim() }),
      },
      select: { id_departement: true, nama_departement: true, updated_at: true },
    });

    return NextResponse.json({ message: 'Departement diperbarui.', data: updated });
  } catch (err) {
    if (err?.code === 'P2025') {
      return NextResponse.json({ message: 'Departement tidak ditemukan' }, { status: 404 });
    }
    console.error('PUT /departements/[id] error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const { id } = params;

    // Pastikan data ada (agar balasan 404 lebih jelas)
    const exists = await db.departement.findUnique({
      where: { id_departement: id },
      select: { id_departement: true },
    });
    if (!exists) {
      return NextResponse.json({ message: 'Departement tidak ditemukan' }, { status: 404 });
    }

    // Hard delete
    await db.departement.delete({
      where: { id_departement: id },
    });

    return NextResponse.json({ message: 'Departement dihapus.' });
  } catch (err) {
    // Jika masih ada relasi yang RESTRICT (belum SetNull/Cascade), MySQL akan lempar FK error (Prisma P2003)
    if (err?.code === 'P2003') {
      return NextResponse.json({ message: 'Gagal menghapus: masih direferensikan oleh entitas lain. Pastikan relasi memakai onDelete: SetNull atau lakukan re-assign.' }, { status: 409 });
    }
    if (err?.code === 'P2025') {
      return NextResponse.json({ message: 'Departement tidak ditemukan' }, { status: 404 });
    }
    console.error('DELETE /departements/[id] error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
