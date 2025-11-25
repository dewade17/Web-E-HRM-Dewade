import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { sendNotification } from '@/app/utils/services/notificationService';
import storageClient from '@/app/api/_utils/storageClient';
import { parseRequestBody, findFileInBody, hasOwn } from '@/app/api/_utils/requestBody';
import { parseDateOnlyToUTC } from '@/helpers/date-helper';
import { sendIzinSakitMessage, sendIzinSakitImage } from '@/app/utils/watzap/watzap';

const APPROVE_STATUSES = new Set(['disetujui', 'ditolak', 'pending']);
const ADMIN_ROLES = new Set(['HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN', 'SUBADMIN', 'SUPERVISI']);

const baseInclude = {
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

const formatStatusDisplay = (status) => {
  const s = String(status || 'pending').toLowerCase();
  if (s === 'disetujui') return 'Disetujui';
  if (s === 'ditolak') return 'Ditolak';
  return 'Pending';
};

const normRole = (role) =>
  String(role || '')
    .trim()
    .toUpperCase();
const canManageAll = (role) => ADMIN_ROLES.has(normRole(role));

function isNullLike(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') {
    const t = value.trim().toLowerCase();
    if (!t || t === 'null' || t === 'undefined') return true;
  }
  return false;
}

function normalizeLampiranInput(value) {
  if (value === undefined) return undefined;
  if (isNullLike(value)) return null;
  return String(value).trim();
}

function normalizeStatusInput(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim().toLowerCase();
  const mapped = s === 'menunggu' ? 'pending' : s;
  return APPROVE_STATUSES.has(mapped) ? mapped : null;
}

function cleanHandoverFormat(text) {
  if (!text) return '-';
  return text.replace(/@\[.*?\]\((.*?)\)/g, (match, name) => {
    const cleanName = name.replace(/^_+|_+$/g, '').trim();
    return `@${cleanName}`;
  });
}

async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const payload = verifyAuthToken(auth.slice(7));
      const id = payload?.sub || payload?.id_user || payload?.userId;
      if (id) return { actor: { id, role: payload?.role, source: 'bearer' } };
    } catch {}
  }
  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;
  const id = sessionOrRes?.user?.id || sessionOrRes?.user?.id_user;
  if (!id) return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
  return { actor: { id, role: sessionOrRes?.user?.role, source: 'session', session: sessionOrRes } };
}

function normalizeApprovals(payload) {
  if (!payload || typeof payload !== 'object') return undefined;
  const rawApprovals = payload.approvals ?? payload['approvals[]'] ?? payload.approval ?? payload['approval[]'];
  if (rawApprovals === undefined) return undefined;

  const entries = Array.isArray(rawApprovals) ? rawApprovals : [rawApprovals];
  const normalized = [];

  for (let entry of entries) {
    if (entry === undefined || entry === null) continue;
    if (typeof entry === 'string') {
      const t = entry.trim();
      if (!t) continue;
      try {
        entry = JSON.parse(t);
      } catch {
        throw NextResponse.json({ message: 'Format approvals tidak valid. Gunakan JSON array.' }, { status: 400 });
      }
    }
    if (!entry || typeof entry !== 'object') continue;

    const level = Number(entry.level ?? entry.order ?? entry.sequence ?? entry.seq);
    if (!Number.isFinite(level)) throw NextResponse.json({ message: 'Setiap approval harus memiliki level numerik.' }, { status: 400 });

    const idRaw = entry.id_approval_izin_sakit ?? entry.id ?? entry.approval_id ?? entry.approvalId ?? null;
    const approverUserRaw = entry.approver_user_id ?? entry.user_id ?? entry.id_user ?? entry.approverId ?? entry.userId;
    const approverRoleRaw = entry.approver_role ?? entry.role ?? entry.role_code ?? entry.roleCode;

    const approver_user_id = approverUserRaw == null ? null : String(approverUserRaw).trim();
    const approver_role = approverRoleRaw == null ? null : normRole(approverRoleRaw);

    if (!approver_user_id && !approver_role) continue;

    normalized.push({
      id: idRaw ? String(idRaw).trim() || null : null,
      level,
      approver_user_id: approver_user_id || null,
      approver_role: approver_role || null,
    });
  }

  normalized.sort((a, b) => a.level - b.level);
  return normalized;
}

