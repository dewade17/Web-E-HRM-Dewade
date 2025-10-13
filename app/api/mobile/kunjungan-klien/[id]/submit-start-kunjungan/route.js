// ... (semua import dan fungsi helper tetap sama)
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { parseDateTimeToUTC } from '@/helpers/date-helper';
import { sendStartKunjunganMessage, sendStartKunjunganImage } from '@/app/utils/watzap/watzap.js';

const SUPABASE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? 'e-hrm';

// (Salin semua fungsi helper: ensureAuth, hasOwn, isFile, findLampiranFile, getSupabase, sanitizePathPart, uploadLampiranToSupabase, parseRequestBody)

async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const payload = verifyAuthToken(auth.slice(7));
      const id = payload?.sub || payload?.id_user || payload?.userId;
      if (id) {
        return {
          actor: { id, role: payload?.role, source: 'bearer' },
        };
      }
    } catch (_) {
      /* fallback ke NextAuth */
    }
  }
  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;
  const id = sessionOrRes?.user?.id || sessionOrRes?.user?.id_user;
  if (!id) {
    return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
  }
  return {
    actor: { id, role: sessionOrRes?.user?.role, source: 'session' },
  };
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isFile(value) {
  return typeof File !== 'undefined' && value instanceof File;
}

function findLampiranFile(body) {
  const candidates = ['lampiran_kunjungan', 'lampiran', 'lampiran_file', 'lampiran_kunjungan_file', 'file'];
  for (const key of candidates) {
    if (isFile(body[key]) && body[key].size > 0) {
      return body[key];
    }
  }
  return null;
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env tidak lengkap.');
  return createClient(url, key);
}

function sanitizePathPart(part) {
  const safe = String(part || '').replace(/[^a-zA-Z0-9-_]/g, '_');
  return safe || 'unknown';
}

async function uploadLampiranToSupabase(userId, file) {
  if (!isFile(file)) return null;

  const allowedImageTypes = ['image/jpeg', 'image/png', 'image/jpg'];
  if (!allowedImageTypes.includes(file.type)) {
    throw new Error(`Tipe file tidak valid. Hanya .jpg dan .png yang diizinkan, tetapi file yang diterima adalah '${file.type}'.`);
  }

  const supabase = getSupabase();

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const extCandidate = (file.name?.split('.').pop() || '').toLowerCase();
  const ext = extCandidate && /^[a-z0-9]+$/.test(extCandidate) ? extCandidate : 'bin';
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  const safeUser = sanitizePathPart(userId);
  const filename = `${timestamp}-${random}.${ext}`;
  const path = `lampiran_kunjungan/${safeUser}/${filename}`;

  const { error: uploadError } = await supabase.storage.from(SUPABASE_BUCKET).upload(path, buffer, {
    upsert: true,
    contentType: file.type || 'application/octet-stream',
  });
  if (uploadError) {
    throw new Error(`Gagal upload lampiran: ${uploadError.message}`);
  }

  const { data: publicData } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(path);
  return publicData?.publicUrl || null;
}

async function parseRequestBody(req) {
  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const obj = {};
    for (const [key, value] of form.entries()) {
      obj[key] = value;
    }
    return { type: 'form', body: obj };
  }

  try {
    const body = await req.json();
    return { type: 'json', body };
  } catch (_) {
    const err = new Error('Body harus berupa JSON atau form-data.');
    err.status = 400;
    throw err;
  }
}

const allowedFields = new Set(['jam_checkin', 'start_latitude', 'start_longitude', 'lampiran_kunjungan', 'lampiran', 'lampiran_file', 'lampiran_kunjungan_file', 'file']);
const coordinateFields = ['start_latitude', 'start_longitude'];

