import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { ensureNotificationAuth } from './_auth';

function sanitizeString(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str.length ? str : null;
}

// GET /api/notifications -> list dengan pagination
export async function GET(request) {
  const auth = await ensureNotificationAuth(request);
  if (auth instanceof NextResponse) return auth;

  const userId = auth.actor?.id;
  if (!userId) {
    return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10)));
    const status = (searchParams.get('status') || '').trim().toLowerCase();

    const where = { id_user: userId, deleted_at: null };

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

    // ⚠️ PENTING: bentuk response sama seperti versi lama
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
    console.error('GET /api/notifications error:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}

// POST /api/notifications -> register device token (FCM)
export async function POST(request) {
  const auth = await ensureNotificationAuth(request);
  if (auth instanceof NextResponse) return auth;

  const userId = auth.actor?.id;
  if (!userId) {
    return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
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
      where: { id_user: userId, fcm_token: fcmToken },
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
      record = await db.device.create({
        data: { id_user: userId, ...deviceData },
        select: selectFields,
      });
    }

    return NextResponse.json({
      ok: true,
      message: 'Device token registered',
      data: record,
    });
  } catch (error) {
    console.error('Failed to register notification token:', error);
    return NextResponse.json({ ok: false, message: 'Failed to register notification token' }, { status: 500 });
  }
}
