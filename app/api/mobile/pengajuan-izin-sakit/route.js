export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { sendPengajuanIzinSakitEmailNotifications } from './_utils/emailNotifications';
import { uploadMediaWithFallback } from '@/app/api/_utils/uploadWithFallback';
import { parseRequestBody, findFileInBody, hasOwn } from '@/app/api/_utils/requestBody';
import { parseDateOnlyToUTC } from '@/helpers/date-helper';
import { sendIzinSakitMessage, sendIzinSakitImage } from '@/app/utils/watzap/watzap';

const APPROVE_STATUSES = new Set(['disetujui', 'ditolak', 'pending']);
const ADMIN_ROLES = new Set(['HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN', 'SUBADMIN', 'SUPERVISI']);

export const baseInclude = {
  user: {
    select: {
      id_user: true,
      nama_pengguna: true,
      email: true,
      role: true,
      foto_profil_user: true,
      id_departement: true,
      departement: {
        select: {
          id_departement: true,
          nama_departement: true,
        },
      },
      jabatan: {
        select: {
          id_jabatan: true,
          nama_jabatan: true,
        },
      },
    },
  },
  kategori: { select: { id_kategori_sakit: true, nama_kategori: true } },
  handover_users: {
    include: {
      user: {
        select: {
          id_user: true,
          nama_pengguna: true,
          email: true,
          role: true,
          foto_profil_user: true,
        },
      },
    },
  },
  approvals: {
    where: { deleted_at: null },
    orderBy: { level: 'asc' },
    select: {
      id_approval_izin_sakit: true,
      level: true,
      approver_user_id: true,
      approver_role: true,
      decision: true,
      decided_at: true,
      note: true,
      approver: {
        select: {
          id_user: true,
          nama_pengguna: true,
          email: true,
          role: true,
          foto_profil_user: true,
        },
      },
    },
  },
};

const normRole = (role) =>
  String(role || '')
    .trim()
    .toUpperCase();

const canManageAll = (role) => ADMIN_ROLES.has(normRole(role));

function isNullLike(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === '' || v === 'null' || v === 'undefined' || v === '-';
  }
  return false;
}

function normalizeStatusInput(raw) {
  if (raw === undefined || raw === null) return null;
  const v = String(raw).trim().toLowerCase();
  if (!v) return null;
  if (!APPROVE_STATUSES.has(v)) return null;
  return v;
}

function normalizeLongTextInput(value) {
  if (isNullLike(value)) return null;
  return String(value);
}

function normalizeLampiranInput(value) {
  if (isNullLike(value)) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function cleanHandoverFormat(text) {
  if (!text) return '-';
  return String(text).replace(/@\[(.*?)\]\((.*?)\)/g, (match, label, name) => {
    const cleanName = (name || label || '').replace(/^_+|_+$/g, '').trim();
    return `@${cleanName}`;
  });
}

function formatStatusDisplay(status) {
  const v = String(status || '')
    .trim()
    .toLowerCase();
  if (v === 'pending') return 'Menunggu';
  if (v === 'disetujui') return 'Disetujui';
  if (v === 'ditolak') return 'Ditolak';
  return v || '-';
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function dedupeStringList(values) {
  const set = new Set();
  for (const entry of asArray(values)) {
    if (entry === undefined || entry === null) continue;
    const s = String(entry).trim();
    if (!s) continue;
    set.add(s);
  }
  return Array.from(set);
}

async function validateTaggedUsers(userIds) {
  if (!userIds || !userIds.length) return;
  const uniqueIds = Array.from(new Set(userIds));
  const found = await db.user.findMany({
    where: { id_user: { in: uniqueIds }, deleted_at: null },
    select: { id_user: true },
  });
  if (found.length !== uniqueIds.length) {
    const missing = uniqueIds.filter((id) => !found.some((u) => u.id_user === id));
    throw NextResponse.json({ message: `User berikut tidak ditemukan: ${missing.join(', ')}` }, { status: 400 });
  }
}

export function normalizeApprovals(payload) {
  if (!payload) return null;
  let raw = payload.approvals ?? payload.approval ?? null;
  if (!raw) return null;

  // Jika input adalah string (hasil jsonEncode dari Flutter)
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      // Jika hasil parse adalah array, langsung kembalikan
      if (Array.isArray(parsed)) return parsed;
      // Jika hasil parse adalah satu objek, bungkus dalam array
      return [parsed];
    } catch { return null; }
  }

  // Jika input sudah berupa Array (dari parseRequestBody)
  if (Array.isArray(raw)) {
    return raw.map(item => {
      if (typeof item === 'string') {
        try { return JSON.parse(item); } catch { return item; }
      }
      return item;
    });
  }
  
  return null;
}

