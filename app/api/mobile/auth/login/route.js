// app/api/mobile/auth/login/route.js
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import db from '@/lib/prisma';
import { signAuthToken } from '@/lib/jwt';

export async function POST(req) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ message: 'Email dan password wajib diisi.' }, { status: 400 });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await db.user.findUnique({ where: { email: normalizedEmail } });

    // Pesan disamakan untuk cegah user-enumeration
    if (!user) {
      return NextResponse.json({ message: 'Email atau password salah.' }, { status: 401 });
    }

    const ok = await bcrypt.compare(String(password), user.password_hash);
    if (!ok) {
      return NextResponse.json({ message: 'Email atau password salah.' }, { status: 401 });
    }

    // Hanya ACCESS TOKEN (JWT) 1 hari
    const accessToken = signAuthToken(
      {
        sub: user.id_user,
        role: user.role,
        email: user.email,
      },
      { expiresIn: '1y' } // override TTL jika perlu
    );

    return NextResponse.json({ message: 'Login berhasil.', accessToken }, { status: 200 });
  } catch (err) {
    console.error('Login error:', err);
    return NextResponse.json({ message: 'Terjadi kesalahan pada server.' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ message: 'Method Not Allowed' }, { status: 405 });
}
