import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { parseDateTimeToUTC } from '@/helpers/date-helper';
import { sendWhatsAppGroupMessage, sendWhatsAppGroupFile } from '@/app/utils/watzap/watzap.js';

const SUPABASE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? 'e-hrm';

// ... (Fungsi helper ensureAuth, isFile, getSupabase, dll. perlu ditambahkan/disalin dari file route.js lainnya)

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

// 1. Perbarui field yang diizinkan
const allowedFields = new Set([
  'jam_checkin',
  'start_latitude',
  'start_longitude',
  // Nama field untuk file
  'lampiran_kunjungan',
  'lampiran',
  'lampiran_file',
  'lampiran_kunjungan_file',
  'file',
]);
const coordinateFields = ['start_latitude', 'start_longitude'];

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
    });

    if (!existing) {
      return NextResponse.json({ message: 'Kunjungan klien tidak ditemukan.' }, { status: 404 });
    }

    const data = {
      status_kunjungan: 'berlangsung', // 2. Set status menjadi 'berlangsung'
    };

    // Logika untuk jam_checkin
    if (hasOwn(body, 'jam_checkin')) {
      const value = body.jam_checkin;
      const parsed = parseDateTimeToUTC(value);
      if (!parsed) {
        return NextResponse.json({ message: "Field 'jam_checkin' tidak valid." }, { status: 400 });
      }
      data.jam_checkin = parsed;
    }

    // Logika untuk koordinat 'start'
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

    // 3. Logika untuk unggah file lampiran ke Supabase
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

    const groupJid = process.env.WATZAP_GROUP_ID_START_KUNJUNGAN;
    const deskripsi = (existing.deskripsi || '').trim() || 'Tidak ada deskripsi kunjungan.';
    const lampiranUrl = updated.lampiran_kunjungan_url ?? data.lampiran_kunjungan_url ?? null;
    const message = `Check-in kunjungan dimulai.
Deskripsi: ${deskripsi}
Lampiran: ${lampiranUrl || '-'}`;

    if (!groupJid) {
      console.warn('WATZAP_GROUP_ID_START_KUNJUNGAN belum diatur; melewati notifikasi grup Watzap.');
    } else {
      try {
        await sendWhatsAppGroupMessage(groupJid, message);
        if (lampiranUrl) {
          await sendWhatsAppGroupFile(groupJid, lampiranUrl);
        }
      } catch (notifyErr) {
        console.error('Gagal mengirim notifikasi Watzap untuk start kunjungan:', notifyErr);
      }
    }
    return NextResponse.json({ message: 'Check-in kunjungan berhasil.', data: updated });
  } catch (err) {
    console.error('PUT /mobile/kunjungan-klien/[id]/submit-start-kunjungan error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}