export function parseTagUserIds(body) {
  const raw = body?.tag_user_ids ?? body?.tagged_user_ids ?? body?.handover_user_ids ?? body?.handover_ids ?? body?.id_user_tagged;
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((v) => String(v).trim())
      .filter(Boolean);
  }
  return [];
}

export async function ensureAuth(req) {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || '';

  // 1) Bearer token dulu
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    try {
      const payload = verifyAuthToken(token);
      const id = payload?.sub || payload?.id_user || payload?.userId || payload?.id;
      const role = payload?.role;

      if (id) return { actor: { id: String(id), role }, authType: 'bearer' };
      // kalau id kosong, fallback session
    } catch {
      // fallback session di bawah
    }
  }

  // 2) Fallback ke NextAuth session
  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;

  const id = sessionOrRes?.user?.id || sessionOrRes?.user?.id_user;
  const role = sessionOrRes?.user?.role;

  if (!id) return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });

  return { actor: { id: String(id), role }, authType: 'session' };
}

export async function GET(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  const actorRole = auth.actor?.role;
  if (!actorId) return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10)));

    const statusParam = searchParams.get('status');
    const userIdParam = searchParams.get('id_user');
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');

    const where = { deleted_at: null };

    if (!canManageAll(actorRole)) {
      where.id_user = actorId;
    } else if (userIdParam) {
      where.id_user = userIdParam;
    }

    if (statusParam !== null && statusParam !== undefined && statusParam !== '') {
      const normalized = normalizeStatusInput(statusParam);
      if (!normalized) return NextResponse.json({ message: 'Parameter status tidak valid.' }, { status: 400 });
      where.status = normalized;
    }

    const and = [];
    if (fromParam || toParam) {
      const from = fromParam ? parseDateOnlyToUTC(fromParam) : null;
      const to = toParam ? parseDateOnlyToUTC(toParam) : null;

      if (fromParam && !from) return NextResponse.json({ message: 'Parameter from tidak valid (YYYY-MM-DD).' }, { status: 400 });
      if (toParam && !to) return NextResponse.json({ message: 'Parameter to tidak valid (YYYY-MM-DD).' }, { status: 400 });

      and.push({
        tanggal_pengajuan: {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
        },
      });
    }

    if (and.length) where.AND = and;

    const skip = (page - 1) * pageSize;

    const [total, rows] = await Promise.all([
      db.pengajuanIzinSakit.count({ where }),
      db.pengajuanIzinSakit.findMany({
        where,
        include: baseInclude,
        orderBy: { created_at: 'desc' },
        skip,
        take: pageSize,
      }),
    ]);

    return NextResponse.json({
      ok: true,
      data: rows,
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err) {
    console.error('GET /mobile/pengajuan-izin-sakit error:', err);
    return NextResponse.json({ ok: false, message: 'Server error.' }, { status: 500 });
  }
}

