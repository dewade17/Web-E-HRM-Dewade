import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { ensureNotificationAuth } from '../_auth';

export async function GET(request) {
  const auth = await ensureNotificationAuth(request);
  if (auth instanceof NextResponse) return auth;

  const userId = auth.actor?.id;
  if (!userId) {
    return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);

    const rawDays = parseInt(searchParams.get('days') || '7', 10);
    const days = Number.isNaN(rawDays) ? 7 : Math.min(Math.max(rawDays, 1), 30);

    const now = new Date();
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const typesParam = (searchParams.get('types') || '').trim();
    const typeList = typesParam
      ? typesParam
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    const where = {
      id_user: userId,
      deleted_at: null,
      created_at: { gte: cutoff },
    };

    if (typeList.length > 0) {
      where.related_table = { in: typeList };
    }

    const notifications = await db.notification.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: 200,
    });

    // bentuk tetap: { data: [...] }
    return NextResponse.json({ data: notifications });
  } catch (error) {
    console.error('GET /api/notifications/recent error:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
