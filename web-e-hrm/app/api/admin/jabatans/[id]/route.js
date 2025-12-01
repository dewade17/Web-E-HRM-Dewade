import { NextResponse } from 'next/server';
import db from '../../../../../lib/prisma';
import { verifyAuthToken } from '../../../../../lib/jwt';
import { authenticateRequest } from '../../../../../app/utils/auth/authUtils';

function normalizeNullableString(value) {
  if (value === undefined) return { defined: false };
  const trimmed = String(value).trim();
  if (trimmed === '') return { defined: true, value: null };
  return { defined: true, value: trimmed };
}

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

// Cegah siklus: tidak boleh set induk ke dirinya sendiri atau ke salah satu turunannya.
async function assertNoCycle(newParentId, selfId) {
  if (!newParentId) return;
  if (newParentId === selfId) throw new Error('CYCLE_SELF'); // langsung dilarang

  let cursor = newParentId;
  const seen = new Set([selfId]); // jika ketemu self => siklus
  // batasi langkah agar aman dari loop tak berujung
  for (let i = 0; i < 50 && cursor; i++) {
    if (seen.has(cursor)) throw new Error('CYCLE_DETECTED');
    seen.add(cursor);
    const node = await db.jabatan.findUnique({
      where: { id_jabatan: cursor },
      select: { id_induk_jabatan: true },
    });
    if (!node) break; // parent hilang: validasi eksistensi ditangani terpisah
    cursor = node.id_induk_jabatan;
  }
}

export async function GET(req, { params }) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const { id } = params;
    const data = await db.jabatan.findUnique({
      where: { id_jabatan: id },
      select: {
        id_jabatan: true,
        nama_jabatan: true,
        id_departement: true,
        id_induk_jabatan: true,
        created_at: true,
        updated_at: true,
        deleted_at: true,
        departement: {
          select: {
            id_departement: true,
            nama_departement: true,
          },
        },
        induk: {
          select: {
            id_jabatan: true,
            nama_jabatan: true,
          },
        },
      },
    });

    if (!data) {
      return NextResponse.json({ message: 'Jabatan tidak ditemukan' }, { status: 404 });
    }

    const users_active_count = await db.user.count({
      where: { id_jabatan: id, deleted_at: null },
    });

    return NextResponse.json({ data: { ...data, users_active_count } });
  } catch (err) {
    console.error('GET /jabatans/[id] error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}

export async function PUT(req, { params }) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const { id } = params;
    const body = await req.json();

    if (body.nama_jabatan !== undefined && String(body.nama_jabatan).trim() === '') {
      return NextResponse.json({ message: 'nama_jabatan tidak boleh kosong.' }, { status: 400 });
    }

    const departementId = normalizeNullableString(body.id_departement);
    const parentId = normalizeNullableString(body.id_induk_jabatan);

    // Larang self-parent
    if (parentId.defined && parentId.value === id) {
      return NextResponse.json({ message: 'Induk jabatan tidak boleh sama dengan jabatan itu sendiri.' }, { status: 400 });
    }

    // Validasi eksistensi departement jika DIISI (bukan null)
    if (departementId.defined && departementId.value) {
      const departement = await db.departement.findUnique({
        where: { id_departement: departementId.value },
        select: { id_departement: true },
      });
      if (!departement) {
        return NextResponse.json({ message: 'Departement tidak ditemukan.' }, { status: 404 });
      }
    }

    // Validasi eksistensi parent jika DIISI (bukan null)
    if (parentId.defined && parentId.value) {
      const parent = await db.jabatan.findUnique({
        where: { id_jabatan: parentId.value },
        select: { id_jabatan: true },
      });
      if (!parent) {
        return NextResponse.json({ message: 'Induk jabatan tidak ditemukan.' }, { status: 404 });
      }
      // Cek siklus lebih dalam (parent tidak boleh keturunan dari id)
      await assertNoCycle(parentId.value, id);
    }

    const updated = await db.jabatan.update({
      where: { id_jabatan: id },
      data: {
        ...(body.nama_jabatan !== undefined && { nama_jabatan: String(body.nama_jabatan).trim() }),
        ...(departementId.defined && { id_departement: departementId.value }), // bisa null
        ...(parentId.defined && { id_induk_jabatan: parentId.value }), // bisa null
      },
      select: {
        id_jabatan: true,
        nama_jabatan: true,
        id_departement: true,
        id_induk_jabatan: true,
        updated_at: true,
      },
    });

    return NextResponse.json({ message: 'Jabatan diperbarui.', data: updated });
  } catch (err) {
    if (err?.message === 'CYCLE_SELF' || err?.message === 'CYCLE_DETECTED') {
      return NextResponse.json({ message: 'Pengaturan induk jabatan menimbulkan siklus hierarki.' }, { status: 400 });
    }
    if (err?.code === 'P2025') {
      return NextResponse.json({ message: 'Jabatan tidak ditemukan' }, { status: 404 });
    }
    console.error('PUT /jabatans/[id] error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const { id } = params;
    const { searchParams } = new URL(req.url);
    const hard = searchParams.get('hard') === '1' || searchParams.get('force') === '1';

    const existing = await db.jabatan.findUnique({
      where: { id_jabatan: id },
      select: { id_jabatan: true, deleted_at: true },
    });
    if (!existing) {
      return NextResponse.json({ message: 'Jabatan tidak ditemukan' }, { status: 404 });
    }

    if (!hard) {
      // Soft delete (idempoten)
      if (existing.deleted_at) {
        return NextResponse.json({ message: 'Jabatan sudah dihapus.' });
      }
      const soft = await db.jabatan.update({
        where: { id_jabatan: id },
        data: { deleted_at: new Date() },
        select: { id_jabatan: true, deleted_at: true },
      });
      return NextResponse.json({ message: 'Jabatan dihapus (soft delete).', data: soft });
    }

    // Hard delete (bisa gagal bila FK masih refer ke jabatan ini)
    await db.jabatan.delete({ where: { id_jabatan: id } });
    return NextResponse.json({ message: 'Jabatan dihapus permanen.' });
  } catch (err) {
    if (err?.code === 'P2003') {
      return NextResponse.json({ message: 'Gagal menghapus: jabatan masih direferensikan oleh entitas lain.' }, { status: 409 });
    }
    if (err?.code === 'P2025') {
      return NextResponse.json({ message: 'Jabatan tidak ditemukan' }, { status: 404 });
    }
    console.error('DELETE /jabatans/[id] error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
