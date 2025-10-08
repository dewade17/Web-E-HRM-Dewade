import axios from 'axios';

// Konfigurasi dasar
const API_BASE_URL = 'https://api.watzap.id/v1';
const API_KEY = process.env.API_KEY_WATZAP;
const NUMBER_KEY = process.env.NUMBER_KEY_WATZAP;
const KUNJUNGAN_GROUP_ID = process.env.WATZAP_GROUP_ID_START_KUNJUNGAN;

// Instance axios
const client = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

function assertCredentials() {
  if (!API_KEY || !NUMBER_KEY) {
    throw new Error('Kredensial Watzap (API_KEY_WATZAP, NUMBER_KEY_WATZAP) tidak ditemukan di file .env');
  }
}

export function formatGroupId(id) {
  const core = String(id)
    .trim()
    .replace(/[^0-9\-]/g, '');
  return core.endsWith('@g.us') ? core : `${core}@g.us`;
}

// === FUNGSI GENERIK ===

export async function sendWhatsAppGroupMessage(groupId, message) {
  assertCredentials();
  const payload = {
    api_key: API_KEY,
    number_key: NUMBER_KEY,
    group_id: formatGroupId(groupId),
    message: message,
  };
  try {
    const { data } = await client.post('/send_message_group', payload);
    // Log untuk melihat respons sukses dari Watzap
    console.log('Respons Sukses dari Watzap (sendWhatsAppGroupMessage):', JSON.stringify(data, null, 2));
    return data;
  } catch (error) {
    // Log jika terjadi error saat pemanggilan API
    console.error('Error saat memanggil sendWhatsAppGroupMessage:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
    throw error; // Lemparkan lagi error agar bisa ditangkap oleh pemanggilnya (route.js)
  }
}

export async function sendWhatsAppGroupImage(groupId, imageUrl, message = '', sendAsSeparateMessage = false) {
  assertCredentials();
  const payload = {
    api_key: API_KEY,
    number_key: NUMBER_KEY,
    group_id: formatGroupId(groupId),
    url: imageUrl,
    message: message,
    separate_caption: sendAsSeparateMessage ? '1' : '0',
  };
  try {
    const { data } = await client.post('/send_image_group', payload);
    // Log untuk melihat respons sukses dari Watzap
    console.log('Respons Sukses dari Watzap (sendWhatsAppGroupImage):', JSON.stringify(data, null, 2));
    return data;
  } catch (error) {
    // Log jika terjadi error saat pemanggilan API
    console.error('Error saat memanggil sendWhatsAppGroupImage:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
    throw error; // Lemparkan lagi error
  }
}

// === FUNGSI SIMPEL (Untuk Notifikasi Kunjungan) ===

export async function sendStartKunjunganMessage(message) {
  if (!KUNJUNGAN_GROUP_ID) {
    return console.warn('WATZAP_GROUP_ID_START_KUNJUNGAN belum diatur; melewati notifikasi.');
  }
  return sendWhatsAppGroupMessage(KUNJUNGAN_GROUP_ID, message);
}

export async function sendStartKunjunganImage(imageUrl, message = '') {
  if (!KUNJUNGAN_GROUP_ID) {
    return console.warn('WATZAP_GROUP_ID_START_KUNJUNGAN belum diatur; melewati notifikasi.');
  }
  return sendWhatsAppGroupImage(KUNJUNGAN_GROUP_ID, imageUrl, message, false);
}
