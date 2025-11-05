// app/api/admin/users/[id]/route.js
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import db from '../../../../../lib/prisma';
import { verifyAuthToken } from '../../../../../lib/jwt';
import { authenticateRequest } from '../../../../../app/utils/auth/authUtils';
import { createClient } from '@supabase/supabase-js';
import { JENIS_KELAMIN_VALUES, STATUS_KERJA_VALUES, normalizeNullableEnum, normalizeNullableInt, normalizeNullableString, normalizeOptionalDate } from '../../../_utils/user-field-normalizer';

// ===== Helpers umum =====
const normRole = (r) =>
  String(r || '')
    .trim()
    .toUpperCase();
const VIEW_ROLES = new Set(['HR', 'DIREKTUR', 'SUPERADMIN']);
const EDIT_ROLES = new Set(['HR', 'DIREKTUR', 'SUPERADMIN']);
const DELETE_ROLES = new Set(['HR', 'DIREKTUR', 'SUPERADMIN']);
const STATUS_CUTI_VALUES = new Set(['aktif', 'nonaktif']);

// ===== Helpers: Auth (Admin) =====
async function getAdminActor(req) {
  // Izinkan Bearer (mis. Postman) ATAU NextAuth session (panel admin)
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const payload = verifyAuthToken(auth.slice(7));
      return {
        id: payload?.sub || payload?.id_user || payload?.userId,
        role: normRole(payload?.role),
        source: 'bearer',
      };
    } catch (_) {
      // fallback ke session
    }
  }
  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes; // unauthorized dari util
  return {
    id: sessionOrRes.user.id,
    role: normRole(sessionOrRes.user.role),
    source: 'session',
  };
}

// ===== Helpers: Supabase Storage =====
function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
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

