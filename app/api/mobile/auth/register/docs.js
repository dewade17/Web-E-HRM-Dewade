import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import db from '@/lib/prisma'; // Menggunakan instance Prisma singleton kamu

/**
 * @swagger
 * /api/mobile/auth/register:
 *   post:
 *     summary: Registrasi Karyawan Baru
 *     description: Mendaftarkan akun karyawan baru dengan role default 'KARYAWAN'.
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - nama
 *               - email
 *               - password
 *             properties:
 *               nama:
 *                 type: string
 *                 example: Budi Santoso
 *               email:
 *                 type: string
 *                 format: email
 *                 example: budi@company.com
 *               password:
 *                 type: string
 *                 format: password
 *                 example: Rahasia123!
 *     responses:
 *       '201':
 *         description: Berhasil registrasi
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     id_user:
 *                       type: string
 *                     nama_pengguna:
 *                       type: string
 *                     email:
 *                       type: string
 *                     role:
 *                       type: string
 *       '400':
 *         description: Data tidak lengkap
 *       '409':
 *         description: Email sudah terdaftar
 *       '500':
 *         description: Terjadi kesalahan server
 */

const registerDocs = {};
export default registerDocs;

export async function POST(req) {
  try {
    const body = await req.json();
    const { nama, email, password, nik, kontak } = body;

    // 1. Validasi Input Dasar
    if (!nama || !email || !password || !nik) {
      return NextResponse.json({ message: 'Nama, Email, Password, dan NIK wajib diisi.' }, { status: 400 });
    }

    // 2. Cek apakah Email atau NIK sudah ada di database
    // Kita menggunakan findFirst dengan operator OR
    const existingUser = await db.user.findFirst({
      where: {
        OR: [{ email: email }, { nomor_induk_karyawan: nik }],
      },
    });

    if (existingUser) {
      return NextResponse.json(
        { message: 'Email atau NIK sudah terdaftar.' },
        { status: 409 } // 409 Conflict
      );
    }

    // 3. Hash Password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 4. Buat User Baru
    // Role default kita set ke 'KARYAWAN' dan status 'AKTIF'
    const newUser = await db.user.create({
      data: {
        nama_pengguna: nama,
        email: email,
        password_hash: hashedPassword,
        nomor_induk_karyawan: nik,
        kontak: kontak || null,
        role: 'KARYAWAN', // Default Role
        status_kerja: 'AKTIF', // Default Status Kerja
        status_cuti: 'aktif', // Default Status Cuti
      },
    });

    // 5. Return Response (Tanpa mengirim balik password hash untuk keamanan)
    return NextResponse.json(
      {
        message: 'Registrasi berhasil.',
        data: {
          id_user: newUser.id_user,
          nama_pengguna: newUser.nama_pengguna,
          email: newUser.email,
          role: newUser.role,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Register Error:', error);
    return NextResponse.json({ message: 'Terjadi kesalahan pada server.' }, { status: 500 });
  }
}
