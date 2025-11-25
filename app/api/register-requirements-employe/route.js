import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import db from '../../../lib/prisma';

const REQUIRED_FIELDS = ['email', 'nama_pengguna', 'password'];

export async function POST(req) {
  try { 
    const body = await req.json();

    // Validasi field wajib
    for (const field of REQUIRED_FIELDS) {
      const value = body?.[field];
      if (value === undefined || value === null || String(value).trim() === '') {
        return NextResponse.json({ message: `Field '${field}' wajib diisi.` }, { status: 400 });
      }
    }

    const email = String(body.email).trim().toLowerCase();
    const nama_pengguna = String(body.nama_pengguna).trim();

    // Cek apakah email sudah terdaftar
    const existingUser = await db.user.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json({ message: 'Email sudah terdaftar.' }, { status: 409 });
    }

    // Hash password
    const password_hash = await bcrypt.hash(String(body.password), 12);

    const user = await db.user.create({
      data: {
        email,
        nama_pengguna,
        password_hash,
        role: 'KARYAWAN',
        password_updated_at: new Date(),
      },
      select: {
        id_user: true,
        email: true,
        nama_pengguna: true,
        role: true,
        created_at: true,
      },
    });

    return NextResponse.json(
      {
        message: 'Registrasi berhasil.',
        user,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error during registration:', error);
    const message = error?.message?.includes('Unique constraint') || error?.code === 'P2002' ? 'Email sudah digunakan.' : 'Terjadi kesalahan pada server.';
    return NextResponse.json({ message }, { status: 500 });
  }
}