export async function POST(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  const actorRole = auth.actor?.role;
  if (!actorId) return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });

  try {
    const parsed = await parseRequestBody(req);
    const body = parsed.body || {};

    // 🔥 TAMBAHKAN LOG DI SINI
    console.log('------------------------------------------------');
    console.log('🚀 [DEBUG] POST Payload Received:');
    console.log(JSON.stringify(body, null, 2)); // Menampilkan body dalam format rapi
    
    // Jika ingin melihat apakah ada file yang terdeteksi
    const fileCheck = findFileInBody(parsed, ['lampiran', 'lampiran_izin_sakit', 'file', 'attachment']);
    if (fileCheck) {
        console.log('📂 [DEBUG] File detected:', fileCheck.name || 'Unnamed File', 'Size:', fileCheck.size);
    } else {
        console.log('📂 [DEBUG] No file uploaded.');
    }
    console.log('------------------------------------------------');
    // 🔥 AKHIR LOG

    const approvalsInput = normalizeApprovals(body) ?? [];

    const rawTanggalPengajuan = body.tanggal_pengajuan;
    let tanggalPengajuan;
    if (rawTanggalPengajuan === undefined) {
      tanggalPengajuan = undefined;
    } else if (isNullLike(rawTanggalPengajuan)) {
      tanggalPengajuan = null;
    } else {
      const parsedTanggal = parseDateOnlyToUTC(rawTanggalPengajuan);
      if (!parsedTanggal) {
        return NextResponse.json({ message: 'tanggal_pengajuan tidak valid (YYYY-MM-DD).' }, { status: 400 });
      }
      tanggalPengajuan = parsedTanggal;
    }

    const jenis_pengajuan = String(body.jenis_pengajuan || 'izin_sakit')
      .trim()
      .toLowerCase();

    const idUserRaw = body.id_user;
    const targetUserId = canManageAll(actorRole) && typeof idUserRaw === 'string' && idUserRaw.trim() ? idUserRaw.trim() : actorId;

    const kategoriId = String(body.id_kategori_sakit || '').trim();
    if (!kategoriId) return NextResponse.json({ message: 'id_kategori_sakit wajib diisi.' }, { status: 400 });

    const handover = normalizeLongTextInput(body.handover);

    const normalizedStatus = canManageAll(actorRole) ? normalizeStatusInput(body.status) || 'pending' : 'pending';

    const file = findFileInBody(body, ['lampiran', 'lampiran_izin_sakit', 'file', 'attachment']);

    let uploadMeta = null;
    let lampiranUrl = normalizeLampiranInput(body.lampiran_izin_sakit_url);

    if (file) {
      try {
        const uploaded = await uploadMediaWithFallback(file, {
          folder: 'izin-sakit',
          public: true,
        });

        lampiranUrl = uploaded.publicUrl || null;

        uploadMeta = {
          provider: uploaded.provider,
          publicUrl: uploaded.publicUrl || null,
          key: uploaded.key,
          etag: uploaded.etag,
          size: uploaded.size,
          bucket: uploaded.bucket,
          path: uploaded.path,
          fallbackFromStorageError: uploaded.errors?.storage || undefined,
        };
      } catch (e) {
        console.warn('POST /mobile/pengajuan-izin-sakit: upload failed:', e?.message || e);
      }
    }

    const tagUserIdsRaw = body.tag_user_ids ?? body.tagged_user_ids ?? body.handover_user_ids ?? body.handover_ids ?? body.id_user_tagged;

    let tagUserIds = [];
    if (Array.isArray(tagUserIdsRaw)) {
      tagUserIds = tagUserIdsRaw.map((v) => String(v).trim()).filter(Boolean);
    } else if (typeof tagUserIdsRaw === 'string') {
      tagUserIds = tagUserIdsRaw
        .split(',')
        .map((v) => String(v).trim())
        .filter(Boolean);
    }

    if (tagUserIds.length) {
      await validateTaggedUsers(tagUserIds);
    }

    const currentLevel = approvalsInput.length > 0 ? Math.min(...approvalsInput.map((a) => a.level).filter((v) => Number.isFinite(v))) : null;

    const result = await db.$transaction(async (tx) => {
      const created = await tx.pengajuanIzinSakit.create({
        data: {
          id_user: targetUserId,
          id_kategori_sakit: kategoriId,
          handover,
          lampiran_izin_sakit_url: lampiranUrl,
          status: normalizedStatus,
          current_level: currentLevel,
          jenis_pengajuan,
          ...(tanggalPengajuan !== undefined ? { tanggal_pengajuan: tanggalPengajuan } : {}),
        },
      });

      if (tagUserIds && tagUserIds.length) {
        await tx.handoverIzinSakit.createMany({
          data: tagUserIds.map((id) => ({
            id_pengajuan_izin_sakit: created.id_pengajuan_izin_sakit,
            id_user_tagged: id,
          })),
          skipDuplicates: true,
        });
      }

      if (approvalsInput && approvalsInput.length) {
        await tx.approvalIzinSakit.createMany({
          data: approvalsInput.map((approval) => ({
            id_pengajuan_izin_sakit: created.id_pengajuan_izin_sakit,
            level: approval.level,
            approver_user_id: approval.approver_user_id,
            approver_role: approval.approver_role,
            decision: 'pending',
          })),
        });
      }

      return tx.pengajuanIzinSakit.findUnique({
        where: { id_pengajuan_izin_sakit: created.id_pengajuan_izin_sakit },
        include: baseInclude,
      });
    });

    if (result) {
      const deeplink = `/pengajuan-izin-sakit/${result.id_pengajuan_izin_sakit}`;

      const cleanHandoverNote = cleanHandoverFormat(result.handover);

      const tanggalPengajuanDisplay = result.tanggal_pengajuan
        ? new Date(result.tanggal_pengajuan).toLocaleDateString('id-ID', {
            day: '2-digit',
            month: 'long',
            year: 'numeric',
          })
        : null;

      const basePayload = {
        nama_pemohon: result.user?.nama_pengguna || 'Rekan',
        kategori_sakit: result.kategori?.nama_kategori || '-',
        handover: cleanHandoverNote,
        catatan_handover: cleanHandoverNote,
        status: result.status || 'pending',
        status_display: formatStatusDisplay(result.status),
        current_level: result.current_level ?? null,
        lampiran_izin_sakit_url: result.lampiran_izin_sakit_url || null,
        related_table: 'pengajuan_izin_sakit',
        related_id: result.id_pengajuan_izin_sakit,
        deeplink,
        nama_penerima: 'Rekan',
        pesan_penerima: 'Pengajuan izin sakit baru telah dibuat.',
        tanggal_pengajuan: result.tanggal_pengajuan instanceof Date ? result.tanggal_pengajuan.toISOString().slice(0, 10) : null,
        tanggal_pengajuan_display: tanggalPengajuanDisplay,
      };

      const overrideTitle = `${basePayload.nama_pemohon} mengajukan izin sakit`;
      const overrideBody = tanggalPengajuanDisplay ? `Pengajuan izin sakit tanggal ${tanggalPengajuanDisplay} menunggu persetujuan.` : 'Pengajuan izin sakit menunggu persetujuan.';

      const whatsappPayloadLines = [
        '📌 *Pengajuan Izin Sakit Baru*',
        `👤 Pemohon: ${basePayload.nama_pemohon}`,
        `🏷️ Kategori: ${basePayload.kategori_sakit}`,
        basePayload.tanggal_pengajuan_display ? `📅 Tanggal: ${basePayload.tanggal_pengajuan_display}` : null,
        basePayload.handover && basePayload.handover !== '-' ? `🤝 Handover: ${basePayload.handover}` : null,
      ].filter(Boolean);

      const whatsappMessage = whatsappPayloadLines.join('\n');
      const finalLampiranUrl = result.lampiran_izin_sakit_url;

      try {
        if (finalLampiranUrl) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          await sendIzinSakitImage(finalLampiranUrl, whatsappMessage);
          console.log('[WA] Sukses mengirim notifikasi WhatsApp (dengan gambar) untuk pengajuan:', result.id_pengajuan_izin_sakit);
        } else {
          await sendIzinSakitMessage(whatsappMessage);
          console.log('[WA] Sukses mengirim notifikasi WhatsApp (teks) untuk pengajuan:', result.id_pengajuan_izin_sakit);
        }
      } catch (waError) {
        console.error('[WA] Gagal mengirim notifikasi WhatsApp:', waError);
      }

      try {
        await sendPengajuanIzinSakitEmailNotifications(req, result);
      } catch (emailErr) {
        console.warn('POST /mobile/pengajuan-izin-sakit: email notification failed:', emailErr?.message || emailErr);
      }
    }

    return NextResponse.json(
      {
        message: 'Pengajuan izin sakit berhasil dibuat.',
        data: result,
        upload: uploadMeta || undefined,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof NextResponse) return err;
    if (err?.code === 'P2003') {
      return NextResponse.json({ message: 'Data referensi tidak valid.' }, { status: 400 });
    }
    console.error('POST /mobile/pengajuan-izin-sakit error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function PUT(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  const actorRole = auth.actor?.role;
  if (!actorId) return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });

  try {
    const body = await req.json();
    const id = body.id_pengajuan_izin_sakit || body.id || body.id_pengajuan;

    if (!id) {
      return NextResponse.json({ message: 'id_pengajuan_izin_sakit wajib diisi.' }, { status: 400 });
    }

    const existing = await db.pengajuanIzinSakit.findFirst({
      where: { id_pengajuan_izin_sakit: id, deleted_at: null },
      select: { id_pengajuan_izin_sakit: true, id_user: true },
    });

    if (!existing) {
      return NextResponse.json({ message: 'Pengajuan tidak ditemukan.' }, { status: 404 });
    }

    if (!canManageAll(actorRole) && existing.id_user !== actorId) {
      return NextResponse.json({ message: 'Forbidden.' }, { status: 403 });
    }

    const updateData = {};

    if (hasOwn(body, 'id_kategori_sakit')) {
      const kategoriId = isNullLike(body.id_kategori_sakit) ? null : String(body.id_kategori_sakit).trim();
      if (!kategoriId) return NextResponse.json({ message: 'id_kategori_sakit tidak valid.' }, { status: 400 });
      updateData.id_kategori_sakit = kategoriId;
    }

    if (hasOwn(body, 'handover')) {
      updateData.handover = normalizeLongTextInput(body.handover);
    }

    if (hasOwn(body, 'tanggal_pengajuan')) {
      if (body.tanggal_pengajuan === undefined) {
      } else if (isNullLike(body.tanggal_pengajuan)) {
        updateData.tanggal_pengajuan = null;
      } else {
        const parsedTanggal = parseDateOnlyToUTC(body.tanggal_pengajuan);
        if (!parsedTanggal) {
          return NextResponse.json({ message: 'tanggal_pengajuan tidak valid (YYYY-MM-DD).' }, { status: 400 });
        }
        updateData.tanggal_pengajuan = parsedTanggal;
      }
    }

    if (canManageAll(actorRole) && hasOwn(body, 'status')) {
      const normalized = normalizeStatusInput(body.status);
      if (!normalized) return NextResponse.json({ message: 'status tidak valid.' }, { status: 400 });
      updateData.status = normalized;
    }

    if (hasOwn(body, 'jenis_pengajuan')) {
      const v = String(body.jenis_pengajuan || '')
        .trim()
        .toLowerCase();
      if (v) updateData.jenis_pengajuan = v;
    }

    const updated = await db.pengajuanIzinSakit.update({
      where: { id_pengajuan_izin_sakit: id },
      data: updateData,
      include: baseInclude,
    });

    return NextResponse.json({ ok: true, message: 'Pengajuan izin sakit berhasil diperbarui.', data: updated });
  } catch (err) {
    console.error('PUT /mobile/pengajuan-izin-sakit error:', err);
    return NextResponse.json({ ok: false, message: 'Server error.' }, { status: 500 });
  }
}

