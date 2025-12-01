import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { ensureNotificationAuth } from '../_auth';

export async function PUT(request, { params }) {
  const auth = await ensureNotificationAuth(request);
  if (auth instanceof NextResponse) return auth;

  const userId = auth.actor?.id;
  if (!userId) {
    return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
  }

  const { id: notificationId } = params;
  if (!notificationId) {
    return NextResponse.json({ message: 'Notification ID is required' }, { status: 400 });
  }

  try {
    const result = await db.notification.updateMany({
      where: {
        id_notification: notificationId,
        id_user: userId,
        deleted_at: null,
      },
      data: {
        status: 'read',
        read_at: new Date(),
        seen_at: new Date(),
      },
    });

    if (result.count === 0) {
      return NextResponse.json({ message: 'Notification not found or access denied' }, { status: 404 });
    }

    const updated = await db.notification.findUnique({
      where: { id_notification: notificationId },
    });

    return NextResponse.json({
      ok: true,
      message: 'Notification marked as read',
      data: updated,
    });
  } catch (error) {
    console.error(`PUT /api/notifications/${notificationId} error:`, error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
