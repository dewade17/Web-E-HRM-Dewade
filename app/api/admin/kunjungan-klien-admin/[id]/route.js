export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { parseDateOnlyToUTC, parseDateTimeToUTC } from '@/helpers/date-helper';
import { sendNotification } from '@/app/utils/services/notificationService';

const SUPABASE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? 'e-hrm';

const normRole = (r) =>
  String(r || '')
    .trim()
    .toUpperCase();
const canSeeAll = (role) => ['OPERASIONAL', 'HR', 'DIREKTUR'].includes(normRole(role));
const canManageAll = (role) => ['OPERASIONAL'].includes(normRole(role));

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

function guardOperational(actor) {
  if (actor?.role !== 'OPERASIONAL') {
    return NextResponse.json({ message: 'Forbidden: hanya role OPERASIONAL yang dapat mengakses resource ini.' }, { status: 403 });
  }
  return null;
}

const kunjunganInclude = {
  kategori: {
    select: {
      id_kategori_kunjungan: true,
      kategori_kunjungan: true,
    },
  },
  user: {
    select: {
      id_user: true,
      nama_pengguna: true,
      email: true,
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

function formatDateDisplay(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('id-ID', { dateStyle: 'long' }).format(value instanceof Date ? value : new Date(value));
  } catch (err) {
    console.warn('Gagal memformat tanggal kunjungan (admin detail):', err);
    return '';
  }
}

function formatTimeDisplay(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(value instanceof Date ? value : new Date(value));
  } catch (err) {
    console.warn('Gagal memformat waktu kunjungan (admin detail):', err);
    return '';
  }
}

function formatTimeRangeDisplay(start, end) {
  const startText = formatTimeDisplay(start);
  const endText = formatTimeDisplay(end);
  if (startText && endText) return `${startText} - ${endText}`;
  return startText || endText || '';
}

function formatStatusDisplay(status) {
  if (!status) return '';
  return String(status)
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function extractVisitPresentation(visit) {
  const tanggal = visit?.tanggal instanceof Date ? visit.tanggal : visit?.tanggal ? new Date(visit.tanggal) : null;
  const jamMulai = visit?.jam_mulai instanceof Date ? visit.jam_mulai : visit?.jam_mulai ? new Date(visit.jam_mulai) : null;
  const jamSelesai = visit?.jam_selesai instanceof Date ? visit.jam_selesai : visit?.jam_selesai ? new Date(visit.jam_selesai) : null;
  const tanggalDisplay = formatDateDisplay(tanggal);
  const jamMulaiDisplay = formatTimeDisplay(jamMulai);
  const jamSelesaiDisplay = formatTimeDisplay(jamSelesai);
  const timeRangeDisplay = formatTimeRangeDisplay(jamMulai, jamSelesai);
  return {
    tanggal,
    jamMulai,
    jamSelesai,
    tanggalDisplay,
    jamMulaiDisplay,
    jamSelesaiDisplay,
    timeRangeDisplay,
  };
}

const coordinateFields = ['start_latitude', 'start_longitude', 'end_latitude', 'end_longitude'];

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
  const candidates = [body.lampiran_kunjungan, body.lampiran, body.lampiran_file, body.lampiran_kunjungan_file, body.file];
  return candidates.find((candidate) => isFile(candidate) && candidate.size > 0) || null;
}
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env tidak lengkap.');
  return createClient(url, key);
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
    if (error) console.warn('Gagal hapus lampiran lama:', error.message);
  } catch (err) {
    console.warn('Gagal hapus lampiran lama:', err?.message || err);
  }
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
  if (uploadError) throw new Error(`Gagal upload lampiran: ${uploadError.message}`);

  const { data: publicData, error: publicError } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(path);
  if (publicError) throw new Error(`Gagal membuat URL lampiran: ${publicError.message}`);

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

