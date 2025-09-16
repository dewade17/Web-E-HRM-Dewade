import { NextResponse } from 'next/server';
import crypto from 'crypto';
import db from '@/lib/prisma';
import transporter from '../../../../utils/mailer/mailer';

export async function POST(req) {
  try {
    const { email } = await req.json();
    if (!email) {
      return NextResponse.json({ message: 'Email wajib diisi.' }, { status: 400 });
    }

    const normalized = String(email).trim().toLowerCase();
    const user = await db.user.findUnique({ where: { email: normalized } });

    // Respons generik (hindari user enumeration)
    const genericOk = NextResponse.json({
      message: 'kode reset telah dikirim.',
    });

    if (!user) return genericOk;

    // Cek koneksi SMTP dulu
    await transporter.verify();

    // Generate kode 6 digit + hash
    const rawToken = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Simpan token terlebih dulu
    await db.user.update({
      where: { id_user: user.id_user },
      data: {
        reset_password_token: hashedToken,
        reset_password_expires_at: expiresAt,
      },
    });

    try {
      // Kirim email OTP (tanpa link)
      await transporter.sendMail({
        from: `"${process.env.MAIL_FROM_NAME || 'E-HRM'}" <${process.env.MAIL_FROM_ADDRESS || process.env.MAIL_USERNAME}>`,
        to: normalized,
        subject: 'Kode Reset Password Account E-HRM',
        html: `
          <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6">
            <h2>Reset Password</h2>
            <p>Halo ${user.nama_pengguna || ''},</p>
            <p>Berikut adalah <b>kode verifikasi</b> untuk reset password akun Anda:</p>
            <div style="font-size:28px;font-weight:700;letter-spacing:4px;padding:12px 16px;border:1px solid #e5e7eb;display:inline-block;border-radius:8px;">
              ${rawToken}
            </div>
            <p style="margin-top:12px"><small>Kode berlaku selama <b>10 menit</b>. Jangan berikan kode ini kepada siapa pun.</small></p>
            <p style="color:#6b7280"><small>Abaikan email ini jika Anda tidak meminta reset password.</small></p>
          </div>
        `,
      });
    } catch (mailErr) {
      // Rollback token supaya tidak ada OTP tersimpan jika email gagal terkirim
      await db.user.update({
        where: { id_user: user.id_user },
        data: { reset_password_token: null, reset_password_expires_at: null },
      });
      throw mailErr;
    }

    return genericOk;
  } catch (err) {
    console.error('reset-password/request error:', err);
    // Tetap respons generik agar aman, tapi log di server
    return NextResponse.json({ message: 'kode reset telah dikirim.' }, { status: 200 });
    // return NextResponse.json({ message: 'Terjadi kesalahan pada server.' }, { status: 500 });
  }
}
