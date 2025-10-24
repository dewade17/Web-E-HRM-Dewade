import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { sendNotification } from '@/app/utils/services/notificationService';

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
      id_kategori_sakit: true,
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

    const where = { deleted_at: null };

    if (!canManageAll(actorRole)) {
      where.id_user = actorId;
    } else if (idUserFilter) {
      where.id_user = String(idUserFilter).trim();
    }

    if (status && APPROVE_STATUSES.has(status)) {
      where.status = status;
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

    if (and.length) {
      where.AND = and;
    }

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
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
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
  if (!actorId) {
    return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const body = await req.json();

    const kategoriIdRaw = body.id_kategori_sakit ?? body.id_kategori ?? body.kategori;
    const kategoriId = kategoriIdRaw ? String(kategoriIdRaw).trim() : '';
    if (!kategoriId) {
      return NextResponse.json({ message: "Field 'id_kategori_sakit' wajib diisi." }, { status: 400 });
    }

    const targetUserId = canManageAll(actorRole) && body.id_user ? String(body.id_user).trim() : actorId;
    if (!targetUserId) {
      return NextResponse.json({ message: 'id_user tujuan tidak valid.' }, { status: 400 });
    }

    const handover = isNullLike(body.handover) ? null : String(body.handover).trim();
    const lampiran = normalizeLampiranInput(body.lampiran_izin_sakit_url ?? body.lampiran_url ?? body.lampiran ?? body.lampiran_izin);

    const statusRaw = body.status ? String(body.status).trim().toLowerCase() : 'pending';
    if (statusRaw && !APPROVE_STATUSES.has(statusRaw)) {
      return NextResponse.json({ message: 'status tidak valid.' }, { status: 400 });
    }

    const currentLevel = body.current_level !== undefined ? Number(body.current_level) : null;
    if (currentLevel !== null && !Number.isFinite(currentLevel)) {
      return NextResponse.json({ message: 'current_level harus berupa angka.' }, { status: 400 });
    }

    const tagUserIds = parseTagUserIds(body.tag_user_ids ?? body.handover_user_ids);
    await validateTaggedUsers(tagUserIds);

    const [targetUser, kategori] = await Promise.all([
      db.user.findFirst({
        where: { id_user: targetUserId, deleted_at: null },
        select: { id_user: true, nama_pengguna: true },
      }),
      db.kategoriSakit.findFirst({
        where: { id_kategori_sakit: kategoriId, deleted_at: null },
        select: { id_kategori_sakit: true, nama_kategori: true },
      }),
    ]);

    if (!targetUser) {
      return NextResponse.json({ message: 'User tujuan tidak ditemukan.' }, { status: 404 });
    }

    if (!kategori) {
      return NextResponse.json({ message: 'Kategori sakit tidak ditemukan.' }, { status: 404 });
    }

    const result = await db.$transaction(async (tx) => {
      const created = await tx.pengajuanIzinSakit.create({
        data: {
          id_user: targetUserId,
          id_kategori_sakit: kategoriId,
          handover,
          lampiran_izin_sakit_url: lampiran ?? null,
          status: statusRaw,
          current_level: currentLevel,
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

      return tx.pengajuanIzinSakit.findUnique({
        where: { id_pengajuan_izin_sakit: created.id_pengajuan_izin_sakit },
        include: baseInclude,
      });
    });

    if (result) {
      const deeplink = `/pengajuan-izin-sakit/${result.id_pengajuan_izin_sakit}`;
      const basePayload = {
        nama_pemohon: result.user?.nama_pengguna || 'Rekan',
        kategori_sakit: result.kategori?.nama_kategori || '-',
        handover: result.handover || '-',
        status: result.status || 'pending',
        current_level: result.current_level ?? null,
        lampiran_izin_sakit_url: result.lampiran_izin_sakit_url || null,
        related_table: 'pengajuan_izin_sakit',
        related_id: result.id_pengajuan_izin_sakit,
        deeplink,
      };

      const notifiedUsers = new Set();
      const notifPromises = [];

      if (Array.isArray(result.handover_users)) {
        for (const handoverUser of result.handover_users) {
          const taggedId = handoverUser?.id_user_tagged;
          if (!taggedId || notifiedUsers.has(taggedId)) continue;
          notifiedUsers.add(taggedId);

          const overrideTitle = `${basePayload.nama_pemohon} mengajukan izin sakit`;
          const overrideBody = `${basePayload.nama_pemohon} menandai Anda sebagai handover untuk izin sakit ${basePayload.kategori_sakit}.`;

          notifPromises.push(
            sendNotification(
              'IZIN_SAKIT_HANDOVER_TAGGED',
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
        const overrideTitle = 'Pengajuan izin sakit berhasil dikirim';
        const overrideBody = `Pengajuan izin sakit ${basePayload.kategori_sakit} telah berhasil dibuat.`;

        notifPromises.push(
          sendNotification(
            'IZIN_SAKIT_HANDOVER_TAGGED',
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
        const overrideTitle = 'Pengajuan izin sakit berhasil dibuat';
        const overrideBody = `Pengajuan izin sakit untuk ${basePayload.nama_pemohon} telah disimpan.`;

        notifPromises.push(
          sendNotification(
            'IZIN_SAKIT_HANDOVER_TAGGED',
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

    return NextResponse.json({ message: 'Pengajuan izin sakit berhasil dibuat.', data: result }, { status: 201 });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    if (err?.code === 'P2003') {
      return NextResponse.json({ message: 'Data referensi tidak valid.' }, { status: 400 });
    }
    console.error('POST /mobile/pengajuan-izin-sakit error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}
