export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { parseDateOnlyToUTC, parseDateTimeToUTC } from '@/helpers/date-helper';
import { sendNotification } from '@/app/utils/services/notificationService';

const SUPABASE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? 'e-hrm';

// === RBAC helpers (DITAMBAHKAN) ===
const normRole = (r) =>
  String(r || '')
    .trim()
    .toUpperCase();
const canSeeAll = (role) => ['OPERASIONAL', 'HR', 'DIREKTUR'].includes(normRole(role));
const canManageAll = (role) => ['OPERASIONAL'].includes(normRole(role)); // hanya Operasional yang full manage

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

const coordinateFields = ['start_latitude', 'start_longitude', 'end_latitude', 'end_longitude'];

function formatDateDisplay(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('id-ID', { dateStyle: 'long' }).format(value instanceof Date ? value : new Date(value));
  } catch (err) {
    console.warn('Gagal memformat tanggal kunjungan (mobile detail):', err);
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
    console.warn('Gagal memformat waktu kunjungan (mobile detail):', err);
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
    const data = await db.kunjungan.findFirst({
      where: {
        id_kunjungan: id,
        deleted_at: null,
        ...(canSeeAll(role) ? {} : { id_user: actorId }), // HR/Direktur/Operasional boleh lihat semua
      },
      include: kunjunganInclude,
    });

    if (!data) {
      return NextResponse.json({ message: 'Kunjungan klien tidak ditemukan.' }, { status: 404 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    console.error('GET /mobile/kunjungan-klien/[id] error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function PUT(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  const role = auth.actor?.role;
  const canManage = canManageAll(role); // hanya Operasional boleh kelola semua

  if (!actorId) {
    return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
  }

  const { id } = params || {};
  if (!id) {
    return NextResponse.json({ message: "Parameter 'id' wajib diisi." }, { status: 400 });
  }

  let lampiranUrlValue;
  let lampiranUploadedFromFile = false;

  try {
    const existing = await db.kunjungan.findFirst({
      where: {
        id_kunjungan: id,
        deleted_at: null,
        ...(canManage ? {} : { id_user: actorId }),
      },
    });

    if (!existing) {
      return NextResponse.json({ message: 'Kunjungan klien tidak ditemukan.' }, { status: 404 });
    }

    const { type, body } = await parseRequestBody(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ message: 'Body tidak valid.' }, { status: 400 });
    }

    const data = {};

    if (hasOwn(body, 'id_master_data_kunjungan')) {
      const rawKategori = body.id_master_data_kunjungan;
      data.id_master_data_kunjungan = isNullLike(rawKategori) ? null : String(rawKategori).trim();
    }

    if (hasOwn(body, 'tanggal')) {
      const rawTanggal = body.tanggal;
      if (isNullLike(rawTanggal)) {
        data.tanggal = null;
      } else {
        const tanggal = parseDateOnlyToUTC(rawTanggal);
        if (!tanggal) {
          return NextResponse.json({ message: "Field 'tanggal' tidak valid." }, { status: 400 });
        }
        data.tanggal = tanggal;
      }
    }

    if (hasOwn(body, 'jam_mulai')) {
      if (isNullLike(body.jam_mulai)) {
        data.jam_mulai = null;
      } else {
        const jamMulai = parseDateTimeToUTC(body.jam_mulai);
        if (!jamMulai) return NextResponse.json({ message: "Field 'jam_mulai' tidak valid." }, { status: 400 });
        data.jam_mulai = jamMulai;
      }
    }

    if (hasOwn(body, 'jam_selesai')) {
      if (isNullLike(body.jam_selesai)) {
        data.jam_selesai = null;
      } else {
        const jamSelesai = parseDateTimeToUTC(body.jam_selesai);
        if (!jamSelesai) return NextResponse.json({ message: "Field 'jam_selesai' tidak valid." }, { status: 400 });
        data.jam_selesai = jamSelesai;
      }
    }

    if (hasOwn(body, 'deskripsi')) {
      data.deskripsi = isNullLike(body.deskripsi) ? null : String(body.deskripsi).trim() || null;
    }

    if (hasOwn(body, 'hand_over')) {
      data.hand_over = isNullLike(body.hand_over) ? null : String(body.hand_over).trim() || null;
    }

    for (const field of coordinateFields) {
      if (!hasOwn(body, field)) continue;
      const value = body[field];
      if (isNullLike(value)) {
        data[field] = null;
        continue;
      }
      const numberValue = Number(value);
      if (Number.isNaN(numberValue)) {
        return NextResponse.json({ message: 'Field ' + field + ' tidak valid.' }, { status: 400 });
      }
      data[field] = numberValue;
    }

    // Lampiran (form / url)
    let lampiranProvided = false;
    if (type === 'form') {
      const lampiranFile = findLampiranFile(body);
      if (lampiranFile) {
        lampiranUrlValue = await uploadLampiranToSupabase(actorId, lampiranFile);
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

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ message: 'Tidak ada perubahan yang diberikan.' }, { status: 400 });
    }

    const updated = await db.kunjungan.update({
      where: { id_kunjungan: id },
      data,
      include: kunjunganInclude,
    });

    const visitPresentation = extractVisitPresentation(updated);
    const kategoriLabel = updated.kategori?.kategori_kunjungan || '';
    const statusDisplay = formatStatusDisplay(updated.status_kunjungan);
    const scheduleParts = [];
    if (visitPresentation.tanggalDisplay) scheduleParts.push(visitPresentation.tanggalDisplay);
    if (visitPresentation.timeRangeDisplay) scheduleParts.push(`pukul ${visitPresentation.timeRangeDisplay}`);
    const scheduleText = scheduleParts.join(' ');

    const mobileTitle = 'Kunjungan Klien Diperbarui';
    const mobileBody = [
      `Anda baru saja memperbarui kunjungan${kategoriLabel ? ` ${kategoriLabel}` : ' klien'}.`,
      scheduleText ? `Jadwal kunjungan pada ${scheduleText}.` : '',
      statusDisplay ? `Status kunjungan sekarang: ${statusDisplay}.` : '',
    ]
      .filter(Boolean)
      .join(' ')
      .trim();

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
      pemberi_tugas: 'Aplikasi Mobile',
      title: mobileTitle,
      body: mobileBody,
      overrideTitle: mobileTitle,
      overrideBody: mobileBody,
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
      console.info('[NOTIF] (Mobile) Mengirim notifikasi CLIENT_VISIT_UPDATED untuk user %s dengan payload %o', updated.id_user, notificationPayload);
      await sendNotification('CLIENT_VISIT_UPDATED', updated.id_user, notificationPayload, notificationOptions);
      console.info('[NOTIF] (Mobile) Notifikasi CLIENT_VISIT_UPDATED selesai diproses untuk user %s', updated.id_user);
    } catch (notifErr) {
      console.error('[NOTIF] (Mobile) Gagal mengirim notifikasi CLIENT_VISIT_UPDATED untuk user %s: %o', updated.id_user, notifErr);
    }

    if (oldLampiranToDelete) {
      await deleteLampiranFromSupabase(oldLampiranToDelete).catch(() => {});
    }

    return NextResponse.json({ message: 'Kunjungan klien berhasil diperbarui.', data: updated });
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
    console.error('PUT /mobile/kunjungan-klien/[id] error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  const role = auth.actor?.role;
  const canManage = canManageAll(role); // hanya Operasional boleh hapus rencana orang lain

  if (!actorId) {
    return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
  }

  const { id } = params || {};
  if (!id) {
    return NextResponse.json({ message: "Parameter 'id' wajib diisi." }, { status: 400 });
  }

  try {
    const existing = await db.kunjungan.findFirst({
      where: {
        id_kunjungan: id,
        deleted_at: null,
        ...(canManage ? {} : { id_user: actorId }),
      },
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
    console.error('DELETE /mobile/kunjungan-klien/[id] error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}
