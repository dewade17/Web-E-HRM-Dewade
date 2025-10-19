export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { parseDateTimeToUTC } from '@/helpers/date-helper';

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

const RECIPIENT_ROLE_VALUES = new Set(['HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN']);
const REPORT_STATUS_VALUES = new Set(['terkirim', 'disetujui', 'ditolak']);
const RECIPIENT_FIELD_NAMES = ['recipients', 'report_recipients', 'kunjungan_report_recipients'];

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

function parseRecipientsValue(value, fieldName) {
  if (value === undefined) return null;

  let parsed = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      const error = new Error(`Field '${fieldName}' harus berupa JSON array yang valid.`);
      error.status = 400;
      throw error;
    }
  }

  if (!Array.isArray(parsed)) {
    const error = new Error(`Field '${fieldName}' harus berupa array.`);
    error.status = 400;
    throw error;
  }

  const sanitized = [];
  const seenUserIds = new Set();
  parsed.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      const error = new Error(`Item ke-${index + 1} pada field '${fieldName}' harus berupa objek.`);
      error.status = 400;
      throw error;
    }

    const idCandidate = item.id_user ?? item.idUser ?? item.user_id ?? item.userId ?? item.recipient_id ?? item.recipientId;
    const idUser = typeof idCandidate === 'string' || typeof idCandidate === 'number' ? String(idCandidate).trim() : '';
    if (!idUser) {
      const error = new Error(`Item ke-${index + 1} pada field '${fieldName}' harus memiliki 'id_user' yang valid.`);
      error.status = 400;
      throw error;
    }
    if (seenUserIds.has(idUser)) {
      const error = new Error(`Field '${fieldName}' tidak boleh berisi penerima duplikat (id_user: ${idUser}).`);
      error.status = 400;
      throw error;
    }
    seenUserIds.add(idUser);
    const namaCandidate = item.recipient_nama_snapshot ?? item.nama ?? item.name ?? item.recipientNama ?? item.recipientName ?? item.recipientNamaSnapshot ?? item.recipientNameSnapshot ?? item.recipient_name_snapshot;
    const recipientName = typeof namaCandidate === 'string' ? namaCandidate.trim() : '';
    if (!recipientName) {
      const error = new Error(`Item ke-${index + 1} pada field '${fieldName}' harus memiliki 'recipient_nama_snapshot' yang valid.`);
      error.status = 400;
      throw error;
    }

    let roleCandidate = item.recipient_role_snapshot ?? item.role ?? item.role_snapshot ?? item.roleSnapshot ?? item.recipientRole ?? item.recipientRoleSnapshot;
    let roleValue = null;
    if (roleCandidate !== undefined && roleCandidate !== null && String(roleCandidate).trim()) {
      const normalizedRole = String(roleCandidate).trim().toUpperCase();
      if (!RECIPIENT_ROLE_VALUES.has(normalizedRole)) {
        const error = new Error(`Item ke-${index + 1} pada field '${fieldName}' memiliki 'recipient_role_snapshot' tidak valid.`);
        error.status = 400;
        throw error;
      }
      roleValue = normalizedRole;
    }

    let statusCandidate = item.status;
    let statusValue;
    if (statusCandidate === undefined || statusCandidate === null || String(statusCandidate).trim() === '') {
      statusValue = undefined;
    } else {
      const normalizedStatus = String(statusCandidate).trim().toLowerCase();
      if (!REPORT_STATUS_VALUES.has(normalizedStatus)) {
        const error = new Error(`Item ke-${index + 1} pada field '${fieldName}' memiliki 'status' tidak valid.`);
        error.status = 400;
        throw error;
      }
      statusValue = normalizedStatus;
    }

    let catatanValue = null;
    if (item.catatan !== undefined && item.catatan !== null) {
      const trimmedCatatan = String(item.catatan).trim();
      catatanValue = trimmedCatatan ? trimmedCatatan : null;
    }

    sanitized.push({
      id_user: idUser,
      recipient_role_snapshot: roleValue,
      recipient_nama_snapshot: recipientName,
      status: statusValue,
      catatan: catatanValue,
    });
  });

  return sanitized;
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
  'recipients',
  'report_recipients',
  'kunjungan_report_recipients',
]);
const coordinateFields = ['end_latitude', 'end_longitude'];