export async function PUT(req, { params }) {
  try {
    const auth = await ensureAuth(req);
    if (auth instanceof NextResponse) return auth;
    const actorId = auth.actor?.id;
    if (!actorId) {
      return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
    }

    const { id } = params || {};
    if (!id) {
      return NextResponse.json({ message: "Parameter 'id' wajib diisi." }, { status: 400 });
    }

    const { type, body } = await parseRequestBody(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ message: 'Body tidak valid.' }, { status: 400 });
    }

    // ... (validasi field & logika data lainnya tetap sama)
    const unknownFields = Object.keys(body).filter((key) => !allowedFields.has(key));
    if (unknownFields.length > 0) {
      return NextResponse.json({ message: `Field ${unknownFields.join(', ')} tidak diizinkan.` }, { status: 400 });
    }

    const existing = await db.kunjungan.findFirst({
      where: { id_kunjungan: id, id_user: actorId, deleted_at: null },

      include: {
        user: {
          select: {
            nama_pengguna: true,
          },
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ message: 'Kunjungan klien tidak ditemukan.' }, { status: 404 });
    }

    const data = {
      status_kunjungan: 'berlangsung',
    };

    if (hasOwn(body, 'jam_checkin')) {
      const value = body.jam_checkin;
      const parsed = parseDateTimeToUTC(value);
      if (!parsed) {
        return NextResponse.json({ message: "Field 'jam_checkin' tidak valid." }, { status: 400 });
      }
      data.jam_checkin = parsed;
    }

    for (const field of coordinateFields) {
      if (hasOwn(body, field)) {
        const value = body[field];
        const numberValue = Number(value);
        if (!Number.isFinite(numberValue)) {
          return NextResponse.json({ message: `Field ${field} tidak valid.` }, { status: 400 });
        }
        data[field] = numberValue;
      }
    }

    if (type === 'form') {
      const lampiranFile = findLampiranFile(body);
      if (lampiranFile) {
        const lampiranUrlValue = await uploadLampiranToSupabase(actorId, lampiranFile);
        data.lampiran_kunjungan_url = lampiranUrlValue;
      }
    }

    if (Object.keys(data).length === 1 && data.status_kunjungan) {
      return NextResponse.json({ message: 'Tidak ada data check-in yang diberikan.' }, { status: 400 });
    }

    const updated = await db.kunjungan.update({
      where: { id_kunjungan: id },
      data,
      select: {
        id_kunjungan: true,
        jam_checkin: true,
        start_latitude: true,
        start_longitude: true,
        lampiran_kunjungan_url: true,
        status_kunjungan: true,
        updated_at: true,
      },
    });

    // --- PERUBAHAN UTAMA DI SINI ---

    // Kirim notifikasi di latar belakang tanpa menunggu (fire and forget)
    const deskripsi = (existing.deskripsi || '').trim() || 'Tidak ada deskripsi.';
    const namaPengguna = (existing.user?.nama_pengguna || '').trim() || 'Tidak diketahui';
    const lampiranUrl = updated.lampiran_kunjungan_url ?? data.lampiran_kunjungan_url ?? null;
    const messageLines = ['Check-in kunjungan dimulai.', `Nama Pengguna: ${namaPengguna}`, `Deskripsi: ${deskripsi}`, `Lampiran URL: ${lampiranUrl || '-'}`];
    const messageText = messageLines.join('\n');

    if (lampiranUrl) {
      // Hapus 'await' dan tambahkan .catch() untuk menangani error di latar belakang
      sendStartKunjunganImage(lampiranUrl, messageText).catch((err) => console.error('Gagal kirim notif gambar di latar belakang:', err));
    } else {
      const textMessage = `Check-in kunjungan dimulai.\n\nDeskripsi: ${deskripsi}\n(Tanpa lampiran)`;
      // Hapus 'await' dan tambahkan .catch()
      sendStartKunjunganMessage(messageText).catch((err) => console.error('Gagal kirim notif teks di latar belakang:', err));
    }

    // Langsung kembalikan respons ke pengguna agar tidak menunggu lama
    return NextResponse.json({ message: 'Check-in kunjungan berhasil diproses.', data: updated });
    // --- PERUBAHAN SELESAI ---
  } catch (err) {
    console.error('PUT /mobile/kunjungan-klien/[id]/submit-start-kunjungan error:', err);
    // Kita cek apakah error berasal dari validasi file kita
    if (err.message.includes('Tipe file tidak valid')) {
      return NextResponse.json({ message: err.message }, { status: 400 });
    }
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}
