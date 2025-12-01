import { NextResponse } from 'next/server';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import db from '../../../../../lib/prisma';

export async function POST(req) {
  try {
    const { token, password } = await req.json();

    if (!token || !password) {
      return NextResponse.json({ message: 'Token dan password wajib diisi.' }, { status: 400 });
    }

    if (String(password).length < 8) {
      return NextResponse.json({ message: 'Password minimal 8 karakter.' }, { status: 400 });
    }

    // Hash token dari user (raw) untuk dicocokkan dengan yang disimpan
    const hashed = crypto.createHash('sha256').update(String(token)).digest('hex');

    const user = await db.user.findFirst({
      where: {
        reset_password_token: hashed,
        reset_password_expires_at: { gt: new Date() },
      },
    });

    if (!user) {
      return NextResponse.json({ message: 'Token tidak valid atau sudah kedaluwarsa.' }, { status: 400 });
    }

    // Update password
    const password_hash = await bcrypt.hash(String(password), 12);

    await db.user.update({
      where: { id_user: user.id_user },
      data: {
        password_hash,
        password_updated_at: new Date(),
        reset_password_token: null,
        reset_password_expires_at: null,
      },
    });

    return NextResponse.json({ message: 'Password berhasil direset. Silakan login kembali.' });
  } catch (err) {
    console.error('reset-password/confirm error:', err);
    return NextResponse.json({ message: 'Terjadi kesalahan pada server.' }, { status: 500 });
  }
}
