import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { parseDateOnlyToUTC, parseDateTimeToUTC, startOfUTCDay, endOfUTCDay } from '@/helpers/date-helper';
import { sendNotification } from '@/app/utils/services/notificationService';
import storageClient from '@/app/api/_utils/storageClient';
import { parseRequestBody, findFileInBody, hasOwn } from '@/app/api/_utils/requestBody';

const APPROVE_STATUSES = new Set(['disetujui', 'ditolak', 'pending', 'menunggu']);
const ADMIN_ROLES = new Set(['HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN']);

const baseInclude = {
  user: {
    select: {
      id_user: true,
      nama_pengguna: true,
      email: true,
      role: true,
    },
  },
  kategori: {
    select: {
      id_kategori_izin_jam: true,
      nama_kategori: true,
    },
  },
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
};

const dateDisplayFormatter = new Intl.DateTimeFormat('id-ID', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

const timeDisplayFormatter = new Intl.DateTimeFormat('id-ID', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function formatDateISO(value) {
  if (!value) return '-';
  try {
    return value.toISOString().split('T')[0];
  } catch (err) {
    try {
      const asDate = new Date(value);
      if (Number.isNaN(asDate.getTime())) return '-';
      return asDate.toISOString().split('T')[0];
    } catch (_) {
      return '-';
    }
  }
}

function formatDateDisplay(value) {
  if (!value) return '-';
  try {
    return dateDisplayFormatter.format(value);
  } catch (err) {
    try {
      const asDate = new Date(value);
      if (Number.isNaN(asDate.getTime())) return '-';
      return dateDisplayFormatter.format(asDate);
    } catch (_) {
      return '-';
    }
  }
}

function formatTimeDisplay(value) {
  if (!value) return '-';
  try {
    return timeDisplayFormatter.format(value);
  } catch (err) {
    try {
      const asDate = new Date(value);
      if (Number.isNaN(asDate.getTime())) return '-';
      return timeDisplayFormatter.format(asDate);
    } catch (_) {
      return '-';
    }
  }
}

const normRole = (role) =>
  String(role || '')
    .trim()
    .toUpperCase();
const canManageAll = (role) => ADMIN_ROLES.has(normRole(role));

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

function normalizeLampiranInput(value) {
  if (value === undefined) return undefined;
  if (isNullLike(value)) return null;
  return String(value).trim();
}

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
      session: sessionOrRes,
    },
  };
}

function parseTagUserIds(raw) {
  if (raw === undefined) return undefined;
  if (raw === null) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const set = new Set();
  for (const value of arr) {
    const str = String(value || '').trim();
    if (str) set.add(str);
  }
  return Array.from(set);
}

