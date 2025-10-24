export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { parseDateOnlyToUTC } from '@/helpers/date-helper';
import { sendNotification } from '@/app/utils/services/notificationService';
const APPROVE_STATUSES = new Set(['disetujui', 'ditolak', 'pending', 'menunggu']);

const pengajuanInclude = {
  user: {
    select: {
      id_user: true,
      nama_pengguna: true,
      email: true,
      role: true,
    },
  },
  kategori_cuti: {
    select: {
      id_kategori_cuti: true,
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

async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const payload = verifyAuthToken(auth.slice(7).trim());
      const id = payload?.sub || payload?.id_user || payload?.userId || payload?.id;
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
    return NextResponse.json({ ok: false, message: 'Unauthorized.' }, { status: 401 });
  }

  return {
    actor: {
      id,
      role: sessionOrRes?.user?.role,
      source: 'session',
    },
  };
}

function normalizeStatus(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (!APPROVE_STATUSES.has(normalized)) return null;
  return normalized;
}

function parseDateQuery(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return parseDateOnlyToUTC(trimmed);
}

function sanitizeHandoverIds(ids) {
  if (ids === undefined) return undefined;
  if (!Array.isArray(ids)) return null;
  const unique = new Set();
  for (const raw of ids) {
    const val = String(raw || '').trim();
    if (!val) continue;
    unique.add(val);
  }
  return Array.from(unique);
}

export async function GET(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  if (!actorId) {
    return NextResponse.json({ ok: false, message: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);

    const rawPage = parseInt(searchParams.get('page') || '1', 10);
    const page = Number.isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
    const perPageRaw = parseInt(searchParams.get('perPage') || searchParams.get('pageSize') || '20', 10);
    const perPageBase = Number.isNaN(perPageRaw) || perPageRaw < 1 ? 20 : perPageRaw;
    const perPage = Math.min(Math.max(perPageBase, 1), 100);

    const statusParam = searchParams.get('status');
    const status = normalizeStatus(statusParam);
    if (statusParam && !status) {
      return NextResponse.json({ ok: false, message: 'Parameter status tidak valid.' }, { status: 400 });
    }

    const kategoriId = (searchParams.get('id_kategori_cuti') || '').trim();

    const tanggalMulaiEqParam = searchParams.get('tanggal_mulai');
    const tanggalMulaiFromParam = searchParams.get('tanggal_mulai_from');
    const tanggalMulaiToParam = searchParams.get('tanggal_mulai_to');

    const tanggalMasukEqParam = searchParams.get('tanggal_masuk_kerja');
    const tanggalMasukFromParam = searchParams.get('tanggal_masuk_kerja_from');
    const tanggalMasukToParam = searchParams.get('tanggal_masuk_kerja_to');

    const where = {
      deleted_at: null,
      id_user: actorId,
    };

    if (status) where.status = status;
    if (kategoriId) where.id_kategori_cuti = kategoriId;

    if (tanggalMulaiEqParam) {
      const parsed = parseDateQuery(tanggalMulaiEqParam);
      if (!parsed) {
        return NextResponse.json({ ok: false, message: 'Parameter tanggal_mulai tidak valid.' }, { status: 400 });
      }
      where.tanggal_mulai = parsed;
    } else if (tanggalMulaiFromParam || tanggalMulaiToParam) {
      const gte = parseDateQuery(tanggalMulaiFromParam);
      const lte = parseDateQuery(tanggalMulaiToParam);
      if (tanggalMulaiFromParam && !gte) {
        return NextResponse.json({ ok: false, message: 'Parameter tanggal_mulai_from tidak valid.' }, { status: 400 });
      }
      if (tanggalMulaiToParam && !lte) {
        return NextResponse.json({ ok: false, message: 'Parameter tanggal_mulai_to tidak valid.' }, { status: 400 });
      }
      where.tanggal_mulai = {
        ...(gte ? { gte } : {}),
        ...(lte ? { lte } : {}),
      };
    }

    if (tanggalMasukEqParam) {
      const parsed = parseDateQuery(tanggalMasukEqParam);
      if (!parsed) {
        return NextResponse.json({ ok: false, message: 'Parameter tanggal_masuk_kerja tidak valid.' }, { status: 400 });
      }
      where.tanggal_masuk_kerja = parsed;
    } else if (tanggalMasukFromParam || tanggalMasukToParam) {
      const gte = parseDateQuery(tanggalMasukFromParam);
      const lte = parseDateQuery(tanggalMasukToParam);
      if (tanggalMasukFromParam && !gte) {
        return NextResponse.json({ ok: false, message: 'Parameter tanggal_masuk_kerja_from tidak valid.' }, { status: 400 });
      }
      if (tanggalMasukToParam && !lte) {
        return NextResponse.json({ ok: false, message: 'Parameter tanggal_masuk_kerja_to tidak valid.' }, { status: 400 });
      }
      where.tanggal_masuk_kerja = {
        ...(gte ? { gte } : {}),
        ...(lte ? { lte } : {}),
      };
    }

    const [total, items] = await Promise.all([
      db.pengajuanCuti.count({ where }),
      db.pengajuanCuti.findMany({
        where,
        orderBy: [{ created_at: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
        include: pengajuanInclude,
      }),
    ]);

    return NextResponse.json({
      ok: true,
      data: items,
      meta: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
      },
    });
  } catch (err) {
    console.error('GET /mobile/pengajuan-cuti error:', err);
    return NextResponse.json({ ok: false, message: 'Gagal mengambil data pengajuan cuti.' }, { status: 500 });
  }
}

export async function POST(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  if (!actorId) {
    return NextResponse.json({ ok: false, message: 'Unauthorized.' }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch (err) {
    return NextResponse.json({ ok: false, message: 'Body request harus berupa JSON.' }, { status: 400 });
  }

  try {
    const id_kategori_cuti = String(body?.id_kategori_cuti || '').trim();
    const tanggal_mulai_raw = body?.tanggal_mulai;
    const tanggal_masuk_raw = body?.tanggal_masuk_kerja;
    const keperluan = body?.keperluan === undefined || body?.keperluan === null ? null : String(body.keperluan);
    const handover = body?.handover === undefined || body?.handover === null ? null : String(body.handover);

    if (!id_kategori_cuti) {
      return NextResponse.json({ ok: false, message: 'id_kategori_cuti wajib diisi.' }, { status: 400 });
    }

    const tanggal_mulai = parseDateOnlyToUTC(tanggal_mulai_raw);
    if (!tanggal_mulai) {
      return NextResponse.json({ ok: false, message: 'tanggal_mulai tidak valid.' }, { status: 400 });
    }

    const tanggal_masuk_kerja = parseDateOnlyToUTC(tanggal_masuk_raw);
    if (!tanggal_masuk_kerja) {
      return NextResponse.json({ ok: false, message: 'tanggal_masuk_kerja tidak valid.' }, { status: 400 });
    }

    if (tanggal_masuk_kerja < tanggal_mulai) {
      return NextResponse.json({ ok: false, message: 'tanggal_masuk_kerja tidak boleh sebelum tanggal_mulai.' }, { status: 400 });
    }

    const handoverIds = sanitizeHandoverIds(body?.handover_tag_user_ids);
    if (handoverIds === null) {
      return NextResponse.json({ ok: false, message: 'handover_tag_user_ids harus berupa array.' }, { status: 400 });
    }

    const kategori = await db.kategoriCuti.findFirst({
      where: { id_kategori_cuti, deleted_at: null },
      select: { id_kategori_cuti: true },
    });
    if (!kategori) {
      return NextResponse.json({ ok: false, message: 'Kategori cuti tidak ditemukan.' }, { status: 404 });
    }

    if (handoverIds && handoverIds.length) {
      const users = await db.user.findMany({
        where: { id_user: { in: handoverIds }, deleted_at: null },
        select: { id_user: true },
      });
      const foundIds = new Set(users.map((u) => u.id_user));
      const missing = handoverIds.filter((id) => !foundIds.has(id));
      if (missing.length) {
        return NextResponse.json({ ok: false, message: 'Beberapa handover_tag_user_ids tidak valid.' }, { status: 400 });
      }
    }

    const pengajuan = await db.$transaction(async (tx) => {
      const created = await tx.pengajuanCuti.create({
        data: {
          id_user: actorId,
          id_kategori_cuti,
          keperluan,
          tanggal_mulai,
          tanggal_masuk_kerja,
          handover,
        },
      });

      if (handoverIds && handoverIds.length) {
        await tx.handoverCuti.createMany({
          data: handoverIds.map((id_user_tagged) => ({
            id_pengajuan_cuti: created.id_pengajuan_cuti,
            id_user_tagged,
          })),
          skipDuplicates: true,
        });
      }

      return created;
    });

    const fullPengajuan = await db.pengajuanCuti.findUnique({
      where: { id_pengajuan_cuti: pengajuan.id_pengajuan_cuti },
      include: pengajuanInclude,
    });

    if (fullPengajuan) {
      const deeplink = `/pengajuan-cuti/${fullPengajuan.id_pengajuan_cuti}`;
      const basePayload = {
        nama_pemohon: fullPengajuan.user?.nama_pengguna || 'Rekan',
        kategori_cuti: fullPengajuan.kategori_cuti?.nama_kategori || '-',
        tanggal_mulai: formatDateISO(fullPengajuan.tanggal_mulai),
        tanggal_mulai_display: formatDateDisplay(fullPengajuan.tanggal_mulai),
        tanggal_masuk_kerja: formatDateISO(fullPengajuan.tanggal_masuk_kerja),
        tanggal_masuk_kerja_display: formatDateDisplay(fullPengajuan.tanggal_masuk_kerja),
        keperluan: fullPengajuan.keperluan || '-',
        handover: fullPengajuan.handover || '-',
        related_table: 'pengajuan_cuti',
        related_id: fullPengajuan.id_pengajuan_cuti,
        deeplink,
      };

      const notifiedUsers = new Set();
      const notifPromises = [];

      if (Array.isArray(fullPengajuan.handover_users)) {
        for (const handoverUser of fullPengajuan.handover_users) {
          const taggedId = handoverUser?.id_user_tagged;
          if (!taggedId || notifiedUsers.has(taggedId)) continue;
          notifiedUsers.add(taggedId);

          const overrideTitle = `${basePayload.nama_pemohon} mengajukan cuti`;
          const overrideBody = `${basePayload.nama_pemohon} menandai Anda sebagai handover cuti (${basePayload.kategori_cuti}) pada ${basePayload.tanggal_mulai_display}.`;

          notifPromises.push(
            sendNotification(
              'LEAVE_HANDOVER_TAGGED',
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

      if (fullPengajuan.id_user && !notifiedUsers.has(fullPengajuan.id_user)) {
        const overrideTitle = 'Pengajuan cuti berhasil dikirim';
        const overrideBody = `Pengajuan cuti ${basePayload.kategori_cuti} pada ${basePayload.tanggal_mulai_display} telah berhasil dibuat.`;

        notifPromises.push(
          sendNotification(
            'LEAVE_HANDOVER_TAGGED',
            fullPengajuan.id_user,
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
      }

      if (notifPromises.length) {
        await Promise.allSettled(notifPromises);
      }
    }

    return NextResponse.json({
      ok: true,
      message: 'Pengajuan cuti berhasil dibuat.',
      data: fullPengajuan ?? pengajuan,
    });
  } catch (err) {
    console.error('POST /mobile/pengajuan-cuti error:', err);
    return NextResponse.json({ ok: false, message: 'Gagal membuat pengajuan cuti.' }, { status: 500 });
  }
}

export { ensureAuth, pengajuanInclude, sanitizeHandoverIds, normalizeStatus, parseDateQuery };
