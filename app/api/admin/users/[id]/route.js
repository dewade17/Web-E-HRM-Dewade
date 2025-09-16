export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { createClient } from '@supabase/supabase-js';

// ===== Helpers: Auth (Admin) =====
async function getAdminActor(req) {
  // Izinkan Bearer (mis. Postman) ATAU NextAuth session (panel admin)
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const payload = verifyAuthToken(auth.slice(7));
      return { id: payload?.sub || payload?.id_user || payload?.userId, role: payload?.role, source: 'bearer' };
    } catch (_) {
      // fallback ke session
    }
  }
  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes; // unauthorized dari util
  return { id: sessionOrRes.user.id, role: sessionOrRes.user.role, source: 'session' };
}

// ===== Helpers: Supabase Storage =====
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env tidak lengkap.');
  return createClient(url, key);
}

function extractBucketPath(publicUrl) {
  try {
    const u = new URL(publicUrl);
    const m = u.pathname.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
    if (m) return { bucket: m[1], path: decodeURIComponent(m[2]) };
  } catch (_) {}
  const m2 = String(publicUrl).match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
  if (m2) return { bucket: m2[1], path: decodeURIComponent(m2[2]) };
  return null;
}

async function deleteOldFotoFromSupabase(publicUrl) {
  if (!publicUrl) return;
  const info = extractBucketPath(publicUrl);
  if (!info) return;
  const supabase = getSupabase();
  const { error } = await supabase.storage.from(info.bucket).remove([info.path]);
  if (error) console.warn('Gagal hapus foto lama:', error.message);
}

async function uploadFotoToSupabase(nama_pengguna, file) {
  if (!file) return null;
  const supabase = getSupabase();

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const ext = (file.name?.split('.').pop() || 'bin').toLowerCase();
  const filename = `${Date.now()}.${ext}`;
  const path = `foto_profile/${nama_pengguna}/${filename}`;

  const { error: upErr } = await supabase.storage.from('e-hrm').upload(path, buffer, {
    upsert: true,
    contentType: file.type || 'application/octet-stream',
  });
  if (upErr) throw new Error(`Gagal upload foto: ${upErr.message}`);

  const { data: pub } = supabase.storage.from('e-hrm').getPublicUrl(path);
  return pub?.publicUrl || null;
}

// ===== Helpers: Body Parser =====
async function parseBody(req) {
  const ct = req.headers.get('content-type') || '';
  if (ct.includes('multipart/form-data')) {
    const form = await req.formData();
    const obj = {};
    for (const [key, val] of form.entries()) {
      if (val instanceof File) obj[key] = val;
      else obj[key] = String(val);
    }
    return { type: 'form', body: obj };
  }
  return { type: 'json', body: await req.json() };
}

