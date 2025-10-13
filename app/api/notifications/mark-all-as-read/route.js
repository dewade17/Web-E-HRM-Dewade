import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';

async function resolveUserId(request) {
  const authHeader = request.headers.get('authorization') || '';

  if (authHeader.startsWith('Bearer ')) {
    const rawToken = authHeader.slice(7).trim();
    try {
      const payload = verifyAuthToken(rawToken);
      const userId = payload?.id_user || payload?.sub || payload?.userId || payload?.id || payload?.user_id;

      if (userId) {
        return { userId, source: 'bearer' };
      }
    } catch (error) {
      console.warn('Invalid bearer token for /api/notifications/mark-all-read:', error);
    }
  }

  const sessionOrResponse = await authenticateRequest();
  if (sessionOrResponse instanceof NextResponse) {
    return sessionOrResponse;
  }

  const sessionUserId = sessionOrResponse?.user?.id || sessionOrResponse?.user?.id_user;
  if (!sessionUserId) {
    return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
  }

  return { userId: sessionUserId, source: 'session', session: sessionOrResponse };
}

export async function PUT(request) {
  const authResult = await resolveUserId(request);
  if (authResult instanceof NextResponse) return authResult;

  const { userId } = authResult;

  try {
    const now = new Date();

    const result = await db.notification.updateMany({
      where: {
        id_user: userId,
        status: 'unread',
        deleted_at: null,
      },
      data: {
        status: 'read',
        read_at: now,
        seen_at: now,
      },
    });

    return NextResponse.json({
      ok: true,
      message: 'All notifications marked as read',
      data: {
        updatedCount: result.count,
      },
    });
  } catch (error) {
    console.error('Failed to mark notifications as read:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
