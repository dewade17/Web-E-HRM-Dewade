// app/api/notifications/mark-all-as-read/route.js
import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { ensureNotificationAuth } from '../_auth';

export async function PUT(request) {
  const auth = await ensureNotificationAuth(request);
  if (auth instanceof NextResponse) return auth;

  const userId = auth.actor?.id;
  if (!userId) {
    return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();

    const result = await db.notification.updateMany({
      where: {
        id_user: userId,
        status: "unread",
        deleted_at: null,
      },
      data: {
        status: "read",
        read_at: now,
        seen_at: now,
      },
    });

    return NextResponse.json({
      ok: true,
      message: 'All notifications marked as read',
      data: { updatedCount: result.count },
    });
  } catch (error) {
    console.error('PUT /api/notifications/mark-all-as-read error:', error);
    return NextResponse.json({ ok: false, message: 'Internal Server Error' }, { status: 500 });
  }
}
