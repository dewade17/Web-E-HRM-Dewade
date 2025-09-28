// watzap.js
import axios from 'axios';

const API_BASE = 'https://api.watzap.id/v1';

// ⚠️ Idealnya panggil dari server-side agar kunci tidak bocor ke client bundle.
const API_KEY = process.env.NEXT_PUBLIC_API_KEY_WATZAP;
const NUMBER_KEY = process.env.NEXT_PUBLIC_NUMBER_KEY_WATZAP;

const client = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
});

function assertCreds() {
  if (!API_KEY || !NUMBER_KEY) {
    throw new Error('Missing Watzap credentials: set NEXT_PUBLIC_API_KEY_WATZAP and NEXT_PUBLIC_NUMBER_KEY_WATZAP');
  }
}

// === Utils ===
export function formatPhoneNumber(phone) {
  const digits = String(phone)
    .trim()
    .replace(/[^0-9]/g, '');
  return digits.startsWith('0') ? '62' + digits.slice(1) : digits;
}

export function formatGroupId(id) {
  // Terima nama/tautan kasar lalu ambil angka & strip “@g.us” jika belum.
  const core = String(id)
    .trim()
    .replace(/[^0-9\-]/g, '');
  return core.endsWith('@g.us') ? core : `${core}@g.us`;
}

// === Personal chat ===
export async function sendWhatsAppMessage(phoneNo, message) {
  assertCreds();
  const payload = {
    api_key: API_KEY,
    number_key: NUMBER_KEY,
    phone_no: formatPhoneNumber(phoneNo),
    message,
    wait_until_send: '1',
  };
  const { data } = await client.post('/send_message', payload);
  return data;
}

export async function sendWhatsAppFile(phoneNo, fileUrl) {
  assertCreds();
  const payload = {
    api_key: API_KEY,
    number_key: NUMBER_KEY,
    phone_no: formatPhoneNumber(phoneNo),
    url: fileUrl,
    wait_until_send: '1',
  };
  const { data } = await client.post('/send_file_url', payload);
  return data;
}

// === Group chat ===
// Catatan endpoint:
// - Beberapa dokumen/akun menamai endpoint sebagai "/send_group_message" & "/send_group_file_url"
// - Yang lain tetap "/send_message" tapi ganti field ke group_id atau to=JID grup.
// Jika endpoint kamu berbeda, cukup ubah konstanta PATH_* di bawah ini.
const PATH_SEND_GROUP_MESSAGE = '/send_group_message';
const PATH_SEND_GROUP_FILE_URL = '/send_group_file_url';

export async function sendWhatsAppGroupMessage(groupIdOrJid, message) {
  assertCreds();
  const group_jid = formatGroupId(groupIdOrJid);

  // Payload versi umum untuk endpoint khusus group
  const payload = {
    api_key: API_KEY,
    number_key: NUMBER_KEY,
    group_id: group_jid, // jika dokumenmu memakai 'to' atau 'jid', ganti key ini
    message,
    wait_until_send: '1',
  };

  const { data } = await client.post(PATH_SEND_GROUP_MESSAGE, payload);
  return data;
}

export async function sendWhatsAppGroupFile(groupIdOrJid, fileUrl) {
  assertCreds();
  const group_jid = formatGroupId(groupIdOrJid);

  const payload = {
    api_key: API_KEY,
    number_key: NUMBER_KEY,
    group_id: group_jid, // ganti ke 'to' jika diperlukan
    url: fileUrl,
    wait_until_send: '1',
  };

  const { data } = await client.post(PATH_SEND_GROUP_FILE_URL, payload);
  return data;
}
