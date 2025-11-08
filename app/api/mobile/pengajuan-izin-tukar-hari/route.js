import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { parseDateOnlyToUTC, startOfUTCDay, endOfUTCDay } from '@/helpers/date-helper';
import { sendNotification } from '@/app/utils/services/notificationService';
import { parseRequestBody, findFileInBody, isNullLike } from '@/app/api/_utils/requestBody';
import storageClient from '@/app/api/_utils/storageClient';
import { extractApprovalsFromBody, validateApprovalEntries } from '@/app/api/mobile/_utils/approvalValidation';

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
      id_approval_izin_tukar_hari: true,
      level: true,
      approver_user_id: true,
      approver_role: true,
      decision: true,
      decided_at: true,
      note: true,
    },
  },
};

const dateDisplayFormatter = new Intl.DateTimeFormat('id-ID', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

const normRole = (role) =>
  String(role || '')
    .trim()
    .toUpperCase();
const canManageAll = (role) => ADMIN_ROLES.has(normRole(role));

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

function parseDateParam(value) {
  if (!value) return null;
  return parseDateOnlyToUTC(value);
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
    const hariIzin = searchParams.get('hari_izin');
    const hariPengganti = searchParams.get('hari_pengganti');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const penggantiFrom = searchParams.get('pengganti_from');
    const penggantiTo = searchParams.get('pengganti_to');

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
    if (hariIzin) {
      const parsed = parseDateParam(hariIzin);
      if (parsed) {
        and.push({ hari_izin: { gte: startOfUTCDay(parsed), lte: endOfUTCDay(parsed) } });
      }
    } else {
      const parsedFrom = from ? parseDateParam(from) : null;
      const parsedTo = to ? parseDateParam(to) : null;
      if (parsedFrom || parsedTo) {
        and.push({
          hari_izin: {
            ...(parsedFrom ? { gte: startOfUTCDay(parsedFrom) } : {}),
            ...(parsedTo ? { lte: endOfUTCDay(parsedTo) } : {}),
          },
        });
      }
    }

    if (hariPengganti) {
      const parsed = parseDateParam(hariPengganti);
      if (parsed) {
        and.push({ hari_pengganti: { gte: startOfUTCDay(parsed), lte: endOfUTCDay(parsed) } });
      }
    } else {
      const parsedFrom = penggantiFrom ? parseDateParam(penggantiFrom) : null;
      const parsedTo = penggantiTo ? parseDateParam(penggantiTo) : null;
      if (parsedFrom || parsedTo) {
        and.push({
          hari_pengganti: {
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
          OR: [{ kategori: { contains: keyword, mode: 'insensitive' } }, { keperluan: { contains: keyword, mode: 'insensitive' } }, { handover: { contains: keyword, mode: 'insensitive' } }],
        });
      }
    }

    if (and.length) {
      where.AND = and;
    }

    const [total, items] = await Promise.all([
      db.izinTukarHari.count({ where }),
      db.izinTukarHari.findMany({
        where,
        orderBy: [{ hari_izin: 'desc' }, { created_at: 'desc' }],
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
    console.error('GET /mobile/pengajuan-izin-tukar-hari error:', err);
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

    /*
     * Perubahan besar: mendukung pengajuan banyak tanggal
     * Secara historis, API ini hanya menerima satu hari_izin dan satu hari_pengganti.
     * Namun untuk memenuhi permintaan agar satu pengajuan bisa memilih lebih dari satu tanggal,
     * kita cek apakah input merupakan array. Jika array, setiap pasangan akan dibuatkan record terpisah.
     */
    const rawHariIzin = body.hari_izin;
    const rawHariPengganti = body.hari_pengganti;

    // Normalisasi menjadi array
    const hariIzinArr = Array.isArray(rawHariIzin) ? rawHariIzin : [rawHariIzin];
    const hariPenggantiArr = Array.isArray(rawHariPengganti) ? rawHariPengganti : [rawHariPengganti];

    // Validasi jumlah array: boleh 1 atau sama panjang
    if (hariIzinArr.length > 1 && hariPenggantiArr.length > 1 && hariIzinArr.length !== hariPenggantiArr.length) {
      return NextResponse.json(
        {
          message: "Jumlah elemen pada 'hari_izin' dan 'hari_pengganti' tidak sesuai. Panjang array keduanya harus sama atau salah satunya satu.",
        },
        { status: 400 }
      );
    }

    // Parse setiap pasangan tanggal
    const datePairs = [];
    for (let i = 0; i < hariIzinArr.length; i++) {
      const hIzinRaw = hariIzinArr[i];
      const hPenggantiRaw = hariPenggantiArr.length > 1 ? hariPenggantiArr[i] : hariPenggantiArr[0];
      const hIzin = parseDateOnlyToUTC(hIzinRaw);
      if (!hIzin) {
        return NextResponse.json({ message: "Field 'hari_izin' wajib diisi dan harus berupa tanggal yang valid." }, { status: 400 });
      }
      const hPengganti = parseDateOnlyToUTC(hPenggantiRaw);
      if (!hPengganti) {
        return NextResponse.json({ message: "Field 'hari_pengganti' wajib diisi dan harus berupa tanggal yang valid." }, { status: 400 });
      }
      datePairs.push({ hariIzin: hIzin, hariPengganti: hPengganti });
    }

    // ===== Lampiran processing =====
    // Allow clients to attach a file via multipart form-data under various keys or provide a direct URL.
    let uploadMeta = null;
    let lampiranUrl = null;
    try {
      const lampiranFile = findFileInBody(body, ['lampiran_izin_tukar_hari', 'lampiran', 'lampiran_file', 'file']);
      if (lampiranFile) {
        // Upload file to object storage and capture metadata
        const res = await storageClient.uploadBufferWithPresign(lampiranFile, { folder: 'pengajuan' });
        lampiranUrl = res.publicUrl || null;
        uploadMeta = { key: res.key, publicUrl: res.publicUrl, etag: res.etag, size: res.size };
      } else if (Object.prototype.hasOwnProperty.call(body, 'lampiran_izin_tukar_hari_url')) {
        // Fallback: accept a URL or explicit null/empty string to clear existing attachment
        lampiranUrl = isNullLike(body.lampiran_izin_tukar_hari_url) ? null : String(body.lampiran_izin_tukar_hari_url);
      }
    } catch (e) {
      return NextResponse.json({ message: 'Gagal mengunggah lampiran.', detail: e?.message || String(e) }, { status: 502 });
    }

    const kategori = String(body.kategori || '').trim();
    if (!kategori) {
      return NextResponse.json({ message: "Field 'kategori' wajib diisi." }, { status: 400 });
    }

    const targetUserId = canManageAll(actorRole) && body.id_user ? String(body.id_user).trim() : actorId;
    if (!targetUserId) {
      return NextResponse.json({ message: 'id_user tujuan tidak valid.' }, { status: 400 });
    }

    const keperluan = isNullLike(body.keperluan) ? null : String(body.keperluan).trim();
    const handover = isNullLike(body.handover) ? null : String(body.handover).trim();
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

    const jenisPengajuanResult = resolveJenisPengajuan(body.jenis_pengajuan, 'izin_tukar_hari');
    if (!jenisPengajuanResult.ok) {
      return NextResponse.json({ message: jenisPengajuanResult.message }, { status: 400 });
    }
    const approvalsInput = extractApprovalsFromBody(body);

    const jenis_pengajuan = jenisPengajuanResult.value;
    const targetUser = await db.user.findFirst({
      where: { id_user: targetUserId, deleted_at: null },
      select: { id_user: true, nama_pengguna: true },
    });
    if (!targetUser) {
      return NextResponse.json({ message: 'User tujuan tidak ditemukan.' }, { status: 404 });
    }

    // ===== Proses transaksi untuk banyak tanggal =====
    const resultList = await db.$transaction(async (tx) => {
      // Pre-validate approvals jika ada
      let approvalsValidated = [];
      if (approvalsInput !== undefined) {
        approvalsValidated = await validateApprovalEntries(approvalsInput, tx);
      }
      const createdRecords = [];
      for (const { hariIzin: hIzin, hariPengganti: hPengganti } of datePairs) {
        const created = await tx.izinTukarHari.create({
          data: {
            id_user: targetUserId,
            hari_izin: hIzin,
            hari_pengganti: hPengganti,
            kategori,
            keperluan,
            handover,
            status: statusRaw,
            current_level: currentLevel,
            jenis_pengajuan,
            // Store URL to uploaded attachment (may be null)
            lampiran_izin_tukar_hari_url: lampiranUrl,
          },
        });

        if (tagUserIds && tagUserIds.length) {
          await tx.handoverTukarHari.createMany({
            data: tagUserIds.map((id) => ({
              id_izin_tukar_hari: created.id_izin_tukar_hari,
              id_user_tagged: id,
            })),
            skipDuplicates: true,
          });
        }
        if (approvalsInput !== undefined && approvalsValidated.length) {
          await tx.approvalIzinTukarHari.createMany({
            data: approvalsValidated.map((item) => ({
              id_izin_tukar_hari: created.id_izin_tukar_hari,
              level: item.level,
              approver_user_id: item.approver_user_id,
              approver_role: item.approver_role,
              decision: 'pending',
            })),
          });
        }
        createdRecords.push(created);
      }
      // Fetch full objects with includes
      return Promise.all(
        createdRecords.map((item) =>
          tx.izinTukarHari.findUnique({
            where: { id_izin_tukar_hari: item.id_izin_tukar_hari },
            include: baseInclude,
          })
        )
      );
    });

    // Kirim notifikasi untuk setiap pengajuan
    for (const result of resultList) {
      if (!result) continue;

      const deeplink = `/pengajuan-izin-tukar-hari/${result.id_izin_tukar_hari}`;
      const basePayload = {
        nama_pemohon: result.user?.nama_pengguna || 'Rekan',
        kategori_izin: result.kategori || '-',
        hari_izin: result.hari_izin instanceof Date ? result.hari_izin.toISOString() : null,
        hari_pengganti: result.hari_pengganti instanceof Date ? result.hari_pengganti.toISOString() : null,
        hari_izin_display: formatDateDisplay(result.hari_izin),
        hari_pengganti_display: formatDateDisplay(result.hari_pengganti),
        keperluan: result.keperluan || '-',
        handover: result.handover || '-',
        related_table: 'izin_tukar_hari',
        related_id: result.id_izin_tukar_hari,
        deeplink,
      };

      const notifiedUsers = new Set();
      const notifPromises = [];

      if (Array.isArray(result.handover_users)) {
        for (const handoverUser of result.handover_users) {
          const taggedId = handoverUser?.id_user_tagged;
          if (!taggedId || notifiedUsers.has(taggedId)) continue;
          notifiedUsers.add(taggedId);

          const overrideTitle = `${basePayload.nama_pemohon} mengajukan izin tukar hari`;
          const overrideBody = `${basePayload.nama_pemohon} menandai Anda sebagai handover untuk izin tukar hari ${basePayload.kategori_izin} pada ${basePayload.hari_izin_display} diganti ${basePayload.hari_pengganti_display}.`;

          notifPromises.push(
            sendNotification(
              'IZIN_TUKAR_HARI_HANDOVER_TAGGED',
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
        const overrideTitle = 'Pengajuan izin tukar hari berhasil dikirim';
        const overrideBody = `Pengajuan izin tukar hari ${basePayload.kategori_izin} pada ${basePayload.hari_izin_display} diganti ${basePayload.hari_pengganti_display} telah berhasil dibuat.`;

        notifPromises.push(
          sendNotification(
            'IZIN_TUKAR_HARI_HANDOVER_TAGGED',
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
        const overrideTitle = 'Pengajuan izin tukar hari berhasil dibuat';
        const overrideBody = `Pengajuan izin tukar hari untuk ${basePayload.nama_pemohon} pada ${basePayload.hari_izin_display} diganti ${basePayload.hari_pengganti_display} telah disimpan.`;

        notifPromises.push(
          sendNotification(
            'IZIN_TUKAR_HARI_HANDOVER_TAGGED',
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

    return NextResponse.json(
      {
        message: resultList.length > 1 ? `Berhasil membuat ${resultList.length} pengajuan izin tukar hari.` : 'Pengajuan izin tukar hari berhasil dibuat.',
        data: resultList.length === 1 ? resultList[0] : resultList,
        // Include upload metadata if a file was uploaded
        upload: uploadMeta || undefined,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof NextResponse) return err;
    if (err?.code === 'P2003') {
      return NextResponse.json({ message: 'Data referensi tidak valid.' }, { status: 400 });
    }
    console.error('POST /mobile/pengajuan-izin-tukar-hari error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export { ensureAuth, baseInclude, parseTagUserIds };
