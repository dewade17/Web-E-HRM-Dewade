import prisma from '@/lib/prisma';
import { getMessaging } from 'firebase-admin/messaging';
import { adminApp, isAdminConfigured } from '@/app/utils/firebase/admin';

/** Ganti placeholder {var} di template */
function formatMessage(template, data) {
  if (!template) return '';
  let msg = template;
  for (const k in data || {}) {
    msg = msg.replace(new RegExp(`{${k}}`, 'g'), String(data[k]));
  }
  return msg;
}

/**
 * Kirim notifikasi ke seluruh device user.
 * @param {string} eventTrigger - Nama event, contoh: 'NEW_SHIFT_PUBLISHED'
 * @param {string} userId - ID user
 * @param {object} dynamicData - Data untuk template & payload
 * @param {object} opts - { dedupeKey?: string, collapseKey?: string, deeplink?: string }
 */
export async function sendNotification(eventTrigger, userId, dynamicData = {}, opts = {}) {
  if (!isAdminConfigured || !adminApp) {
    console.error('[NOTIF] Firebase Admin belum terkonfigurasi. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY');
    return;
  }

  const now = new Date();
  const dedupeKey = opts.dedupeKey || `${eventTrigger}:${userId}:${dynamicData?.id || now.getTime()}`;
  const collapseKey = opts.collapseKey || eventTrigger;
  const deeplink = opts.deeplink || dynamicData?.deeplink || '';

  // 1) Ambil device aktif + token valid
  const devices = await prisma.device.findMany({
    where: { id_user: userId, push_enabled: true, fcm_token: { not: null } },
    select: { id_device: true, fcm_token: true },
  });
  const tokens = devices.map((d) => d.fcm_token).filter(Boolean);
  if (!tokens.length) {
    console.info('[NOTIF] User %s tidak punya token aktif.', userId);
    return;
  }

  // 2) Ambil template
  const tpl = await prisma.notificationTemplate.findUnique({ where: { eventTrigger } });
  let title = 'Notifikasi';
  let body = 'Anda memiliki notifikasi baru.';
  if (tpl && tpl.isActive) {
    title = formatMessage(tpl.titleTemplate, dynamicData) || title;
    body = formatMessage(tpl.bodyTemplate, dynamicData) || body;
  } else {
    // Fallback minimal
    if (dynamicData?.title) title = dynamicData.title;
    if (dynamicData?.body) body = dynamicData.body;
  }

  // 3) Persist ke tabel Notification (sebagai inbox in-app)
  const notifRecord = await prisma.notification.create({
    data: {
      id_user: userId,
      title,
      body,
      data_json: JSON.stringify({ eventTrigger, dedupeKey, deeplink, dynamicData }),
      related_table: dynamicData?.related_table || null,
      related_id: dynamicData?.related_id || null,
      status: 'unread',
    },
  });

  // 4) Susun pesan FCM
  const dataPayload = {
    title,
    body,
    eventTrigger,
    dedupeKey,
    deeplink,
    notificationId: notifRecord.id_notification,
    ts: String(now.getTime()),
  };

  const message = {
    tokens,
    data: dataPayload, // ← data-only; biar client handle tampilannya (Flutter/web)
    android: {
      priority: 'high',
      collapseKey, // ← penting untuk menimpa pesan “seri” yang sama
      notification: { channelId: 'high_importance_channel' },
    },
    apns: {
      headers: { 'apns-priority': '10' },
      payload: {
        aps: { contentAvailable: true, mutableContent: true, sound: 'default' },
      },
    },
    webpush: {
      headers: { Urgency: 'high', TTL: '1800' },
      fcmOptions: { link: deeplink || '/' },
    },
  };

  // 5) Kirim & cleanup token invalid
  const resp = await getMessaging(adminApp).sendEachForMulticast(message);

  // Update metrik device + matikan token invalid
  const updates = [];
  resp.responses.forEach((r, idx) => {
    const token = tokens[idx];
    const device = devices[idx];
    if (r.success) {
      updates.push(
        prisma.device.update({
          where: { id_device: device.id_device },
          data: { last_push_at: now, failed_push_count: 0 },
        })
      );
    } else {
      const code = r.error?.code || '';
      // Token tidak valid, matikan
      if (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token')) {
        updates.push(
          prisma.device.update({
            where: { id_device: device.id_device },
            data: { push_enabled: false, failed_push_count: { increment: 1 } },
          })
        );
      } else {
        updates.push(
          prisma.device.update({
            where: { id_device: device.id_device },
            data: { failed_push_count: { increment: 1 } },
          })
        );
      }
      console.warn('[NOTIF] Gagal kirim ke token %s: %s', token, code);
    }
  });
  if (updates.length) await prisma.$transaction(updates);

  console.info('[NOTIF] %s → user %s | success=%d failure=%d', eventTrigger, userId, resp.successCount, resp.failureCount);
}
