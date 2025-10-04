import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../auth/[...nextauth]/option';

/**
 * @swagger
 * /api/admin/notification-templates/{id}:
 * put:
 * summary: Memperbarui template notifikasi
 * tags: [Admin - Notification Templates]
 * security:
 * - bearerAuth: []
 * parameters:
 * - in: path
 * name: id
 * required: true
 * schema:
 * type: string
 * description: ID dari notification template
 * requestBody:
 * required: true
 * content:
 * application/json:
 * schema:
 * type: object
 * properties:
 * titleTemplate:
 * type: string
 * bodyTemplate:
 * type: string
 * isActive:
 * type: boolean
 * responses:
 * 200:
 * description: Template berhasil diperbarui
 * 400:
 * description: Bad Request (e.g., field yang dibutuhkan kosong)
 * 401:
 * description: Unauthorized
 * 404:
 * description: Template tidak ditemukan
 * 500:
 * description: Internal Server Error
 */
export async function PUT(request, { params }) {
  const session = await getServerSession(authOptions);

  if (!session || !['HR', 'SUPERADMIN'].includes(session.user.role)) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const { id } = params;

  try {
    const body = await request.json();
    const { titleTemplate, bodyTemplate, isActive } = body;

    // Validasi input
    if (!titleTemplate || !bodyTemplate) {
      return NextResponse.json({ message: 'Title dan Body template tidak boleh kosong' }, { status: 400 });
    }

    const updatedTemplate = await prisma.notificationTemplate.update({
      where: { id: id },
      data: {
        titleTemplate: titleTemplate,
        bodyTemplate: bodyTemplate,
        // Hanya update isActive jika nilainya boolean, untuk menghindari null/undefined
        isActive: typeof isActive === 'boolean' ? isActive : undefined,
      },
    });

    return NextResponse.json(updatedTemplate);
  } catch (error) {
    console.error(`Error updating notification template ${id}:`, error);
    if (error.code === 'P2025') {
      // Kode error Prisma untuk "record not found"
      return NextResponse.json({ message: 'Template tidak ditemukan' }, { status: 404 });
    }
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