export async function DELETE(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  const actorRole = auth.actor?.role;
  if (!actorId) return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id_pengajuan_izin_sakit') || searchParams.get('id') || searchParams.get('id_pengajuan');

    if (!id) {
      return NextResponse.json({ message: 'id_pengajuan_izin_sakit wajib diisi.' }, { status: 400 });
    }

    const existing = await db.pengajuanIzinSakit.findFirst({
      where: { id_pengajuan_izin_sakit: id, deleted_at: null },
      select: { id_pengajuan_izin_sakit: true, id_user: true },
    });

    if (!existing) {
      return NextResponse.json({ message: 'Pengajuan tidak ditemukan.' }, { status: 404 });
    }

    if (!canManageAll(actorRole) && existing.id_user !== actorId) {
      return NextResponse.json({ message: 'Forbidden.' }, { status: 403 });
    }

    await db.pengajuanIzinSakit.update({
      where: { id_pengajuan_izin_sakit: id },
      data: { deleted_at: new Date() },
    });

    return NextResponse.json({ ok: true, message: 'Pengajuan izin sakit berhasil dihapus.' });
  } catch (err) {
    console.error('DELETE /mobile/pengajuan-izin-sakit error:', err);
    return NextResponse.json({ ok: false, message: 'Server error.' }, { status: 500 });
  }
}