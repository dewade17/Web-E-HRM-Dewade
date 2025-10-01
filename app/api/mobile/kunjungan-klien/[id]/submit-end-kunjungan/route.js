export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';

const SUPABASE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? 'e-hrm';

// Helper-helper umum (disalin dari route lain untuk konsistensi)
async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const payload = verifyAuthToken(auth.slice(7));
      const id = payload?.sub || payload?.id_user || payload?.userId;
      if (id) {
        return {
          actor: {
            id,
            role: payload?.role,
            source: 'bearer',
          },
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
    actor: {
      id,
      role: sessionOrRes?.user?.role,
      source: 'session',
    },
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

// Mendefinisikan field yang diizinkan untuk endpoint ini
const allowedFields = new Set([
  'deskripsi',
  'jam_checkout',
  'end_latitude',
  'end_longitude',
  'id_kategori_kunjungan',
  // Nama field file
  'lampiran_kunjungan',
  'lampiran',
  'lampiran_file',
  'lampiran_kunjungan_file',
  'file',
]);
const coordinateFields = ['end_latitude', 'end_longitude'];

export async function PUT(req, { params }) {
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

  try {
    const { type, body } = await parseRequestBody(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ message: 'Body tidak valid.' }, { status: 400 });
    }

    const unknownFields = Object.keys(body).filter((key) => !allowedFields.has(key));
    if (unknownFields.length > 0) {
      return NextResponse.json({ message: `Field ${unknownFields.join(', ')} tidak diizinkan.` }, { status: 400 });
    }

    const existing = await db.kunjungan.findFirst({
      where: { id_kunjungan: id, id_user: actorId, deleted_at: null },
      select: { id_kunjungan: true, jam_checkin: true, jam_mulai: true },
    });

    if (!existing) {
      return NextResponse.json({ message: 'Kunjungan klien tidak ditemukan.' }, { status: 404 });
    }

    const data = {
      status_kunjungan: 'selesai', // Set status menjadi 'selesai'
    };

    // Proses 'jam_checkout'
    if (hasOwn(body, 'jam_checkout')) {
      const value = body.jam_checkout;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ message: "Field 'jam_checkout' tidak valid." }, { status: 400 });
      }
      const startTime = existing.jam_checkin || existing.jam_mulai;
      if (startTime && parsed < startTime) {
        return NextResponse.json({ message: "'jam_checkout' tidak boleh sebelum waktu mulai/check-in." }, { status: 400 });
      }
      data.jam_checkout = parsed;

      // Hitung durasi jika waktu mulai dan selesai ada
      if (startTime) {
        data.duration = Math.round((parsed.getTime() - startTime.getTime()) / 1000); // Durasi dalam detik
      }
    }

    // Proses field lainnya
    if (hasOwn(body, 'deskripsi')) data.deskripsi = String(body.deskripsi).trim();
    const kategoriId = body.id_kategori_kunjungan;
    if (kategoriId) data.id_kategori_kunjungan = String(kategoriId).trim();

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

    // Proses unggah file
    if (type === 'form') {
      const lampiranFile = findLampiranFile(body);
      if (lampiranFile) {
        const lampiranUrlValue = await uploadLampiranToSupabase(actorId, lampiranFile);
        data.lampiran_kunjungan_url = lampiranUrlValue;
      }
    } else if (hasOwn(body, 'lampiran_kunjungan_url')) {
      data.lampiran_kunjungan_url = body.lampiran_kunjungan_url;
    }

    const updated = await db.kunjungan.update({
      where: { id_kunjungan: id },
      data,
      select: {
        id_kunjungan: true,
        deskripsi: true,
        jam_checkout: true,
        end_latitude: true,
        end_longitude: true,
        lampiran_kunjungan_url: true,
        status_kunjungan: true,
        duration: true,
        updated_at: true,
      },
    });

    return NextResponse.json({ message: 'Check-out kunjungan berhasil.', data: updated });
  } catch (err) {
    console.error('PUT /mobile/kunjungan-klien/[id]/submit-end-kunjungan error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}