function resolveJenisPengajuan(input, expected) {
  const fallback = expected;
  if (input === undefined || input === null) return { ok: true, value: fallback };

  const trimmed = String(input).trim();
  if (!trimmed) return { ok: true, value: fallback };

  const normalized = trimmed.toLowerCase().replace(/[-\s]+/g, '_');
  if (normalized !== expected) {
    return {
      ok: false,
      message: `jenis_pengajuan harus bernilai '${expected}'.`,
    };
  }

  return { ok: true, value: fallback };
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
  if (!actorId) {
    return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10)));

    const statusRaw = searchParams.get('status');
    const status = statusRaw ? String(statusRaw).trim().toLowerCase() : undefined;
    const idUserFilter = searchParams.get('id_user');
    const q = searchParams.get('q');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const tanggal = searchParams.get('tanggal');

    const where = { deleted_at: null };

    if (!canManageAll(actorRole)) {
      where.id_user = actorId;
    } else if (idUserFilter) {
      where.id_user = idUserFilter;
    }

    if (status && APPROVE_STATUSES.has(status)) {
      where.status = status;
    }

    const and = [];
    if (tanggal) {
      const parsed = parseDateOnlyToUTC(tanggal);
      if (parsed) {
        and.push({ tanggal_izin: { gte: startOfUTCDay(parsed), lte: endOfUTCDay(parsed) } });
      }
    } else {
      const parsedFrom = from ? parseDateOnlyToUTC(from) : null;
      const parsedTo = to ? parseDateOnlyToUTC(to) : null;
      if (parsedFrom || parsedTo) {
        and.push({
          tanggal_izin: {
            ...(parsedFrom ? { gte: startOfUTCDay(parsedFrom) } : {}),
            ...(parsedTo ? { lte: endOfUTCDay(parsedTo) } : {}),
          },
        });
      }
    }

    if (q) {
      const keyword = String(q).trim();
      if (keyword) {
        and.push({
          OR: [{ kategori: { nama_kategori: { contains: keyword } } }, { keperluan: { contains: keyword } }, { handover: { contains: keyword } }],
        });
      }
    }

    if (and.length) {
      where.AND = and;
    }

    const [total, items] = await Promise.all([
      db.pengajuanIzinJam.count({ where }),
      db.pengajuanIzinJam.findMany({
        where,
        orderBy: [{ tanggal_izin: 'desc' }, { created_at: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: baseInclude,
      }),
    ]);

    return NextResponse.json({
      ok: true,
      data: items,
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    console.error('GET /mobile/pengajuan-izin-jam error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function POST(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  const actorRole = auth.actor?.role;
  if (!actorId) {
    return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const parsed = await parseRequestBody(req);
    const body = parsed.body || {};

    const tanggalIzin = parseDateOnlyToUTC(body.tanggal_izin);
    if (!tanggalIzin) {
      return NextResponse.json({ message: "Field 'tanggal_izin' wajib diisi dan harus berupa tanggal yang valid." }, { status: 400 });
    }

    const jamMulai = parseDateTimeToUTC(body.jam_mulai);
    if (!jamMulai) {
      return NextResponse.json({ message: "Field 'jam_mulai' wajib diisi dan harus berupa waktu yang valid." }, { status: 400 });
    }

    const jamSelesai = parseDateTimeToUTC(body.jam_selesai);
    if (!jamSelesai) {
      return NextResponse.json({ message: "Field 'jam_selesai' wajib diisi dan harus berupa waktu yang valid." }, { status: 400 });
    }

    if (jamSelesai <= jamMulai) {
      return NextResponse.json({ message: 'jam_selesai harus lebih besar dari jam_mulai.' }, { status: 400 });
    }

    if (!Object.prototype.hasOwnProperty.call(body, 'id_kategori_izin_jam')) {
      return NextResponse.json({ message: "Field 'id_kategori_izin_jam' wajib diisi." }, { status: 400 });
    }

    const idKategoriIzinJam = String(body.id_kategori_izin_jam || '').trim();
    if (!idKategoriIzinJam) {
      return NextResponse.json({ message: "Field 'id_kategori_izin_jam' wajib diisi." }, { status: 400 });
    }

    const kategoriIzinJam = await db.kategoriIzinJam.findFirst({
      where: { id_kategori_izin_jam: idKategoriIzinJam, deleted_at: null },
      select: { id_kategori_izin_jam: true },
    });
    if (!kategoriIzinJam) {
      return NextResponse.json({ message: 'Kategori izin jam tidak ditemukan.' }, { status: 404 });
    }

    const targetUserId = canManageAll(actorRole) && body.id_user ? String(body.id_user).trim() : actorId;
    if (!targetUserId) {
      return NextResponse.json({ message: 'id_user tujuan tidak valid.' }, { status: 400 });
    }

    const keperluan = isNullLike(body.keperluan) ? null : String(body.keperluan).trim();
    const handover = isNullLike(body.handover) ? null : String(body.handover).trim();
    let uploadMeta = null;
    let lampiranUrl = null;
    const lampiranFile = findFileInBody(body, ['lampiran_izin_jam', 'lampiran', 'lampiran_file', 'file']);
    if (lampiranFile) {
      try {
        const res = await storageClient.uploadBufferWithPresign(lampiranFile, { folder: 'pengajuan' });
        lampiranUrl = res.publicUrl || null;
        uploadMeta = { key: res.key, publicUrl: res.publicUrl, etag: res.etag, size: res.size };
      } catch (e) {
        return NextResponse.json({ message: 'Gagal mengunggah lampiran.', detail: e?.message || String(e) }, { status: 502 });
      }
    } else {
      const fallback = normalizeLampiranInput(body.lampiran_izin_jam_url ?? body.lampiran_url ?? body.lampiran);
      lampiranUrl = fallback ?? null;
    }
    let tanggalPengganti = null;
    if (Object.prototype.hasOwnProperty.call(body, 'tanggal_pengganti')) {
      if (!isNullLike(body.tanggal_pengganti)) {
        const parsedTanggalPengganti = parseDateOnlyToUTC(body.tanggal_pengganti);
        if (!parsedTanggalPengganti) {
          return NextResponse.json({ message: "Field 'tanggal_pengganti' harus berupa tanggal yang valid ketika diisi." }, { status: 400 });
        }
        tanggalPengganti = parsedTanggalPengganti;
      }
    }

    let jamMulaiPengganti = null;
    if (Object.prototype.hasOwnProperty.call(body, 'jam_mulai_pengganti')) {
      if (!isNullLike(body.jam_mulai_pengganti)) {
        const parsedJamMulaiPengganti = parseDateTimeToUTC(body.jam_mulai_pengganti);
        if (!parsedJamMulaiPengganti) {
          return NextResponse.json({ message: "Field 'jam_mulai_pengganti' harus berupa waktu yang valid ketika diisi." }, { status: 400 });
        }
        jamMulaiPengganti = parsedJamMulaiPengganti;
      }
    }

    let jamSelesaiPengganti = null;
    if (Object.prototype.hasOwnProperty.call(body, 'jam_selesai_pengganti')) {
      if (!isNullLike(body.jam_selesai_pengganti)) {
        const parsedJamSelesaiPengganti = parseDateTimeToUTC(body.jam_selesai_pengganti);
        if (!parsedJamSelesaiPengganti) {
          return NextResponse.json({ message: "Field 'jam_selesai_pengganti' harus berupa waktu yang valid ketika diisi." }, { status: 400 });
        }
        jamSelesaiPengganti = parsedJamSelesaiPengganti;
      }
    }

    if (jamMulaiPengganti && jamSelesaiPengganti && jamSelesaiPengganti <= jamMulaiPengganti) {
      return NextResponse.json({ message: 'jam_selesai_pengganti harus lebih besar dari jam_mulai_pengganti.' }, { status: 400 });
    }

    const statusRaw = body.status ? String(body.status).trim().toLowerCase() : 'pending';
    if (statusRaw && !APPROVE_STATUSES.has(statusRaw)) {
      return NextResponse.json({ message: 'status tidak valid.' }, { status: 400 });
    }

    const currentLevel = body.current_level !== undefined ? Number(body.current_level) : null;
    if (currentLevel !== null && !Number.isFinite(currentLevel)) {
      return NextResponse.json({ message: 'current_level harus berupa angka.' }, { status: 400 });
    }

    const tagUserIds = parseTagUserIds(body.tag_user_ids);
    await validateTaggedUsers(tagUserIds);

    const jenisPengajuanResult = resolveJenisPengajuan(body.jenis_pengajuan, 'izin_jam');
    if (!jenisPengajuanResult.ok) {
      return NextResponse.json({ message: jenisPengajuanResult.message }, { status: 400 });
    }
    const jenis_pengajuan = jenisPengajuanResult.value;

    const targetUser = await db.user.findFirst({
      where: { id_user: targetUserId, deleted_at: null },
      select: { id_user: true },
    });
    if (!targetUser) {
      return NextResponse.json({ message: 'User tujuan tidak ditemukan.' }, { status: 404 });
    }

    const result = await db.$transaction(async (tx) => {
      const created = await tx.pengajuanIzinJam.create({
        data: {
          id_user: targetUserId,
          tanggal_izin: tanggalIzin,
          jam_mulai: jamMulai,
          jam_selesai: jamSelesai,
          tanggal_pengganti: tanggalPengganti,
          jam_mulai_pengganti: jamMulaiPengganti,
          jam_selesai_pengganti: jamSelesaiPengganti,
          id_kategori_izin_jam: idKategoriIzinJam,
          keperluan,
          handover,
          lampiran_izin_jam_url: lampiranUrl,
          status: statusRaw,
          current_level: currentLevel,
          jenis_pengajuan,
        },
      });

      if (tagUserIds && tagUserIds.length) {
        await tx.handoverIzinJam.createMany({
          data: tagUserIds.map((id) => ({
            id_pengajuan_izin_jam: created.id_pengajuan_izin_jam,
            id_user_tagged: id,
          })),
          skipDuplicates: true,
        });
      }

      return tx.pengajuanIzinJam.findUnique({
        where: { id_pengajuan_izin_jam: created.id_pengajuan_izin_jam },
        include: baseInclude,
      });
    });

    if (result) {
      const deeplink = `/pengajuan-izin-jam/${result.id_pengajuan_izin_jam}`;
      const waktuRentangDisplay = `${formatTimeDisplay(result.jam_mulai)} - ${formatTimeDisplay(result.jam_selesai)}`;
      const waktuRentangPenggantiDisplay = result.jam_mulai_pengganti && result.jam_selesai_pengganti ? `${formatTimeDisplay(result.jam_mulai_pengganti)} - ${formatTimeDisplay(result.jam_selesai_pengganti)}` : null;
      const basePayload = {
        nama_pemohon: result.user?.nama_pengguna || 'Rekan',
        kategori_izin: result.kategori?.nama_kategori || '-',
        id_kategori_izin_jam: result.id_kategori_izin_jam,
        tanggal_izin: formatDateISO(result.tanggal_izin),
        tanggal_izin_display: formatDateDisplay(result.tanggal_izin),
        jam_mulai: result.jam_mulai instanceof Date ? result.jam_mulai.toISOString() : null,
        jam_mulai_display: formatTimeDisplay(result.jam_mulai),
        jam_selesai: result.jam_selesai instanceof Date ? result.jam_selesai.toISOString() : null,
        jam_selesai_display: formatTimeDisplay(result.jam_selesai),
        rentang_waktu_display: waktuRentangDisplay,
        tanggal_pengganti: result.tanggal_pengganti ? formatDateISO(result.tanggal_pengganti) : null,
        tanggal_pengganti_display: result.tanggal_pengganti ? formatDateDisplay(result.tanggal_pengganti) : null,
        jam_mulai_pengganti: result.jam_mulai_pengganti instanceof Date ? result.jam_mulai_pengganti.toISOString() : null,
        jam_mulai_pengganti_display: result.jam_mulai_pengganti ? formatTimeDisplay(result.jam_mulai_pengganti) : null,
        jam_selesai_pengganti: result.jam_selesai_pengganti instanceof Date ? result.jam_selesai_pengganti.toISOString() : null,
        jam_selesai_pengganti_display: result.jam_selesai_pengganti ? formatTimeDisplay(result.jam_selesai_pengganti) : null,
        rentang_waktu_pengganti_display: waktuRentangPenggantiDisplay,
        keperluan: result.keperluan || '-',
        handover: result.handover || '-',
        related_table: 'pengajuan_izin_jam',
        related_id: result.id_pengajuan_izin_jam,
        deeplink,
      };

      const notifiedUsers = new Set();
      const notifPromises = [];

      if (Array.isArray(result.handover_users)) {
        for (const handoverUser of result.handover_users) {
          const taggedId = handoverUser?.id_user_tagged;
          if (!taggedId || notifiedUsers.has(taggedId)) continue;
          notifiedUsers.add(taggedId);

          const overrideTitle = `${basePayload.nama_pemohon} mengajukan izin jam`;
          const overrideBody = `${basePayload.nama_pemohon} menandai Anda sebagai handover untuk izin jam ${basePayload.kategori_izin} pada ${basePayload.tanggal_izin_display} (${waktuRentangDisplay}).`;

          notifPromises.push(
            sendNotification(
              'IZIN_JAM_HANDOVER_TAGGED',
              taggedId,
              {
                ...basePayload,
                nama_penerima: handoverUser?.user?.nama_pengguna || undefined,
                title: overrideTitle,
                body: overrideBody,
                overrideTitle,
                overrideBody,
              },
              { deeplink }
            )
          );
        }
      }

      if (result.id_user && !notifiedUsers.has(result.id_user)) {
        const overrideTitle = 'Pengajuan izin jam berhasil dikirim';
        const overrideBody = `Pengajuan izin jam ${basePayload.kategori_izin} pada ${basePayload.tanggal_izin_display} (${waktuRentangDisplay}) telah berhasil dibuat.`;

        notifPromises.push(
          sendNotification(
            'IZIN_JAM_HANDOVER_TAGGED',
            result.id_user,
            {
              ...basePayload,
              is_pemohon: true,
              title: overrideTitle,
              body: overrideBody,
              overrideTitle,
              overrideBody,
            },
            { deeplink }
          )
        );
        notifiedUsers.add(result.id_user);
      }

      if (canManageAll(actorRole) && actorId && !notifiedUsers.has(actorId)) {
        const overrideTitle = 'Pengajuan izin jam berhasil dibuat';
        const overrideBody = `Pengajuan izin jam untuk ${basePayload.nama_pemohon} pada ${basePayload.tanggal_izin_display} (${waktuRentangDisplay}) telah disimpan.`;

        notifPromises.push(
          sendNotification(
            'IZIN_JAM_HANDOVER_TAGGED',
            actorId,
            {
              ...basePayload,
              is_admin: true,
              title: overrideTitle,
              body: overrideBody,
              overrideTitle,
              overrideBody,
            },
            { deeplink }
          )
        );
        notifiedUsers.add(actorId);
      }

      if (notifPromises.length) {
        await Promise.allSettled(notifPromises);
      }
    }

    return NextResponse.json({ message: 'Pengajuan izin jam berhasil dibuat.', data: result, upload: uploadMeta || undefined }, { status: 201 });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    if (err?.code === 'P2003') {
      return NextResponse.json({ message: 'Data referensi tidak valid.' }, { status: 400 });
    }
    console.error('POST /mobile/pengajuan-izin-jam error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export { ensureAuth, baseInclude, parseTagUserIds };
