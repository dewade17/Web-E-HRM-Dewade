// app/api/mobile/users/[id]/route.js
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { verifyAuthToken } from '@/lib/jwt';

// KARYAWAN hanya boleh ubah field ini
const KARYAWAN_ALLOW = new Set(['nama_pengguna', 'email', 'kontak', 'agama', 'foto_profil_user', 'tanggal_lahir']);

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

// ===== Helpers: Ambil & verifikasi token dari header =====
function getClaimsFromRequest(req) {
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) {
    const e = new Error('Token tidak ditemukan');
    e.status = 401;
    throw e;
  }
  const token = auth.slice(7).trim();
  try {
    return verifyAuthToken(token);
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      const e = new Error('Token sudah kedaluwarsa');
      e.status = 401;
      throw e;
    }
    if (err instanceof jwt.JsonWebTokenError) {
      const e = new Error('Token tidak valid');
      e.status = 401;
      throw e;
    }
    const e = new Error('Gagal memverifikasi token');
    e.status = 500;
    throw e;
  }
}

// ===== GET (self only) =====
export async function GET(req, { params }) {
  try {
    const claims = getClaimsFromRequest(req);
    const { id } = params;
    if ((claims.sub || claims.id_user) !== id) {
      return NextResponse.json({ message: 'Tidak boleh mengakses profil pengguna lain.' }, { status: 403 });
    }

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
    const status = err?.status || 500;
    const msg = err?.message || 'Server error';
    return NextResponse.json({ message: msg }, { status });
  }
}

// ===== PUT (self only, allowlist) =====
export async function PUT(req, { params }) {
  try {
    const claims = getClaimsFromRequest(req);
    const { id } = params;
    const actorId = claims.sub || claims.id_user;
    if (actorId !== id) {
      return NextResponse.json({ message: 'Tidak boleh mengubah profil pengguna lain.' }, { status: 403 });
    }

    const current = await db.user.findUnique({
      where: { id_user: id },
      select: { nama_pengguna: true, foto_profil_user: true },
    });
    if (!current) return NextResponse.json({ message: 'User tidak ditemukan' }, { status: 404 });

    const { type, body } = await parseBody(req);

    // Tolak jika mencoba kirim id_departement / id_location / role
    if ('id_departement' in body || 'id_location' in body || 'role' in body) {
      return NextResponse.json({ message: 'Field departement/location/role hanya bisa diubah oleh HR.' }, { status: 403 });
    }

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

    // Build payload → filter allowlist
    const raw = {
      ...(body.nama_pengguna !== undefined && { nama_pengguna: String(body.nama_pengguna).trim() }),
      ...(body.email !== undefined && { email: String(body.email).trim().toLowerCase() }),
      ...(body.kontak !== undefined && { kontak: body.kontak === null ? null : String(body.kontak).trim() }),
      ...(body.agama !== undefined && { agama: body.agama === null ? null : String(body.agama).trim() }),
      ...(body.tanggal_lahir !== undefined && { tanggal_lahir: body.tanggal_lahir ? new Date(body.tanggal_lahir) : null }),
      ...(uploadedUrl && { foto_profil_user: uploadedUrl }),
      ...(!uploadedUrl && wantsRemove ? { foto_profil_user: null } : {}),
    };
    const data = Object.fromEntries(Object.entries(raw).filter(([k]) => KARYAWAN_ALLOW.has(k)));

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ message: 'Tidak ada field yang diubah.' }, { status: 400 });
    }

    if (data.email) {
      const exists = await db.user.findUnique({ where: { email: data.email } });
      if (exists && exists.id_user !== id) {
        return NextResponse.json({ message: 'Email sudah digunakan oleh pengguna lain.' }, { status: 409 });
      }
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
    const status = err?.status || (err?.code === 'P2025' ? 404 : 500);
    const msg = err?.status === 401 ? err.message : err?.code === 'P2025' ? 'User tidak ditemukan' : err?.message || 'Server error';
    console.error('MOBILE PUT /users/[id] error:', err);
    return NextResponse.json({ message: msg }, { status });
  }
}
