// web-e-hrm/app/api/notifications/[id]/route.js

import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/option';

/**
 * Helper untuk mendapatkan ID pengguna dari Bearer token (untuk mobile)
 * atau dari sesi NextAuth (untuk web).
 * @param {Request} request
 * @returns {Promise<NextResponse | {userId: string}>}
 */
async function resolveUserId(request) {
  const authHeader = request.headers.get('authorization') || '';

  // 1. Coba autentikasi via Bearer Token (prioritas untuk mobile)
  if (authHeader.startsWith('Bearer ')) {
    const rawToken = authHeader.slice(7).trim();
    try {
      const payload = verifyAuthToken(rawToken);
      const userId = payload?.id_user || payload?.sub || payload?.userId || payload?.id;
      if (userId) return { userId };
    } catch (error) {
      // Jika token tidak valid, jangan langsung error, biarkan fallback ke session
      console.warn('Invalid bearer token, falling back to session auth:', error.message);
    }
  }

  // 2. Fallback ke autentikasi via Sesi NextAuth (untuk web)
  const session = await getServerSession(authOptions);
  const sessionUserId = session?.user?.id || session?.user?.id_user;
  if (sessionUserId) {
    return { userId: sessionUserId };
  }

  // Jika keduanya gagal, kembalikan error Unauthorized
  return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
}

/**
 * Menangani permintaan PUT untuk menandai notifikasi sebagai 'telah dibaca'.
 * @param {Request} request
 * @param {{ params: { id: string } }} context
 */
export async function PUT(request, { params }) {
  const authResult = await resolveUserId(request);
  if (authResult instanceof NextResponse) return authResult; // Kembalikan error response jika ada
  const { userId } = authResult;

  const { id: notificationId } = params;

  if (!notificationId) {
    return NextResponse.json({ message: 'Notification ID is required' }, { status: 400 });
  }

  try {
    // Gunakan `updateMany` untuk keamanan, memastikan user hanya bisa update notifikasinya sendiri.
    const result = await db.notification.updateMany({
      where: {
        id_notification: notificationId,
        id_user: userId, // Kunci keamanan utama
      },
      data: {
        status: 'read',
        read_at: new Date(),
      },
    });

    // `updateMany` mengembalikan jumlah record yang diubah.
    // Jika 0, berarti notifikasi tidak ditemukan atau bukan milik user tersebut.
    if (result.count === 0) {
      return NextResponse.json({ message: 'Notification not found or access denied' }, { status: 404 });
    }

    // Ambil data yang sudah diupdate untuk dikembalikan sebagai respons.
    const updatedNotification = await db.notification.findUnique({
      where: { id_notification: notificationId },
    });

    return NextResponse.json({
      ok: true,
      message: 'Notification marked as read',
      data: updatedNotification,
    });
  } catch (error) {
    console.error(`Failed to update notification ${notificationId}:`, error);
    if (error.code === 'P2023') {
      // Error spesifik Prisma untuk format ID salah
      return NextResponse.json({ message: 'Invalid Notification ID format' }, { status: 400 });
    }
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
