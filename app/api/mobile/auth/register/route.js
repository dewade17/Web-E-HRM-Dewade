// app/api/mobile/auth/register/route.js
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import db from '../../../../../lib/prisma';
import { parseDateOnlyToUTC } from '@/helpers/date-helper';

const ROLES = ['KARYAWAN', 'HR', 'OPERASIONAL', 'DIREKTUR'];

export async function POST(req) {
  try {
    const body = await req.json();

    // Wajib: nama_pengguna, email, password
    const required = ['nama_pengguna', 'email', 'password'];
    for (const key of required) {
      const val = body[key];
      if (val == null || String(val).trim() === '') {
        return NextResponse.json({ message: `Field '${key}' wajib diisi.` }, { status: 400 });
      }
    }

    const email = String(body.email).trim().toLowerCase();

    // Cek email unik
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ message: 'Email sudah terdaftar.' }, { status: 409 });
    }

    // Validasi opsional: departement & location hanya dicek jika dikirimkan
    let deptId = null;
    if (body.id_departement != null && String(body.id_departement).trim() !== '') {
      deptId = String(body.id_departement).trim();
      const dept = await db.departement.findUnique({ where: { id_departement: deptId } });
      if (!dept) {
        return NextResponse.json({ message: 'Departement tidak ditemukan.' }, { status: 400 });
      }
    }

    let locId = null;
    if (body.id_location != null && String(body.id_location).trim() !== '') {
      locId = String(body.id_location).trim();
      const loc = await db.location.findUnique({ where: { id_location: locId } });
      if (!loc) {
        return NextResponse.json({ message: 'Location/kantor tidak ditemukan.' }, { status: 400 });
      }
    }

    // Hash password
    const password_hash = await bcrypt.hash(String(body.password), 12);

    // Role default KARYAWAN jika tidak valid
    const role = body.role && ROLES.includes(body.role) ? body.role : 'KARYAWAN';

    // Tanggal lahir (opsional) dengan validasi format
    let tanggal_lahir = null;
    if (body.tanggal_lahir) {
      const parsedTanggal = parseDateOnlyToUTC(body.tanggal_lahir);
      if (!(parsedTanggal instanceof Date)) {
        return NextResponse.json({ message: 'Format tanggal_lahir tidak valid (gunakan YYYY-MM-DD atau ISO 8601).' }, { status: 400 });
      }
      tanggal_lahir = parsedTanggal;
    }

    const agama = body.agama ?? null;

    const created = await db.user.create({
      data: {
        nama_pengguna: String(body.nama_pengguna).trim(),
        email,
        password_hash,
        kontak: body.kontak ?? null,
        foto_profil_user: body.foto_profil_user ?? null,
        tanggal_lahir,
        agama,
        role,
        ...(deptId ? { id_departement: deptId } : {}),
        ...(locId ? { id_location: locId } : {}),
        password_updated_at: new Date(),
      },
      select: {
        id_user: true,
        nama_pengguna: true,
        email: true,
        role: true,
        id_departement: true,
        id_location: true,
        created_at: true,
      },
    });

    return NextResponse.json({ message: 'Registrasi berhasil.', user: created }, { status: 201 });
  } catch (err) {
    console.error('Register error:', err);
    const msg = err?.message?.includes('Unique constraint') || err?.code === 'P2002' ? 'Email sudah digunakan.' : err?.message || 'Terjadi kesalahan pada server.';
    return NextResponse.json({ message: msg }, { status: 500 });
  }
}
