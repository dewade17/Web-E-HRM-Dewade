export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { parseDateOnlyToUTC, parseDateTimeToUTC } from '@/helpers/date-helper';

const SUPABASE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? 'e-hrm';

const STATUS_VALUES = new Set(['diproses', 'berlangsung', 'selesai']);
const RECIPIENT_ROLE_VALUES = new Set(['HR', 'OPERASIONAL', 'DIREKTUR']);
const REPORT_STATUS_VALUES = new Set(['terkirim', 'disetujui', 'ditolak']);
const RECIPIENT_FIELD_NAMES = ['recipients', 'report_recipients', 'kunjungan_report_recipients'];
const coordinateFields = ['start_latitude', 'start_longitude', 'end_latitude', 'end_longitude'];

const kunjunganInclude = {
  kategori: {
    select: {
      id_kategori_kunjungan: true,
      kategori_kunjungan: true,
    },
  },
  reports: {
    where: { deleted_at: null },
    select: {
      id_kunjungan_report_recipient: true,
      id_user: true,
      recipient_role_snapshot: true,
      recipient_nama_snapshot: true,
      catatan: true,
      status: true,
      notified_at: true,
      read_at: true,
      acted_at: true,
      created_at: true,
      updated_at: true,
    },
  },
};

async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const payload = verifyAuthToken(auth.slice(7));
      return {
        actor: {
          id: payload?.sub || payload?.id_user || payload?.userId,
          role: payload?.role,
          source: 'bearer',
        },
      };
    } catch (_) {
      /* fallback ke NextAuth */
    }
  }

  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;

  return {
    actor: {
      id: sessionOrRes.user.id,
      role: sessionOrRes.user.role,
      source: 'session',
    },
  };
}

function guardOperational(actor) {
  if (actor?.role !== 'OPERASIONAL') {
    return NextResponse.json({ message: 'Forbidden: hanya role OPERASIONAL yang dapat mengakses resource ini.' }, { status: 403 });
  }
  return null;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isNullLike(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return true;
    const lowered = trimmed.toLowerCase();
    if (lowered === 'null' || lowered === 'undefined') return true;
  }
  return false;
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

  const { data: publicData, error: publicError } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(path);
  if (publicError) {
    throw new Error(`Gagal membuat URL lampiran: ${publicError.message}`);
  }

  return publicData?.publicUrl || null;
}

function extractBucketPath(publicUrl) {
  if (!publicUrl) return null;
  try {
    const url = new URL(publicUrl);
    const match = url.pathname.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
    if (match) return { bucket: match[1], path: decodeURIComponent(match[2]) };
  } catch (_) {
    const fallback = String(publicUrl).match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
    if (fallback) return { bucket: fallback[1], path: decodeURIComponent(fallback[2]) };
  }
  return null;
}