const recipientSelect = {
  id_kunjungan_report_recipient: true,
  id_user: true,
  recipient_role_snapshot: true,
  catatan: true,
  status: true,
  recipient_nama_snapshot: true,
  notified_at: true,
  read_at: true,
  acted_at: true,
  created_at: true,
  updated_at: true,
};

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
      // Kita hanya perlu select jam_checkin untuk durasi
      select: { id_kunjungan: true, jam_checkin: true },
    });

    if (!existing) {
      return NextResponse.json({ message: 'Kunjungan klien tidak ditemukan.' }, { status: 404 });
    }

    const data = {
      status_kunjungan: 'selesai', // Set status menjadi 'selesai'
    }; // Proses 'jam_checkout'

    if (hasOwn(body, 'jam_checkout')) {
      const value = body.jam_checkout;
      const parsed = parseDateTimeToUTC(value);
      if (!parsed) {
        return NextResponse.json({ message: "Field 'jam_checkout' tidak valid." }, { status: 400 });
      }

      // ✨ PERUBAHAN DI SINI: Hanya menggunakan jam_checkin
      const startTime = existing.jam_checkin;

      if (startTime && parsed < startTime) {
        return NextResponse.json({ message: "'jam_checkout' tidak boleh sebelum waktu check-in." }, { status: 400 });
      }
      data.jam_checkout = parsed; // Hitung durasi hanya jika waktu check-in dan check-out ada

      if (startTime) {
        data.duration = Math.round((parsed.getTime() - startTime.getTime()) / 1000); // Durasi dalam detik
      }
    } // Proses field lainnya

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
    } // Proses unggah file

    if (type === 'form') {
      const lampiranFile = findLampiranFile(body);
      if (lampiranFile) {
        const lampiranUrlValue = await uploadLampiranToSupabase(actorId, lampiranFile);
        data.lampiran_kunjungan_url = lampiranUrlValue;
      }
    } else if (hasOwn(body, 'lampiran_kunjungan_url')) {
      data.lampiran_kunjungan_url = body.lampiran_kunjungan_url;
    }
    let recipientsPayload = null;
    for (const field of RECIPIENT_FIELD_NAMES) {
      if (hasOwn(body, field)) {
        try {
          recipientsPayload = parseRecipientsValue(body[field], field);
        } catch (parseErr) {
          if (parseErr?.status) {
            return NextResponse.json({ message: parseErr.message }, { status: parseErr.status });
          }
          throw parseErr;
        }
        break;
      }
    }

    const updated = await db.$transaction(async (tx) => {
      const updatedVisit = await tx.kunjungan.update({
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
          reports: {
            where: { deleted_at: null },
            select: recipientSelect,
          },
        },
      });

      if (recipientsPayload !== null) {
        const keepUserIds = recipientsPayload.map((recipient) => recipient.id_user);
        const now = new Date();

        if (keepUserIds.length === 0) {
          await tx.kunjunganReportRecipient.updateMany({
            where: { id_kunjungan: id, deleted_at: null },
            data: { deleted_at: now },
          });
        } else {
          await tx.kunjunganReportRecipient.updateMany({
            where: {
              id_kunjungan: id,
              deleted_at: null,
              id_user: { notIn: keepUserIds },
            },
            data: { deleted_at: now },
          });
        }

        for (const recipient of recipientsPayload) {
          const createData = {
            id_kunjungan: id,
            id_user: recipient.id_user,
            recipient_nama_snapshot: recipient.recipient_nama_snapshot,
            recipient_role_snapshot: recipient.recipient_role_snapshot,
            catatan: recipient.catatan,
            status: recipient.status ?? 'terkirim',
          };

          const updateData = {
            recipient_nama_snapshot: recipient.recipient_nama_snapshot, ////ada update ini 
            recipient_role_snapshot: recipient.recipient_role_snapshot,
            catatan: recipient.catatan,
            deleted_at: null,
          };
          if (recipient.status) {
            updateData.status = recipient.status;
          }

          await tx.kunjunganReportRecipient.upsert({
            where: {
              id_kunjungan_id_user: { id_kunjungan: id, id_user: recipient.id_user },
            },
            create: createData,
            update: updateData,
          });
        }
      }

      if (recipientsPayload !== null) {
        const refreshed = await tx.kunjungan.findUnique({
          where: { id_kunjungan: id },
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
            reports: {
              where: { deleted_at: null },
              select: recipientSelect,
            },
          },
        });
        return refreshed ?? updatedVisit;
      }

      return updatedVisit;
    });

    return NextResponse.json({ message: 'Check-out kunjungan berhasil.', data: updated });
  } catch (err) {
    console.error('PUT /mobile/kunjungan-klien/[id]/submit-end-kunjungan error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}