function parseTagUserIds(raw) {
  if (raw === undefined) return undefined;
  if (raw === null) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const set = new Set();
  for (const v of arr) {
    const s = String(v || '').trim();
    if (s) set.add(s);
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
    const idUserFilter = searchParams.get('id_user');
    const q = searchParams.get('q');

    const where = { deleted_at: null };

    if (!canManageAll(actorRole)) where.id_user = actorId;
    else if (idUserFilter) where.id_user = String(idUserFilter).trim();

    if (statusParam !== null && statusParam !== undefined && String(statusParam).trim() !== '') {
      const normalized = normalizeStatusInput(statusParam);
      if (!normalized) return NextResponse.json({ message: 'Parameter status tidak valid.' }, { status: 400 });
      where.status = normalized;
    }

    const and = [];
    if (q) {
      const keyword = String(q).trim();
      if (keyword) {
        and.push({
          OR: [{ handover: { contains: keyword, mode: 'insensitive' } }, { kategori: { nama_kategori: { contains: keyword, mode: 'insensitive' } } }, { user: { nama_pengguna: { contains: keyword, mode: 'insensitive' } } }],
        });
      }
    }
    if (and.length) where.AND = and;

    const [total, items] = await Promise.all([
      db.pengajuanIzinSakit.count({ where }),
      db.pengajuanIzinSakit.findMany({
        where,
        orderBy: [{ created_at: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: baseInclude,
      }),
    ]);

    return NextResponse.json({
      message: 'Data pengajuan izin sakit berhasil diambil.',
      data: items,
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    console.error('GET /mobile/pengajuan-izin-sakit error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
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
    const approvalsInput = normalizeApprovals(body) ?? [];

    const rawTanggalPengajuan = body.tanggal_pengajuan;
    let tanggalPengajuan;
    if (rawTanggalPengajuan === undefined) {
      tanggalPengajuan = undefined;
    } else if (isNullLike(rawTanggalPengajuan)) {
      tanggalPengajuan = null;
    } else {
      const parsedTanggal = parseDateOnlyToUTC(rawTanggalPengajuan);
      if (!parsedTanggal) return NextResponse.json({ message: "Field 'tanggal_pengajuan' harus berupa tanggal valid (YYYY-MM-DD)." }, { status: 400 });
      tanggalPengajuan = parsedTanggal;
    }

    const kategoriIdRaw = body.id_kategori_sakit ?? body.id_kategori ?? body.kategori;
    const kategoriId = kategoriIdRaw ? String(kategoriIdRaw).trim() : '';
    if (!kategoriId) return NextResponse.json({ message: "Field 'id_kategori_sakit' wajib diisi." }, { status: 400 });

    const targetUserId = canManageAll(actorRole) && body.id_user ? String(body.id_user).trim() : actorId;
    if (!targetUserId) return NextResponse.json({ message: 'id_user tujuan tidak valid.' }, { status: 400 });

    const handover = isNullLike(body.handover) ? null : String(body.handover).trim();

    let uploadMeta = null;
    let lampiranUrl = null;
    const lampiranFile = findFileInBody(body, ['lampiran_izin_sakit', 'lampiran', 'lampiran_file', 'file', 'lampiran_izin']);

    if (lampiranFile) {
      try {
        const res = await storageClient.uploadBufferWithPresign(lampiranFile, { folder: 'pengajuan' });
        lampiranUrl = res.publicUrl || null;
        uploadMeta = { key: res.key, publicUrl: res.publicUrl, etag: res.etag, size: res.size };
      } catch (e) {
        return NextResponse.json({ message: 'Gagal mengunggah lampiran.', detail: e?.message || String(e) }, { status: 502 });
      }
    } else {
      const fallback = normalizeLampiranInput(body.lampiran_izin_sakit_url ?? body.lampiran_url ?? body.lampiran ?? body.lampiran_izin);
      lampiranUrl = fallback ?? null;
    }

    const normalizedStatus = normalizeStatusInput(body.status ?? 'pending');
    if (!normalizedStatus) return NextResponse.json({ message: 'status tidak valid.' }, { status: 400 });

    const currentLevel = body.current_level !== undefined ? Number(body.current_level) : null;
    if (currentLevel !== null && !Number.isFinite(currentLevel)) {
      return NextResponse.json({ message: 'current_level harus berupa angka.' }, { status: 400 });
    }

    const jenis_pengajuan = 'sakit';

    const tagUserIds = parseTagUserIds(body.tag_user_ids ?? body.handover_user_ids);
    await validateTaggedUsers(tagUserIds);

    const [targetUser, kategori] = await Promise.all([
      db.user.findFirst({ where: { id_user: targetUserId, deleted_at: null }, select: { id_user: true, nama_pengguna: true } }),
      db.kategoriSakit.findFirst({ where: { id_kategori_sakit: kategoriId, deleted_at: null }, select: { id_kategori_sakit: true, nama_kategori: true } }),
    ]);
    if (!targetUser) return NextResponse.json({ message: 'User tujuan tidak ditemukan.' }, { status: 404 });
    if (!kategori) return NextResponse.json({ message: 'Kategori sakit tidak ditemukan.' }, { status: 404 });

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
          data: tagUserIds.map((id) => ({ id_pengajuan_izin_sakit: created.id_pengajuan_izin_sakit, id_user_tagged: id })),
          skipDuplicates: true,
        });
      }

      if (approvalsInput.length) {
        await tx.approvalIzinSakit.createMany({
          data: approvalsInput.map((a) => ({
            id_pengajuan_izin_sakit: created.id_pengajuan_izin_sakit,
            level: a.level,
            approver_user_id: a.approver_user_id,
            approver_role: a.approver_role,
            decision: 'pending',
            decided_at: null,
            note: null,
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
      };

      const handoverTaggedNames = Array.isArray(result.handover_users)
        ? result.handover_users
            .map((h) => h?.user?.nama_pengguna)
            .filter((name) => typeof name === 'string' && name.trim())
            .map((name) => name.trim())
        : [];

      const whatsappPayloadLines = [
        '*Pengajuan Izin Sakit Baru*',
        `Pemohon: ${basePayload.nama_pemohon}`,
        `Kategori: ${basePayload.kategori_sakit}`,
        `Handover: ${basePayload.handover}`,
        `Handover Tag: ${handoverTaggedNames.length ? handoverTaggedNames.join(', ') : '-'}`,
      ];

      const whatsappMessage = whatsappPayloadLines.join('\n');
      const finalLampiranUrl = result.lampiran_izin_sakit_url;

      try {
        if (finalLampiranUrl) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          await sendIzinSakitImage(finalLampiranUrl, whatsappMessage);
        } else {
          await sendIzinSakitMessage(whatsappMessage);
        }
      } catch (waError) {
        console.error('[WA] Gagal mengirim notifikasi WhatsApp:', waError);
      }

      const notifiedUsers = new Set();
      const notifPromises = [];

      if (Array.isArray(result.handover_users)) {
        for (const h of result.handover_users) {
          const taggedId = h?.id_user_tagged;
          if (!taggedId || notifiedUsers.has(taggedId)) continue;
          notifiedUsers.add(taggedId);

          notifPromises.push(
            sendNotification(
              'IZIN_SAKIT_HANDOVER_TAGGED',
              taggedId,
              {
                ...basePayload,
                nama_penerima: h?.user?.nama_pengguna || 'Rekan',
                pesan_penerima: `Anda ditunjuk sebagai handover oleh ${basePayload.nama_pemohon}.`,
              },
              { deeplink }
            )
          );
        }
      }

      if (result.id_user && !notifiedUsers.has(result.id_user)) {
        notifPromises.push(
          sendNotification(
            'IZIN_SAKIT_HANDOVER_TAGGED',
            result.id_user,
            {
              ...basePayload,
              is_pemohon: true,
              nama_penerima: basePayload.nama_pemohon || 'Rekan',
              pesan_penerima: 'Pengajuan izin sakit Anda berhasil dikirim ke admin.',
            },
            { deeplink }
          )
        );
        notifiedUsers.add(result.id_user);
      }

      if (canManageAll(actorRole) && actorId && !notifiedUsers.has(actorId)) {
        notifPromises.push(
          sendNotification(
            'IZIN_SAKIT_HANDOVER_TAGGED',
            actorId,
            {
              ...basePayload,
              is_admin: true,
              nama_penerima: 'Admin',
              pesan_penerima: `Pengajuan izin sakit untuk ${basePayload.nama_pemohon} memerlukan tindak lanjut Anda.`,
            },
            { deeplink }
          )
        );
        notifiedUsers.add(actorId);
      }

      if (notifPromises.length) await Promise.allSettled(notifPromises);
    }

    return NextResponse.json({ message: 'Pengajuan izin sakit berhasil dibuat.', data: result, upload: uploadMeta || undefined }, { status: 201 });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    if (err?.code === 'P2003') return NextResponse.json({ message: 'Data referensi tidak valid.' }, { status: 400 });
    console.error('POST /mobile/pengajuan-izin-sakit error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}
export { ensureAuth, parseTagUserIds, baseInclude, normalizeApprovals };
