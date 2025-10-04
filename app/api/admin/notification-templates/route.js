import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/option';

/**
 * @swagger
 * /api/admin/notification-templates:
 * get:
 * summary: Mengambil semua template notifikasi
 * tags: [Admin - Notification Templates]
 * security:
 * - bearerAuth: []
 * responses:
 * 200:
 * description: Berhasil mengambil daftar template
 * content:
 * application/json:
 * schema:
 * type: array
 * items:
 * $ref: '#/components/schemas/NotificationTemplate'
 * 401:
 * description: Unauthorized
 * 500:
 * description: Internal Server Error
 */
export async function GET(request) {
  const session = await getServerSession(authOptions);

  // Otorisasi: Hanya HR atau SUPERADMIN yang bisa mengakses
  if (!session || !['HR', 'SUPERADMIN'].includes(session.user.role)) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const templates = await prisma.notificationTemplate.findMany({
      orderBy: {
        description: 'asc', // Urutkan berdasarkan deskripsi agar mudah dibaca di UI
      },
    });
    return NextResponse.json(templates);
  } catch (error) {
    console.error('Error fetching notification templates:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
