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
      // Jika token bearer tidak valid, lanjut mencoba autentikasi session
      console.warn('Invalid bearer token for /api/notifications:', error);
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

function sanitizeString(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str.length ? str : null;
}
export async function GET(request) {
  const authResult = await resolveUserId(request);
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10)));
    const status = (searchParams.get('status') || '').trim().toLowerCase();

    const where = { id_user: userId };
    if (['read', 'unread', 'archived'].includes(status)) {
      where.status = status;
    }

    const [total, items] = await Promise.all([
      db.notification.count({ where }),
      db.notification.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return NextResponse.json({
      data: items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error('Failed to fetch notifications:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request) {
  const authResult = await resolveUserId(request);
  if (authResult instanceof NextResponse) return authResult;

  const { userId } = authResult;

  let payload;
  try {
    payload = await request.json();
  } catch (error) {
    return NextResponse.json({ ok: false, message: 'Invalid JSON body' }, { status: 400 });
  }

  const fcmToken = sanitizeString(payload?.token);
  const deviceIdentifier = sanitizeString(payload?.deviceIdentifier);

  if (!fcmToken) {
    return NextResponse.json({ ok: false, message: 'Field "token" is required' }, { status: 400 });
  }

  const now = new Date();

  const deviceData = {
    device_label: sanitizeString(payload?.deviceLabel),
    platform: sanitizeString(payload?.platform),
    os_version: sanitizeString(payload?.osVersion),
    app_version: sanitizeString(payload?.appVersion),
    fcm_token: fcmToken,
    fcm_token_updated_at: now,
    last_seen: now,
  };

  if (deviceIdentifier) {
    deviceData.device_identifier = deviceIdentifier;
  }

  try {
    const existing = await db.device.findFirst({
      where: {
        id_user: userId,
        fcm_token: fcmToken,
      },
    });

    const selectFields = {
      id_device: true,
      id_user: true,
      device_identifier: true,
      platform: true,
      os_version: true,
      app_version: true,
      fcm_token_updated_at: true,
      updated_at: true,
    };

    let record;

    if (existing) {
      console.info('Updating existing notification device', {
        userId,
        id_device: existing.id_device,
      });

      record = await db.device.update({
        where: { id_device: existing.id_device },
        data: {
          ...deviceData,
          push_enabled: true,
          failed_push_count: 0,
        },
        select: selectFields,
      });
    } else {
      console.info('Creating notification device', { userId });

      record = await db.device.create({
        data: {
          id_user: userId,
          ...deviceData,
        },
        select: selectFields,
      });
    }

    return NextResponse.json(
      {
        ok: true,
        message: 'Device token registered',
        data: record,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Failed to register notification token:', error);
    return NextResponse.json(
      {
        ok: false,
        message: 'Failed to register notification token',
      },
      { status: 500 }
    );
  }
}