// ===== GET (HR hanya) : detail user manapun =====
export async function GET(_req, { params }) {
  const actor = await getAdminActor(_req);
  if (actor instanceof NextResponse) return actor;
  if (actor.role !== 'HR') {
    return NextResponse.json({ message: 'Forbidden (HR only).' }, { status: 403 });
  }

  try {
    const { id } = params;
    const user = await db.user.findUnique({
      where: { id_user: id },
      select: {
        id_user: true,
        nama_pengguna: true,
        email: true,
        kontak: true,
        agama: true,
        foto_profil_user: true,
        tanggal_lahir: true,
        role: true,
        id_departement: true,
        id_location: true,
        created_at: true,
        updated_at: true,
        departement: { select: { id_departement: true, nama_departement: true } },
        kantor: { select: { id_location: true, nama_kantor: true } },
      },
    });
    if (!user) return NextResponse.json({ message: 'User tidak ditemukan' }, { status: 404 });
    return NextResponse.json({ data: user });
  } catch (err) {
    console.error('ADMIN GET /users/[id] error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}

// ===== PUT (HR only) : boleh ubah dept/location/role =====
export async function PUT(req, { params }) {
  const actor = await getAdminActor(req);
  if (actor instanceof NextResponse) return actor;
  if (actor.role !== 'HR') {
    return NextResponse.json({ message: 'Forbidden (HR only).' }, { status: 403 });
  }

  try {
    const { id } = params;

    const current = await db.user.findUnique({
      where: { id_user: id },
      select: { nama_pengguna: true, foto_profil_user: true },
    });
    if (!current) return NextResponse.json({ message: 'User tidak ditemukan' }, { status: 404 });

    const { type, body } = await parseBody(req);

    const wantsRemove = body.remove_foto === true || body.remove_foto === 'true';

    let uploadedUrl = null;
    if (type === 'form') {
      const file = body.file || body.foto || body.foto_profil_user;
      if (file instanceof File) {
        await deleteOldFotoFromSupabase(current.foto_profil_user);
        uploadedUrl = await uploadFotoToSupabase(current.nama_pengguna, file);
      }
    }
    if (!uploadedUrl && wantsRemove && current.foto_profil_user) {
      await deleteOldFotoFromSupabase(current.foto_profil_user);
    }

    const data = {
      ...(body.nama_pengguna !== undefined && { nama_pengguna: String(body.nama_pengguna).trim() }),
      ...(body.email !== undefined && { email: String(body.email).trim().toLowerCase() }),
      ...(body.kontak !== undefined && { kontak: body.kontak === null ? null : String(body.kontak).trim() }),
      ...(body.agama !== undefined && { agama: body.agama === null ? null : String(body.agama).trim() }),
      ...(body.tanggal_lahir !== undefined && { tanggal_lahir: body.tanggal_lahir ? new Date(body.tanggal_lahir) : null }),
      ...(body.id_departement !== undefined && { id_departement: body.id_departement || null }),
      ...(body.id_location !== undefined && { id_location: body.id_location || null }),
      ...(body.role !== undefined && { role: String(body.role) }),
      ...(uploadedUrl && { foto_profil_user: uploadedUrl }),
      ...(!uploadedUrl && wantsRemove ? { foto_profil_user: null } : {}),
    };

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ message: 'Tidak ada field yang diubah.' }, { status: 400 });
    }

    if (data.email) {
      const exists = await db.user.findUnique({ where: { email: data.email } });
      if (exists && exists.id_user !== id) {
        return NextResponse.json({ message: 'Email sudah digunakan oleh pengguna lain.' }, { status: 409 });
      }
    }
    if (data.id_departement) {
      const dept = await db.departement.findUnique({ where: { id_departement: data.id_departement } });
      if (!dept) return NextResponse.json({ message: 'Departement tidak ditemukan.' }, { status: 400 });
    }
    if (data.id_location) {
      const loc = await db.location.findUnique({ where: { id_location: data.id_location } });
      if (!loc) return NextResponse.json({ message: 'Location/kantor tidak ditemukan.' }, { status: 400 });
    }

    const updated = await db.user.update({
      where: { id_user: id },
      data,
      select: {
        id_user: true,
        nama_pengguna: true,
        email: true,
        kontak: true,
        agama: true,
        foto_profil_user: true,
        tanggal_lahir: true,
        role: true,
        id_departement: true,
        id_location: true,
        updated_at: true,
      },
    });

    return NextResponse.json({ message: 'Profil berhasil diperbarui.', data: updated });
  } catch (err) {
    if (err?.code === 'P2025') {
      return NextResponse.json({ message: 'User tidak ditemukan' }, { status: 404 });
    }
    console.error('ADMIN PUT /users/[id] error:', err);
    return NextResponse.json({ message: err?.message || 'Server error' }, { status: 500 });
  }
}

// ===== DELETE (HR/DIREKTUR) : soft delete =====
export async function DELETE(req, { params }) {
  const actor = await getAdminActor(req);
  if (actor instanceof NextResponse) return actor;
  if (!['HR', 'DIREKTUR'].includes(actor.role)) {
    return NextResponse.json({ message: 'Forbidden: tidak memiliki akses.' }, { status: 403 });
  }
  try {
    const { id } = params;
    await db.user.update({ where: { id_user: id }, data: { deleted_at: new Date() } });
    return NextResponse.json({ message: 'User dihapus (soft delete).' });
  } catch (err) {
    if (err?.code === 'P2025') {
      return NextResponse.json({ message: 'User tidak ditemukan' }, { status: 404 });
    }
    console.error('ADMIN DELETE /users/[id] error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
