// app/api/mobile/users/[id]/route.js
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { verifyAuthToken } from '@/lib/jwt';

/* =========================================================
   ALLOWLIST: KARYAWAN hanya boleh ubah field berikut
   =======================================================*/
const KARYAWAN_ALLOW = new Set(['nama_pengguna', 'email', 'kontak', 'agama', 'foto_profil_user', 'tanggal_lahir', 'alamat_ktp', 'alamat_domisili', 'golongan_darah', 'nomor_rekening', 'jenis_bank']);

/* =========================================================
   SUPABASE STORAGE HELPERS
   =======================================================*/
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

/* =========================================================
   BODY PARSER
   =======================================================*/
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

/* =========================================================
   TOKEN HELPERS
   =======================================================*/
function getClaimsFromRequest(req) {
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) {
    const e = new Error('Token tidak ditemukan');
    e.status = 401;
    throw e;
  }
  const token = auth.slice(7).trim();
  try {
    return verifyAuthToken(token); // { sub, id_user, ... }
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

/* =========================================================
   DATE-HELPER (digabung dari date-helper.js)
   - Aman untuk MySQL DATE/DateTime via Prisma
   =======================================================*/
const DATE_ONLY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_NO_TZ_REGEX = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?$/;

function cloneDateToUTC(date) {
  if (!(date instanceof Date)) return null;
  if (Number.isNaN(date.getTime())) return null;
  // toISOString selalu UTC, jadi new Date(iso) = UTC clone
  return new Date(date.toISOString());
}

function parseDateOnlyString(value) {
  const match = DATE_ONLY_REGEX.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  // set ke UTC midnight
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

function parseDateTimeNoTzString(value) {
  const normalized = value.replace(' ', 'T');
  const match = DATETIME_NO_TZ_REGEX.exec(normalized);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = '0', millisecond = '0'] = match;
  const ms = `${millisecond}`.padEnd(3, '0').slice(0, 3);
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), Number(ms)));
}

export function parseDateOnlyToUTC(value) {
  if (value === undefined || value === null) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsedString = parseDateOnlyString(trimmed);
    if (parsedString) return parsedString;
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

export function parseDateTimeToUTC(value) {
  if (value === undefined || value === null) return null;

  if (value instanceof Date) {
    return cloneDateToUTC(value);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const noTz = parseDateTimeNoTzString(trimmed);
    if (noTz) return noTz;
    const parsed = new Date(trimmed);
    return cloneDateToUTC(parsed);
  }

  const parsed = new Date(value);
  return cloneDateToUTC(parsed);
}

export function startOfUTCDay(value) {
  const parsed = value instanceof Date ? cloneDateToUTC(value) : parseDateTimeToUTC(value);
  if (!parsed) return null;
  parsed.setUTCHours(0, 0, 0, 0);
  return parsed;
}

export function endOfUTCDay(value) {
  const parsed = value instanceof Date ? cloneDateToUTC(value) : parseDateTimeToUTC(value);
  if (!parsed) return null;
  parsed.setUTCHours(23, 59, 59, 999);
  return parsed;
}

/* =========================================================
   NORMALIZER STRING & TANGGAL (DATE-ONLY)
   =======================================================*/
function normalizeNullableString(value) {
  if (value === undefined) return { defined: false };
  const trimmed = String(value).trim();
  if (trimmed === '') return { defined: true, value: null };
  return { defined: true, value: trimmed };
}

// khusus kolom DATE (tanpa waktu) seperti `tanggal_lahir`
function normalizeOptionalDateOnly(v, fieldName) {
  if (v === undefined) return { value: undefined, error: null };
  if (v === null || String(v).trim?.() === '') return { value: null, error: null };
  const d = parseDateOnlyToUTC(v); // aman untuk @db.Date
  if (!d) return { value: undefined, error: `Format tanggal tidak valid untuk ${fieldName}` };
  return { value: d, error: null };
}

/* =========================================================
   GET (self only) → hanya 11 field
   =======================================================*/
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
        alamat_domisili: true,
        alamat_ktp: true,
        kontak: true,
        agama: true,
        tanggal_lahir: true,
        golongan_darah: true,
        nomor_rekening: true,
        jenis_bank: true,
        foto_profil_user: true,
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

/* =========================================================
   PUT (self only) → hanya 11 field
   =======================================================*/
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
      select: { nama_pengguna: true, email: true, foto_profil_user: true },
    });
    if (!current) return NextResponse.json({ message: 'User tidak ditemukan' }, { status: 404 });

    const { type, body } = await parseBody(req);

    // Tolak bila ada field non-domain karyawan
    if ('id_departement' in body || 'id_location' in body || 'role' in body || 'id_jabatan' in body || 'status_kerja' in body) {
      return NextResponse.json({ message: 'Field departement/location/jabatan/role/status_kerja hanya bisa diubah oleh HR.' }, { status: 403 });
    }

    const wantsRemove = body.remove_foto === true || body.remove_foto === 'true';

    // Validasi + normalisasi tanggal (DATE-ONLY)
    const { value: tanggalLahirValue, error: tanggalLahirError } = normalizeOptionalDateOnly(body.tanggal_lahir, 'tanggal_lahir');
    if (tanggalLahirError) {
      return NextResponse.json({ message: tanggalLahirError }, { status: 400 });
    }

    // Normalisasi string → null bila '' (empty)
    const namaPengguna = normalizeNullableString(body.nama_pengguna);
    const email = normalizeNullableString(body.email);
    const alamatDomisili = normalizeNullableString(body.alamat_domisili);
    const alamatKtp = normalizeNullableString(body.alamat_ktp);
    const kontak = normalizeNullableString(body.kontak);
    const agama = normalizeNullableString(body.agama);
    const golonganDarah = normalizeNullableString(body.golongan_darah);
    const nomorRekening = normalizeNullableString(body.nomor_rekening);
    const jenisBank = normalizeNullableString(body.jenis_bank);

    // Upload foto bila multipart
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

    // Susun payload mentah (hanya kandidat 11 field)
    const raw = {
      ...(namaPengguna.defined && { nama_pengguna: namaPengguna.value }),
      ...(email.defined && { email: email.value?.toLowerCase() ?? null }),
      ...(alamatDomisili.defined && { alamat_domisili: alamatDomisili.value }),
      ...(alamatKtp.defined && { alamat_ktp: alamatKtp.value }),
      ...(kontak.defined && { kontak: kontak.value }),
      ...(agama.defined && { agama: agama.value }),
      ...(tanggalLahirValue !== undefined && { tanggal_lahir: tanggalLahirValue }),
      ...(golonganDarah.defined && { golongan_darah: golonganDarah.value }),
      ...(nomorRekening.defined && { nomor_rekening: nomorRekening.value }),
      ...(jenisBank.defined && { jenis_bank: jenisBank.value }),
      ...(uploadedUrl && { foto_profil_user: uploadedUrl }),
      ...(!uploadedUrl && wantsRemove ? { foto_profil_user: null } : {}),
    };

    // Filter strict by allowlist
    const data = Object.fromEntries(Object.entries(raw).filter(([k]) => KARYAWAN_ALLOW.has(k)));

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ message: 'Tidak ada field yang diubah.' }, { status: 400 });
    }

    // Cek unik email bila diganti
    if (data.email !== undefined && data.email !== null) {
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
        alamat_domisili: true,
        alamat_ktp: true,
        kontak: true,
        agama: true,
        tanggal_lahir: true,
        golongan_darah: true,
        nomor_rekening: true,
        jenis_bank: true,
        foto_profil_user: true,
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