async function deleteLampiranFromSupabase(publicUrl) {
  if (!publicUrl) return;
  const info = extractBucketPath(publicUrl);
  if (!info) return;
  try {
    const supabase = getSupabase();
    const { error } = await supabase.storage.from(info.bucket).remove([info.path]);
    if (error) {
      console.warn('Gagal hapus lampiran lama:', error.message);
    }
  } catch (err) {
    console.warn('Gagal hapus lampiran lama:', err?.message || err);
  }
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

function normalizeUserId(value) {
  if (value === undefined) return null;
  if (isNullLike(value)) return '';
  return String(value).trim();
}

export async function GET(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;
  const forbidden = guardOperational(auth.actor);
  if (forbidden) return forbidden;

  const { id } = params || {};
  if (!id) {
    return NextResponse.json({ message: "Parameter 'id' wajib diisi." }, { status: 400 });
  }

  try {
    const data = await db.kunjungan.findFirst({
      where: { id_kunjungan: id, deleted_at: null },
      include: kunjunganInclude,
    });

    if (!data) {
      return NextResponse.json({ message: 'Kunjungan klien tidak ditemukan.' }, { status: 404 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    console.error('GET /api/admin/kunjungan-klien/[id] error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function PUT(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;
  const forbidden = guardOperational(auth.actor);
  if (forbidden) return forbidden;

  const { id } = params || {};
  if (!id) {
    return NextResponse.json({ message: "Parameter 'id' wajib diisi." }, { status: 400 });
  }

  let lampiranUrlValue;
  let lampiranUploadedFromFile = false;

  try {
    const existing = await db.kunjungan.findFirst({
      where: { id_kunjungan: id, deleted_at: null },
    });

    if (!existing) {
      return NextResponse.json({ message: 'Kunjungan klien tidak ditemukan.' }, { status: 404 });
    }

    const { type, body } = await parseRequestBody(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ message: 'Body tidak valid.' }, { status: 400 });
    }

    const data = {};
    let targetUserId = existing.id_user;
    let effectiveJamCheckin = existing.jam_checkin;

    const userIdCandidate =
      (hasOwn(body, 'id_user') && body.id_user) ||
      (hasOwn(body, 'user_id') && body.user_id) ||
      (hasOwn(body, 'idUser') && body.idUser) ||
      (hasOwn(body, 'userId') && body.userId) ||
      (hasOwn(body, 'target_user_id') && body.target_user_id) ||
      (hasOwn(body, 'targetUserId') && body.targetUserId);
    if (userIdCandidate !== undefined) {
      const normalized = normalizeUserId(userIdCandidate);
      if (!normalized) {
        return NextResponse.json({ message: "Field 'id_user' tidak boleh kosong." }, { status: 400 });
      }
      data.id_user = normalized;
      targetUserId = normalized;
    }

    if (hasOwn(body, 'id_kategori_kunjungan') || hasOwn(body, 'kategori_id') || hasOwn(body, 'kategoriId')) {
      const rawKategori = body.id_kategori_kunjungan ?? body.kategori_id ?? body.kategoriId;
      if (isNullLike(rawKategori)) {
        data.id_kategori_kunjungan = null;
      } else {
        data.id_kategori_kunjungan = String(rawKategori).trim();
      }
    }

    if (hasOwn(body, 'tanggal')) {
      if (isNullLike(body.tanggal)) {
        data.tanggal = null;
      } else {
        const tanggalValue = parseDateOnlyToUTC(body.tanggal);
        if (!tanggalValue) {
          return NextResponse.json({ message: "Field 'tanggal' tidak valid." }, { status: 400 });
        }
        data.tanggal = tanggalValue;
      }
    }

    if (hasOwn(body, 'jam_mulai')) {
      if (isNullLike(body.jam_mulai)) {
        data.jam_mulai = null;
      } else {
        const jamMulai = parseDateTimeToUTC(body.jam_mulai);
        if (!jamMulai) {
          return NextResponse.json({ message: "Field 'jam_mulai' tidak valid." }, { status: 400 });
        }
        data.jam_mulai = jamMulai;
      }
    }

    if (hasOwn(body, 'jam_selesai')) {
      if (isNullLike(body.jam_selesai)) {
        data.jam_selesai = null;
      } else {
        const jamSelesai = parseDateTimeToUTC(body.jam_selesai);
        if (!jamSelesai) {
          return NextResponse.json({ message: "Field 'jam_selesai' tidak valid." }, { status: 400 });
        }
        data.jam_selesai = jamSelesai;
      }
    }

    if (hasOwn(body, 'jam_checkin')) {
      if (isNullLike(body.jam_checkin)) {
        data.jam_checkin = null;
        effectiveJamCheckin = null;
      } else {
        const jamCheckin = parseDateTimeToUTC(body.jam_checkin);
        if (!jamCheckin) {
          return NextResponse.json({ message: "Field 'jam_checkin' tidak valid." }, { status: 400 });
        }
        data.jam_checkin = jamCheckin;
        effectiveJamCheckin = jamCheckin;
      }
    }

    if (hasOwn(body, 'jam_checkout')) {
      if (isNullLike(body.jam_checkout)) {
        data.jam_checkout = null;
        data.duration = null;
      } else {
        const jamCheckout = parseDateTimeToUTC(body.jam_checkout);
        if (!jamCheckout) {
          return NextResponse.json({ message: "Field 'jam_checkout' tidak valid." }, { status: 400 });
        }
        data.jam_checkout = jamCheckout;
        const startTime = effectiveJamCheckin ?? existing.jam_checkin;
        if (startTime && jamCheckout) {
          const duration = Math.round((jamCheckout.getTime() - startTime.getTime()) / 1000);
          data.duration = duration >= 0 ? duration : 0;
        }
      }
    }

    if (hasOwn(body, 'deskripsi')) {
      if (isNullLike(body.deskripsi)) {
        data.deskripsi = null;
      } else {
        const str = String(body.deskripsi).trim();
        data.deskripsi = str.length > 0 ? str : null;
      }
    }

    if (hasOwn(body, 'hand_over')) {
      if (isNullLike(body.hand_over)) {
        data.hand_over = null;
      } else {
        const str = String(body.hand_over).trim();
        data.hand_over = str.length > 0 ? str : null;
      }
    }

    if (hasOwn(body, 'status_kunjungan') || hasOwn(body, 'status')) {
      const rawStatus = body.status_kunjungan ?? body.status;
      if (isNullLike(rawStatus)) {
        return NextResponse.json({ message: "Field 'status_kunjungan' tidak boleh kosong." }, { status: 400 });
      }
      const normalized = String(rawStatus).trim().toLowerCase();
      if (!STATUS_VALUES.has(normalized)) {
        return NextResponse.json({ message: "Field 'status_kunjungan' tidak valid." }, { status: 400 });
      }
      data.status_kunjungan = normalized;
    }

    for (const field of coordinateFields) {
      if (!hasOwn(body, field)) continue;
      const value = body[field];
      if (isNullLike(value)) {
        data[field] = null;
        continue;
      }
      const numberValue = Number(value);
      if (!Number.isFinite(numberValue)) {
        return NextResponse.json({ message: `Field '${field}' tidak valid.` }, { status: 400 });
      }
      data[field] = numberValue;
    }

    let lampiranProvided = false;
    if (type === 'form') {
      const lampiranFile = findLampiranFile(body);
      if (lampiranFile) {
        lampiranUrlValue = await uploadLampiranToSupabase(targetUserId, lampiranFile);
        lampiranUploadedFromFile = Boolean(lampiranUrlValue);
        lampiranProvided = true;
      }
    }

    if (!lampiranProvided && hasOwn(body, 'lampiran_kunjungan_url') && !isFile(body.lampiran_kunjungan_url)) {
      const rawLampiran = body.lampiran_kunjungan_url;
      lampiranUrlValue = isNullLike(rawLampiran) ? null : String(rawLampiran).trim();
      lampiranProvided = true;
    }

    let oldLampiranToDelete = null;
    if (lampiranProvided) {
      data.lampiran_kunjungan_url = lampiranUrlValue ?? null;
      const current = existing.lampiran_kunjungan_url;
      if (current && (lampiranUrlValue === null || lampiranUrlValue !== current)) {
        oldLampiranToDelete = current;
      }
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

    if (Object.keys(data).length === 0 && recipientsPayload === null) {
      return NextResponse.json({ message: 'Tidak ada perubahan yang diberikan.' }, { status: 400 });
    }

    const updated = await db.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        await tx.kunjungan.update({
          where: { id_kunjungan: id },
          data,
        });
      }

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
            recipient_nama_snapshot: recipient.recipient_nama_snapshot,
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

      return tx.kunjungan.findUnique({
        where: { id_kunjungan: id },
        include: kunjunganInclude,
      });
    });

    if (oldLampiranToDelete) {
      await deleteLampiranFromSupabase(oldLampiranToDelete).catch(() => {});
    }

    return NextResponse.json({ message: 'Kunjungan klien diperbarui.', data: updated });
  } catch (err) {
    if (lampiranUploadedFromFile && lampiranUrlValue) {
      await deleteLampiranFromSupabase(lampiranUrlValue).catch(() => {});
    }

    if (err?.status) {
      return NextResponse.json({ message: err.message || 'Body tidak valid.' }, { status: err.status });
    }

    if (err?.code === 'P2003') {
      return NextResponse.json({ message: 'Referensi data tidak valid.' }, { status: 400 });
    }

    console.error('PUT /api/admin/kunjungan-klien/[id] error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;
  const forbidden = guardOperational(auth.actor);
  if (forbidden) return forbidden;

  const { id } = params || {};
  if (!id) {
    return NextResponse.json({ message: "Parameter 'id' wajib diisi." }, { status: 400 });
  }

  try {
    const existing = await db.kunjungan.findFirst({
      where: { id_kunjungan: id, deleted_at: null },
    });

    if (!existing) {
      return NextResponse.json({ message: 'Kunjungan klien tidak ditemukan.' }, { status: 404 });
    }

    const now = new Date();
    await db.$transaction([
      db.kunjungan.update({
        where: { id_kunjungan: id },
        data: { deleted_at: now },
      }),
      db.kunjunganReportRecipient.updateMany({
        where: { id_kunjungan: id, deleted_at: null },
        data: { deleted_at: now },
      }),
    ]);

    return NextResponse.json({ message: 'Kunjungan klien dihapus.' });
  } catch (err) {
    console.error('DELETE /api/admin/kunjungan-klien/[id] error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}