export async function GET(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;
  const forbidden = guardOperational(auth.actor);
  if (forbidden) return forbidden;

  const actorId = auth.actor?.id;
  const role = auth.actor?.role;

  if (!actorId) {
    return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
  }

  const { id } = params || {};
  if (!id) {
    return NextResponse.json({ message: "Parameter 'id' wajib diisi." }, { status: 400 });
  }

  try {
    const filters = [{ id_kunjungan: id }, { deleted_at: null }];
    if (!canSeeAll(role)) {
      filters.push({ id_user: actorId });
    }

    const kunjungan = await db.kunjungan.findFirst({
      where: { AND: filters },
      include: kunjunganInclude,
    });

    if (!kunjungan) {
      return NextResponse.json({ message: 'Kunjungan tidak ditemukan.' }, { status: 404 });
    }

    return NextResponse.json({ data: kunjungan });
  } catch (err) {
    console.error('GET /admin/kunjungan-klien/[id] error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function PUT(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;
  const forbidden = guardOperational(auth.actor);
  if (forbidden) return forbidden;

  const actorId = auth.actor?.id;
  const role = auth.actor?.role;

  if (!actorId) {
    return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
  }

  const { id } = params || {};
  if (!id) {
    return NextResponse.json({ message: "Parameter 'id' wajib diisi." }, { status: 400 });
  }

  try {
    const existing = await db.kunjungan.findUnique({ where: { id_kunjungan: id } });
    if (!existing || existing.deleted_at) {
      return NextResponse.json({ message: 'Kunjungan tidak ditemukan.' }, { status: 404 });
    }

    if (!canManageAll(role) && existing.id_user !== actorId) {
      return NextResponse.json({ message: 'Forbidden.' }, { status: 403 });
    }

    const { body, type } = await parseRequestBody(req);

    const updates = {};
    const errors = [];

    if (hasOwn(body, 'id_kategori_kunjungan')) {
      if (isNullLike(body.id_kategori_kunjungan)) {
        errors.push("Field 'id_kategori_kunjungan' tidak boleh kosong.");
      } else {
        updates.id_kategori_kunjungan = String(body.id_kategori_kunjungan).trim();
      }
    }

    if (hasOwn(body, 'deskripsi')) {
      updates.deskripsi = isNullLike(body.deskripsi) ? null : String(body.deskripsi).trim();
    }

    if (hasOwn(body, 'hand_over')) {
      updates.hand_over = isNullLike(body.hand_over) ? null : String(body.hand_over).trim();
    }

    if (hasOwn(body, 'tanggal')) {
      if (isNullLike(body.tanggal)) {
        errors.push("Field 'tanggal' tidak boleh kosong.");
      } else {
        const parsed = parseDateOnlyToUTC(body.tanggal);
        if (!parsed) {
          errors.push("Field 'tanggal' tidak valid.");
        } else {
          updates.tanggal = parsed;
        }
      }
    }

    if (hasOwn(body, 'jam_mulai')) {
      if (isNullLike(body.jam_mulai)) {
        updates.jam_mulai = null;
      } else {
        const parsed = parseDateTimeToUTC(body.jam_mulai);
        if (!parsed) {
          errors.push("Field 'jam_mulai' tidak valid.");
        } else {
          updates.jam_mulai = parsed;
        }
      }
    }

    if (hasOwn(body, 'jam_selesai')) {
      if (isNullLike(body.jam_selesai)) {
        updates.jam_selesai = null;
      } else {
        const parsed = parseDateTimeToUTC(body.jam_selesai);
        if (!parsed) {
          errors.push("Field 'jam_selesai' tidak valid.");
        } else {
          updates.jam_selesai = parsed;
        }
      }
    }

    if (hasOwn(body, 'status_kunjungan')) {
      const allowedStatuses = new Set(['diproses', 'berlangsung', 'selesai', 'batal']);
      const status = String(body.status_kunjungan || '')
        .trim()
        .toLowerCase();
      if (!allowedStatuses.has(status)) {
        errors.push("Field 'status_kunjungan' tidak valid.");
      } else {
        updates.status_kunjungan = status;
      }
    }

    for (const field of coordinateFields) {
      if (hasOwn(body, field)) {
        const value = body[field];
        if (isNullLike(value)) {
          updates[field] = null;
        } else {
          const numberValue = Number(value);
          if (Number.isFinite(numberValue)) {
            updates[field] = numberValue;
          } else {
            errors.push(`Field '${field}' harus berupa angka.`);
          }
        }
      }
    }

    if (errors.length) {
      return NextResponse.json({ message: errors.join(' ') }, { status: 400 });
    }

    if (type === 'form') {
      const file = findLampiranFile(body);
      if (file) {
        if (existing.lampiran_kunjungan) {
          await deleteLampiranFromSupabase(existing.lampiran_kunjungan);
        }
        updates.lampiran_kunjungan = await uploadLampiranToSupabase(existing.id_user, file);
      } else if (hasOwn(body, 'lampiran_kunjungan') && isNullLike(body.lampiran_kunjungan)) {
        if (existing.lampiran_kunjungan) {
          await deleteLampiranFromSupabase(existing.lampiran_kunjungan);
        }
        updates.lampiran_kunjungan = null;
      }
    } else if (hasOwn(body, 'lampiran_kunjungan')) {
      if (isNullLike(body.lampiran_kunjungan)) {
        if (existing.lampiran_kunjungan) {
          await deleteLampiranFromSupabase(existing.lampiran_kunjungan);
        }
        updates.lampiran_kunjungan = null;
      } else if (typeof body.lampiran_kunjungan === 'string') {
        updates.lampiran_kunjungan = body.lampiran_kunjungan;
      }
    }

    if (!Object.keys(updates).length) {
      return NextResponse.json({ message: 'Tidak ada perubahan yang diterapkan.' }, { status: 400 });
    }

    const updated = await db.kunjungan.update({
      where: { id_kunjungan: id },
      data: updates,
      include: kunjunganInclude,
    });
    const visitPresentation = extractVisitPresentation(updated);
    const kategoriLabel = updated.kategori?.kategori_kunjungan || '';
    const statusDisplay = formatStatusDisplay(updated.status_kunjungan);
    const scheduleParts = [];
    if (visitPresentation.tanggalDisplay) scheduleParts.push(visitPresentation.tanggalDisplay);
    if (visitPresentation.timeRangeDisplay) scheduleParts.push(`pukul ${visitPresentation.timeRangeDisplay}`);
    const scheduleText = scheduleParts.join(' ');
    const notificationPayload = {
      nama_karyawan: updated.user?.nama_pengguna || 'Anda',
      kategori_kunjungan: kategoriLabel,
      tanggal_kunjungan: visitPresentation.tanggal ? visitPresentation.tanggal.toISOString() : null,
      tanggal_kunjungan_display: visitPresentation.tanggalDisplay,
      jam_mulai: visitPresentation.jamMulai ? visitPresentation.jamMulai.toISOString() : null,
      jam_mulai_display: visitPresentation.jamMulaiDisplay,
      jam_selesai: visitPresentation.jamSelesai ? visitPresentation.jamSelesai.toISOString() : null,
      jam_selesai_display: visitPresentation.jamSelesaiDisplay,
      rentang_waktu_display: visitPresentation.timeRangeDisplay,
      status_kunjungan: updated.status_kunjungan,
      status_kunjungan_display: statusDisplay,
      title: 'Kunjungan Klien Diperbarui',
      body: [`Detail kunjungan${kategoriLabel ? ` ${kategoriLabel}` : ' klien'}`, scheduleText ? `pada ${scheduleText}` : '', 'telah diperbarui.', statusDisplay ? `Status sekarang: ${statusDisplay}.` : '']
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
      related_table: 'kunjungan',
      related_id: updated.id_kunjungan,
      deeplink: `/kunjungan-klien/${updated.id_kunjungan}`,
    };
    const notificationOptions = {
      dedupeKey: `CLIENT_VISIT_UPDATED:${updated.id_kunjungan}`,
      collapseKey: `CLIENT_VISIT_${updated.id_kunjungan}`,
      deeplink: `/kunjungan-klien/${updated.id_kunjungan}`,
    };

    try {
      console.info('[NOTIF] (Admin) Mengirim notifikasi CLIENT_VISIT_UPDATED untuk user %s dengan payload %o', updated.id_user, notificationPayload);
      await sendNotification('CLIENT_VISIT_UPDATED', updated.id_user, notificationPayload, notificationOptions);
      console.info('[NOTIF] (Admin) Notifikasi CLIENT_VISIT_UPDATED selesai diproses untuk user %s', updated.id_user);
    } catch (notifErr) {
      console.error('[NOTIF] (Admin) Gagal mengirim notifikasi CLIENT_VISIT_UPDATED untuk user %s: %o', updated.id_user, notifErr);
    }

    return NextResponse.json({ message: 'Kunjungan diperbarui.', data: updated });
  } catch (err) {
    if (err?.status) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    if (err?.code === 'P2003') {
      return NextResponse.json({ message: 'Referensi kategori kunjungan tidak valid.' }, { status: 400 });
    }
    console.error('PUT /admin/kunjungan-klien/[id] error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;
  const forbidden = guardOperational(auth.actor);
  if (forbidden) return forbidden;

  const actorId = auth.actor?.id;
  const role = auth.actor?.role;

  if (!actorId) {
    return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
  }

  const { id } = params || {};
  if (!id) {
    return NextResponse.json({ message: "Parameter 'id' wajib diisi." }, { status: 400 });
  }

  try {
    const existing = await db.kunjungan.findUnique({ where: { id_kunjungan: id } });
    if (!existing || existing.deleted_at) {
      return NextResponse.json({ message: 'Kunjungan tidak ditemukan.' }, { status: 404 });
    }

    if (!canManageAll(role) && existing.id_user !== actorId) {
      return NextResponse.json({ message: 'Forbidden.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const hard = (searchParams.get('hard') || '').toLowerCase();

    if (hard === '1' || hard === 'true') {
      if (existing.lampiran_kunjungan) {
        await deleteLampiranFromSupabase(existing.lampiran_kunjungan);
      }
      await db.kunjungan.delete({ where: { id_kunjungan: id } });
      return NextResponse.json({ message: 'Kunjungan dihapus permanen.' });
    }

    await db.kunjungan.update({
      where: { id_kunjungan: id },
      data: { deleted_at: new Date() },
    });

    return NextResponse.json({ message: 'Kunjungan diarsipkan.' });
  } catch (err) {
    console.error('DELETE /admin/kunjungan-klien/[id] error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}
