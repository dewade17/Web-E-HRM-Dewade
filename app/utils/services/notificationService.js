import prisma from '@/lib/prisma';
import { getMessaging } from 'firebase-admin/messaging';
import { adminApp, isAdminConfigured } from '@/app/utils/firebase/admin';
/**
 * Mengganti placeholder di dalam string template dengan data dinamis.
 * @param {string} template - String template, cth: "Halo, {nama_karyawan}!"
 * @param {object} data - Objek berisi data dinamis, cth: { nama_karyawan: "Budi" }
 * @returns {string} - String yang sudah diformat.
 */
function formatMessage(template, data) {
  if (!template) return '';
  let message = template;
  for (const key in data) {
    message = message.replace(new RegExp(`{${key}}`, 'g'), data[key]);
  }
  return message;
}

/**
 * Service utama untuk mengirim notifikasi.
 * @param {string} eventTrigger - Kode unik pemicu dari tabel NotificationTemplate, cth: "SUCCESS_CHECK_IN".
 * @param {string} userId - ID pengguna yang akan menerima notifikasi.
 * @param {object} dynamicData - Objek berisi data untuk mengisi placeholder.
 */
export async function sendNotification(eventTrigger, userId, dynamicData) {
  try {
    if (!isAdminConfigured || !adminApp) {
      throw new Error('Firebase Admin SDK belum dikonfigurasi. Pastikan variabel lingkungan FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, dan FIREBASE_PRIVATE_KEY sudah diisi.');
    }

    // 1. Ambil template notifikasi dari database
    const template = await prisma.notificationTemplate.findUnique({
      where: { eventTrigger: eventTrigger },
    });

    let title, body;

    // --- PERBAIKAN: Gunakan fallback jika template tidak ada ---
    // Jika template dari DB ada dan aktif, gunakan itu.
    if (template && template.isActive) {
      console.log(`Menggunakan template kustom dari DB untuk [${eventTrigger}].`);
      title = formatMessage(template.titleTemplate, dynamicData);
      body = formatMessage(template.bodyTemplate, dynamicData);
    } else {
      // Jika tidak, gunakan pesan default sebagai cadangan.
      console.warn(`Template untuk [${eventTrigger}] tidak ditemukan atau tidak aktif. Menggunakan pesan default.`);

      // Anda bisa menambahkan lebih banyak kasus di sini
      switch (eventTrigger) {
        case 'NEW_AGENDA_ASSIGNED':
          title = `Tugas Baru: ${dynamicData.judul_agenda || 'Agenda Kerja'}`;
          body = `Anda mendapatkan tugas baru dari ${dynamicData.pemberi_tugas || 'atasan'}. Mohon diperiksa.`;
          break;
        case 'SHIFT_UPDATED':
          title = 'Jadwal Shift Diperbarui';
          body = `Jadwal shift Anda untuk tanggal ${dynamicData.tanggal_shift || ''} telah diperbarui.`;
          break;
        default:
          // Fallback paling umum jika event tidak dikenal
          title = 'Pemberitahuan Baru';
          body = 'Anda memiliki pembaruan baru di aplikasi E-HRM.';
          break;
      }
    }
    // --- AKHIR PERBAIKAN ---

    // 2. Simpan riwayat notifikasi ke database (tabel Notification)
    //    Langkah ini sekarang DIJAMIN berjalan.
    await prisma.notification.create({
      data: {
        id_user: userId,
        title: title,
        body: body,
        // (Opsional) data tambahan jika diperlukan di aplikasi mobile
        // data_json: JSON.stringify({ screen: 'AbsensiDetail', id: dynamicData.absensiId }),
      },
    });
    console.log(`Notifikasi untuk [${eventTrigger}] berhasil disimpan ke DB untuk user ${userId}.`);

    // 3. Ambil semua token FCM milik pengguna untuk dikirim
    const devices = await prisma.device.findMany({
      where: {
        id_user: userId,
        fcm_token: { not: null },
      },
    });

    const fcmTokens = devices.map((device) => device.fcm_token);

    if (fcmTokens.length === 0) {
      console.log(`Tidak ada token FCM yang ditemukan untuk user ID: ${userId}. Push notification tidak dikirim.`);
      return;
    }

    // 4. Kirim Push Notification menggunakan Firebase Admin SDK
    const message = {
      notification: {
        title: title,
        body: body,
      },
      tokens: fcmTokens,
      android: {
        notification: {
          sound: 'default',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
          },
        },
      },
    };

    const response = await getMessaging(adminApp).sendEachForMulticast(message);
    console.log(`Push notification [${eventTrigger}] berhasil dikirim ke user ${userId}. Response:`, response);
  } catch (error) {
    console.error(`Gagal mengirim notifikasi ${eventTrigger} untuk user ${userId}:`, error);
  }
}