// ===== GET : detail user (HR/DIREKTUR/SUPERADMIN) =====
export async function GET(_req, { params }) {
  const actor = await getAdminActor(_req);
  if (actor instanceof NextResponse) return actor;
  if (!VIEW_ROLES.has(actor.role)) {
    return NextResponse.json({ message: 'Forbidden (HR/Direktur/Superadmin only).' }, { status: 403 });
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
        nama_kontak_darurat: true,
        kontak_darurat: true,
        agama: true,
        foto_profil_user: true,
        tanggal_lahir: true,
        tempat_lahir: true,
        jenis_kelamin: true,
        golongan_darah: true,
        status_perkawinan: true,
        alamat_ktp: true,
        alamat_ktp_provinsi: true,
        alamat_ktp_kota: true,
        alamat_domisili: true,
        alamat_domisili_provinsi: true,
        alamat_domisili_kota: true,
        zona_waktu: true,
        jenjang_pendidikan: true,
        jurusan: true,
        nama_institusi_pendidikan: true,
        tahun_lulus: true,
        nomor_induk_karyawan: true,
        divisi: true,
        role: true,
        id_departement: true,
        id_location: true,
        id_jabatan: true,
        status_kerja: true,
        status_cuti: true,
        tanggal_mulai_bekerja: true,
        nomor_rekening: true,
        jenis_bank: true,
        created_at: true,
        updated_at: true,
        departement: { select: { id_departement: true, nama_departement: true } },
        kantor: { select: { id_location: true, nama_kantor: true } },
        jabatan: { select: { id_jabatan: true, nama_jabatan: true } },
      },
    });
    if (!user) return NextResponse.json({ message: 'User tidak ditemukan' }, { status: 404 });
    return NextResponse.json({ data: user });
  } catch (err) {
    console.error('ADMIN GET /users/[id] error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}

// ===== PUT : update profil (HR/DIREKTUR/SUPERADMIN) =====
export async function PUT(req, { params }) {
  const actor = await getAdminActor(req);
  if (actor instanceof NextResponse) return actor;
  if (!EDIT_ROLES.has(actor.role)) {
    return NextResponse.json({ message: 'Forbidden (HR/Direktur/Superadmin only).' }, { status: 403 });
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

    const { value: tanggalLahirValue, error: tanggalLahirError } = normalizeOptionalDate(body.tanggal_lahir, 'tanggal_lahir');
    if (tanggalLahirError) {
      return NextResponse.json({ message: tanggalLahirError }, { status: 400 });
    }
    const { value: tanggalMulaiValue, error: tanggalMulaiError } = normalizeOptionalDate(body.tanggal_mulai_bekerja, 'tanggal_mulai_bekerja');
    if (tanggalMulaiError) {
      return NextResponse.json({ message: tanggalMulaiError }, { status: 400 });
    }
    const { value: tahunLulusValue, error: tahunLulusError } = normalizeNullableInt(body.tahun_lulus, 'tahun_lulus');
    if (tahunLulusError) {
      return NextResponse.json({ message: tahunLulusError }, { status: 400 });
    }
    const { value: jenisKelaminValue, error: jenisKelaminError } = normalizeNullableEnum(body.jenis_kelamin, JENIS_KELAMIN_VALUES, 'jenis_kelamin');
    if (jenisKelaminError) {
      return NextResponse.json({ message: jenisKelaminError }, { status: 400 });
    }
    const { value: statusKerjaValue, error: statusKerjaError } = normalizeNullableEnum(body.status_kerja, STATUS_KERJA_VALUES, 'status_kerja');
    if (statusKerjaError) {
      return NextResponse.json({ message: statusKerjaError }, { status: 400 });
    }

    let statusCutiValue;
    if (body.status_cuti !== undefined) {
      const normalized = String(body.status_cuti).trim().toLowerCase();
      if (!STATUS_CUTI_VALUES.has(normalized)) {
        return NextResponse.json({ message: "Field 'status_cuti' harus salah satu dari: aktif, nonaktif." }, { status: 400 });
      }
      statusCutiValue = normalized;
    }

    const tempatLahir = normalizeNullableString(body.tempat_lahir);
    const golonganDarah = normalizeNullableString(body.golongan_darah);
    const statusPerkawinan = normalizeNullableString(body.status_perkawinan);
    const alamatKtp = normalizeNullableString(body.alamat_ktp);
    const alamatKtpProvinsi = normalizeNullableString(body.alamat_ktp_provinsi);
    const alamatKtpKota = normalizeNullableString(body.alamat_ktp_kota);
    const alamatDomisili = normalizeNullableString(body.alamat_domisili);
    const alamatDomisiliProvinsi = normalizeNullableString(body.alamat_domisili_provinsi);
    const alamatDomisiliKota = normalizeNullableString(body.alamat_domisili_kota);
    const zonaWaktu = normalizeNullableString(body.zona_waktu);
    const jenjangPendidikan = normalizeNullableString(body.jenjang_pendidikan);
    const jurusan = normalizeNullableString(body.jurusan);
    const namaInstitusi = normalizeNullableString(body.nama_institusi_pendidikan);
    const nomorInduk = normalizeNullableString(body.nomor_induk_karyawan);
    const divisi = normalizeNullableString(body.divisi);
    const departementId = normalizeNullableString(body.id_departement);
    const locationId = normalizeNullableString(body.id_location);
    const jabatanId = normalizeNullableString(body.id_jabatan);
    const nomorRekening = normalizeNullableString(body.nomor_rekening);
    const jenisBank = normalizeNullableString(body.jenis_bank);
    const namaKontakDarurat = normalizeNullableString(body.nama_kontak_darurat);
    const kontakDarurat = normalizeNullableString(body.kontak_darurat);
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
      ...(namaKontakDarurat.value !== undefined && { nama_kontak_darurat: namaKontakDarurat.value }),
      ...(kontakDarurat.value !== undefined && { kontak_darurat: kontakDarurat.value }),
      ...(body.agama !== undefined && { agama: body.agama === null ? null : String(body.agama).trim() }),
      ...(tanggalLahirValue !== undefined && { tanggal_lahir: tanggalLahirValue }),
      ...(tempatLahir.value !== undefined && { tempat_lahir: tempatLahir.value }),
      ...(jenisKelaminValue !== undefined && { jenis_kelamin: jenisKelaminValue }),
      ...(golonganDarah.value !== undefined && { golongan_darah: golonganDarah.value }),
      ...(statusPerkawinan.value !== undefined && { status_perkawinan: statusPerkawinan.value }),
      ...(alamatKtp.value !== undefined && { alamat_ktp: alamatKtp.value }),
      ...(alamatKtpProvinsi.value !== undefined && { alamat_ktp_provinsi: alamatKtpProvinsi.value }),
      ...(alamatKtpKota.value !== undefined && { alamat_ktp_kota: alamatKtpKota.value }),
      ...(alamatDomisili.value !== undefined && { alamat_domisili: alamatDomisili.value }),
      ...(alamatDomisiliProvinsi.value !== undefined && { alamat_domisili_provinsi: alamatDomisiliProvinsi.value }),
      ...(alamatDomisiliKota.value !== undefined && { alamat_domisili_kota: alamatDomisiliKota.value }),
      ...(zonaWaktu.value !== undefined && { zona_waktu: zonaWaktu.value }),
      ...(jenjangPendidikan.value !== undefined && { jenjang_pendidikan: jenjangPendidikan.value }),
      ...(jurusan.value !== undefined && { jurusan: jurusan.value }),
      ...(namaInstitusi.value !== undefined && { nama_institusi_pendidikan: namaInstitusi.value }),
      ...(tahunLulusValue !== undefined && { tahun_lulus: tahunLulusValue }),
      ...(nomorInduk.value !== undefined && { nomor_induk_karyawan: nomorInduk.value }),
      ...(divisi.value !== undefined && { divisi: divisi.value }),
      ...(departementId.value !== undefined && { id_departement: departementId.value }),
      ...(locationId.value !== undefined && { id_location: locationId.value }),
      ...(jabatanId.value !== undefined && { id_jabatan: jabatanId.value }),
      ...(statusKerjaValue !== undefined && { status_kerja: statusKerjaValue }),
      ...(statusCutiValue !== undefined && { status_cuti: statusCutiValue }),
      ...(tanggalMulaiValue !== undefined && { tanggal_mulai_bekerja: tanggalMulaiValue }),
      ...(nomorRekening.value !== undefined && { nomor_rekening: nomorRekening.value }),
      ...(jenisBank.value !== undefined && { jenis_bank: jenisBank.value }),
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
    if (data.id_jabatan) {
      const job = await db.jabatan.findUnique({ where: { id_jabatan: data.id_jabatan } });
      if (!job) return NextResponse.json({ message: 'Jabatan tidak ditemukan.' }, { status: 400 });
    }
    if (data.nomor_induk_karyawan) {
      const existingNik = await db.user.findUnique({ where: { nomor_induk_karyawan: data.nomor_induk_karyawan } });
      if (existingNik && existingNik.id_user !== id) {
        return NextResponse.json({ message: 'Nomor induk karyawan sudah digunakan oleh pengguna lain.' }, { status: 409 });
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
        nama_kontak_darurat: true,
        kontak_darurat: true,
        agama: true,
        foto_profil_user: true,
        tanggal_lahir: true,
        tempat_lahir: true,
        jenis_kelamin: true,
        golongan_darah: true,
        status_perkawinan: true,
        alamat_ktp: true,
        alamat_ktp_provinsi: true,
        alamat_ktp_kota: true,
        alamat_domisili: true,
        alamat_domisili_provinsi: true,
        alamat_domisili_kota: true,
        zona_waktu: true,
        jenjang_pendidikan: true,
        jurusan: true,
        nama_institusi_pendidikan: true,
        tahun_lulus: true,
        nomor_induk_karyawan: true,
        divisi: true,
        role: true,
        id_departement: true,
        id_location: true,
        id_jabatan: true,
        status_kerja: true,
        status_cuti: true,
        tanggal_mulai_bekerja: true,
        nomor_rekening: true,
        jenis_bank: true,
        updated_at: true,
        departement: { select: { id_departement: true, nama_departement: true } },
        kantor: { select: { id_location: true, nama_kantor: true } },
        jabatan: { select: { id_jabatan: true, nama_jabatan: true } },
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

// ===== DELETE : soft delete (HR/DIREKTUR/SUPERADMIN) =====
export async function DELETE(req, { params }) {
  const actor = await getAdminActor(req);
  if (actor instanceof NextResponse) return actor;
  if (!DELETE_ROLES.has(actor.role)) {
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
