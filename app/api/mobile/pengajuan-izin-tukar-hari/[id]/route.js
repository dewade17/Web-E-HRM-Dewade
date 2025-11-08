import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { parseDateOnlyToUTC } from '@/helpers/date-helper';
import { parseRequestBody, isNullLike, findFileInBody } from '@/app/api/_utils/requestBody';
import storageClient from '@/app/api/_utils/storageClient';
import { extractApprovalsFromBody, normalizeApprovalRole, validateApprovalEntries } from '@/app/api/mobile/_utils/approvalValidation';

const APPROVE_STATUSES = new Set(['disetujui', 'ditolak', 'pending', 'menunggu']);
const ADMIN_ROLES = new Set(['HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN']);

/*
 * Include definition for a complete IzinTukarHari object.  In addition to
 * the previously selected relations (user, handover_users, approvals),
 * this now pulls in the related `pairs` records.  Each pair in the
 * `pairs` relation contains the swap date (hari_izin) and the replacement
 * date (hari_pengganti) along with an optional note.  Ordering by
 * `hari_izin` ensures that the first element in the array represents
 * the earliest swap pair.  Consumers can derive the legacy scalar
 * properties (hari_izin and hari_pengganti) by referencing the first
 * element of this sorted array.
 */
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
  // Pull all swap pairs associated with this submission.  Ordering by
  // hari_izin allows callers to easily determine the first/earliest swap.
  pairs: {
    select: {
      hari_izin: true,
      hari_pengganti: true,
      catatan_pair: true,
    },
    orderBy: { hari_izin: 'asc' },
  },
};

const normRole = (role) =>
  String(role || '')
    .trim()
    .toUpperCase();
const isAdminRole = (role) => ADMIN_ROLES.has(normRole(role));

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

async function getPengajuanOr404(id) {
  const pengajuan = await db.izinTukarHari.findFirst({
    where: { id_izin_tukar_hari: id, deleted_at: null },
    include: baseInclude,
  });
  if (!pengajuan) {
    return NextResponse.json({ message: 'Pengajuan izin tukar hari tidak ditemukan.' }, { status: 404 });
  }
  return pengajuan;
}

export async function GET(_req, { params }) {
  try {
    const pengajuan = await getPengajuanOr404(params.id);
    if (pengajuan instanceof NextResponse) return pengajuan;
    // Compute derived hari_izin and hari_pengganti from the first pair.
    let derivedHariIzin = null;
    let derivedHariPengganti = null;
    let pairs = [];
    if (Array.isArray(pengajuan.pairs)) {
      // Normalize pairs to plain objects and sort by hari_izin ascending
      pairs = pengajuan.pairs
        .map((p) => ({
          hari_izin: p.hari_izin,
          hari_pengganti: p.hari_pengganti,
          catatan_pair: p.catatan_pair ?? null,
        }))
        .sort((a, b) => {
          const aT = a.hari_izin instanceof Date ? a.hari_izin.getTime() : new Date(a.hari_izin).getTime();
          const bT = b.hari_izin instanceof Date ? b.hari_izin.getTime() : new Date(b.hari_izin).getTime();
          return aT - bT;
        });
      if (pairs.length) {
        derivedHariIzin = pairs[0].hari_izin;
        derivedHariPengganti = pairs[0].hari_pengganti;
      }
    }
    const { pairs: _unusedPairs, ...rest } = pengajuan;
    return NextResponse.json({ ok: true, data: { ...rest, hari_izin: derivedHariIzin, hari_pengganti: derivedHariPengganti, pairs } });
  } catch (err) {
    console.error('GET /mobile/pengajuan-izin-tukar-hari/:id error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function PUT(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  const actorRole = auth.actor?.role;
  if (!actorId) {
    return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const pengajuan = await getPengajuanOr404(params.id);
    if (pengajuan instanceof NextResponse) return pengajuan;

    if (pengajuan.id_user !== actorId && !isAdminRole(actorRole)) {
      return NextResponse.json({ message: 'Forbidden.' }, { status: 403 });
    }

    const parsed = await parseRequestBody(req);
    const body = parsed.body || {};

    const data = {};

    if (Object.prototype.hasOwnProperty.call(body, 'id_user')) {
      const nextId = String(body.id_user || '').trim();
      if (!nextId) {
        return NextResponse.json({ message: "Field 'id_user' tidak boleh kosong." }, { status: 400 });
      }
      if (!isAdminRole(actorRole) && nextId !== pengajuan.id_user) {
        return NextResponse.json({ message: 'Forbidden.' }, { status: 403 });
      }

      const targetUser = await db.user.findFirst({
        where: { id_user: nextId, deleted_at: null },
        select: { id_user: true },
      });
      if (!targetUser) {
        return NextResponse.json({ message: 'User tujuan tidak ditemukan.' }, { status: 404 });
      }

      data.id_user = nextId;
    }

    // Extract potential updates to the swap date pairs.  In the new schema,
    // hari_izin and hari_pengganti are no longer stored on the main record.
    // When one or both of these fields are present in the request body,
    // interpret them as arrays (or single values) of equal length and
    // prepare to rebuild the related pairs.  If neither field is provided,
    // the existing pairs remain unchanged.
    let newPairs;
    const hasHariIzin = Object.prototype.hasOwnProperty.call(body, 'hari_izin');
    const hasHariPengganti = Object.prototype.hasOwnProperty.call(body, 'hari_pengganti');
    if (hasHariIzin || hasHariPengganti) {
      const rawIzin = body.hari_izin;
      const rawPengganti = body.hari_pengganti;
      const arrIzin = Array.isArray(rawIzin) ? rawIzin : [rawIzin];
      const arrPengganti = Array.isArray(rawPengganti) ? rawPengganti : [rawPengganti];
      if (arrIzin.length > 1 && arrPengganti.length > 1 && arrIzin.length !== arrPengganti.length) {
        return NextResponse.json({ message: "Jumlah elemen pada 'hari_izin' dan 'hari_pengganti' tidak sesuai. Panjang array keduanya harus sama atau salah satunya satu." }, { status: 400 });
      }
      newPairs = [];
      for (let i = 0; i < arrIzin.length; i++) {
        const izinRaw = arrIzin[i];
        const penggantiRaw = arrPengganti.length > 1 ? arrPengganti[i] : arrPengganti[0];
        const dIzin = parseDateOnlyToUTC(izinRaw);
        if (!dIzin) {
          return NextResponse.json({ message: "Field 'hari_izin' harus berupa tanggal yang valid." }, { status: 400 });
        }
        const dPengganti = parseDateOnlyToUTC(penggantiRaw);
        if (!dPengganti) {
          return NextResponse.json({ message: "Field 'hari_pengganti' harus berupa tanggal yang valid." }, { status: 400 });
        }
        newPairs.push({ hari_izin: dIzin, hari_pengganti: dPengganti });
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'kategori')) {
      const kategori = String(body.kategori || '').trim();
      if (!kategori) {
        return NextResponse.json({ message: "Field 'kategori' tidak boleh kosong." }, { status: 400 });
      }
      data.kategori = kategori;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'keperluan')) {
      data.keperluan = isNullLike(body.keperluan) ? null : String(body.keperluan).trim();
    }

    if (Object.prototype.hasOwnProperty.call(body, 'handover')) {
      data.handover = isNullLike(body.handover) ? null : String(body.handover).trim();
    }

    // ===== Lampiran processing =====
    // Allow updating or removing attachments on an existing record.
    let uploadMeta = null;
    try {
      const lampiranFile = findFileInBody(body, ['lampiran_izin_tukar_hari', 'lampiran', 'lampiran_file', 'file']);
      if (lampiranFile) {
        // Upload new attachment and override existing URL
        const res = await storageClient.uploadBufferWithPresign(lampiranFile, { folder: 'pengajuan' });
        data.lampiran_izin_tukar_hari_url = res.publicUrl || null;
        uploadMeta = { key: res.key, publicUrl: res.publicUrl, etag: res.etag, size: res.size };
      } else if (Object.prototype.hasOwnProperty.call(body, 'lampiran_izin_tukar_hari_url')) {
        // Accept a direct URL or clear the attachment if null/empty
        data.lampiran_izin_tukar_hari_url = isNullLike(body.lampiran_izin_tukar_hari_url) ? null : String(body.lampiran_izin_tukar_hari_url);
      }
    } catch (e) {
      return NextResponse.json({ message: 'Gagal mengunggah lampiran.', detail: e?.message || String(e) }, { status: 502 });
    }

    if (Object.prototype.hasOwnProperty.call(body, 'status')) {
      const statusRaw = String(body.status || '')
        .trim()
        .toLowerCase();
      if (!APPROVE_STATUSES.has(statusRaw)) {
        return NextResponse.json({ message: 'status tidak valid.' }, { status: 400 });
      }
      data.status = statusRaw;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'current_level')) {
      if (body.current_level === null || body.current_level === undefined || body.current_level === '') {
        data.current_level = null;
      } else {
        const levelNumber = Number(body.current_level);
        if (!Number.isFinite(levelNumber)) {
          return NextResponse.json({ message: 'current_level harus berupa angka.' }, { status: 400 });
        }
        data.current_level = levelNumber;
      }
    }

    const tagUserIds = parseTagUserIds(body.tag_user_ids);
    if (tagUserIds !== undefined) {
      await validateTaggedUsers(tagUserIds);
    }
    const approvalsInput = extractApprovalsFromBody(body);
    const updated = await db.$transaction(async (tx) => {
      // Update base scalar fields on the submission
      const saved = await tx.izinTukarHari.update({
        where: { id_izin_tukar_hari: pengajuan.id_izin_tukar_hari },
        data,
      });

      // When newPairs is provided, rebuild the list of swap pairs.  The
      // existing pairs are removed and replaced with the provided pairs.
      if (newPairs !== undefined) {
        await tx.izinTukarHariPair.deleteMany({ where: { id_izin_tukar_hari: saved.id_izin_tukar_hari } });
        if (Array.isArray(newPairs) && newPairs.length) {
          await tx.izinTukarHariPair.createMany({
            data: newPairs.map((p) => ({
              id_izin_tukar_hari: saved.id_izin_tukar_hari,
              hari_izin: p.hari_izin,
              hari_pengganti: p.hari_pengganti,
            })),
            skipDuplicates: true,
          });
        }
      }

      // Synchronize tagged users if provided
      if (tagUserIds !== undefined) {
        await tx.handoverTukarHari.deleteMany({
          where: {
            id_izin_tukar_hari: saved.id_izin_tukar_hari,
            ...(tagUserIds.length ? { id_user_tagged: { notIn: tagUserIds } } : {}),
          },
        });

        if (tagUserIds.length) {
          const existing = await tx.handoverTukarHari.findMany({
            where: {
              id_izin_tukar_hari: saved.id_izin_tukar_hari,
              id_user_tagged: { in: tagUserIds },
            },
            select: { id_user_tagged: true },
          });
          const existingSet = new Set(existing.map((item) => item.id_user_tagged));
          const toCreate = tagUserIds
            .filter((id) => !existingSet.has(id))
            .map((id) => ({
              id_izin_tukar_hari: saved.id_izin_tukar_hari,
              id_user_tagged: id,
            }));

          if (toCreate.length) {
            await tx.handoverTukarHari.createMany({ data: toCreate, skipDuplicates: true });
          }
        }
      }

      // Synchronize approvals if provided
      if (approvalsInput !== undefined) {
        const approvals = await validateApprovalEntries(approvalsInput, tx);
        const existingApprovals = await tx.approvalIzinTukarHari.findMany({
          where: { id_izin_tukar_hari: saved.id_izin_tukar_hari, deleted_at: null },
          select: {
            id_approval_izin_tukar_hari: true,
            level: true,
            approver_user_id: true,
            approver_role: true,
          },
        });

        const existingMap = new Map(existingApprovals.map((item) => [item.id_approval_izin_tukar_hari, item]));
        const incomingIds = new Set(approvals.filter((item) => item.id).map((item) => item.id));

        const toDelete = existingApprovals.filter((item) => !incomingIds.has(item.id_approval_izin_tukar_hari)).map((item) => item.id_approval_izin_tukar_hari);
        if (toDelete.length) {
          await tx.approvalIzinTukarHari.deleteMany({
            where: { id_approval_izin_tukar_hari: { in: toDelete } },
          });
        }

        for (const approval of approvals) {
          if (approval.id && existingMap.has(approval.id)) {
            const current = existingMap.get(approval.id);
            const sameLevel = current.level === approval.level;
            const sameUser = (current.approver_user_id || null) === approval.approver_user_id;
            const sameRole = normalizeApprovalRole(current.approver_role) === normalizeApprovalRole(approval.approver_role);

            if (!sameLevel || !sameUser || !sameRole) {
              await tx.approvalIzinTukarHari.update({
                where: { id_approval_izin_tukar_hari: approval.id },
                data: {
                  level: approval.level,
                  approver_user_id: approval.approver_user_id,
                  approver_role: approval.approver_role,
                  decision: 'pending',
                  decided_at: null,
                  note: null,
                },
              });
            }
          } else {
            await tx.approvalIzinTukarHari.create({
              data: {
                id_izin_tukar_hari: saved.id_izin_tukar_hari,
                level: approval.level,
                approver_user_id: approval.approver_user_id,
                approver_role: approval.approver_role,
                decision: 'pending',
              },
            });
          }
        }
      }

      return tx.izinTukarHari.findUnique({
        where: { id_izin_tukar_hari: saved.id_izin_tukar_hari },
        include: baseInclude,
      });
    });

    // Compute derived hari_izin and hari_pengganti from the updated pairs.
    let outPairs = [];
    let firstHariIzin = null;
    let firstHariPengganti = null;
    if (updated && Array.isArray(updated.pairs)) {
      outPairs = updated.pairs
        .map((p) => ({
          hari_izin: p.hari_izin,
          hari_pengganti: p.hari_pengganti,
          catatan_pair: p.catatan_pair ?? null,
        }))
        .sort((a, b) => {
          const aT = a.hari_izin instanceof Date ? a.hari_izin.getTime() : new Date(a.hari_izin).getTime();
          const bT = b.hari_izin instanceof Date ? b.hari_izin.getTime() : new Date(b.hari_izin).getTime();
          return aT - bT;
        });
      if (outPairs.length) {
        firstHariIzin = outPairs[0].hari_izin;
        firstHariPengganti = outPairs[0].hari_pengganti;
      }
    }
    const { pairs: _unusedPairsUpdate, ...restUpdated } = updated || {};
    return NextResponse.json({
      message: 'Pengajuan izin tukar hari berhasil diperbarui.',
      data: { ...restUpdated, hari_izin: firstHariIzin, hari_pengganti: firstHariPengganti, pairs: outPairs },
      // Include upload metadata if a new file was uploaded
      upload: uploadMeta || undefined,
    });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    if (err?.code === 'P2003') {
      return NextResponse.json({ message: 'Data referensi tidak valid.' }, { status: 400 });
    }
    console.error('PUT /mobile/pengajuan-izin-tukar-hari/:id error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  const actorRole = auth.actor?.role;
  if (!actorId) {
    return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const pengajuan = await getPengajuanOr404(params.id);
    if (pengajuan instanceof NextResponse) return pengajuan;

    if (pengajuan.id_user !== actorId && !isAdminRole(actorRole)) {
      return NextResponse.json({ message: 'Forbidden.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const hard = searchParams.get('hard');

    if (hard === '1' || hard === 'true') {
      await db.izinTukarHari.delete({ where: { id_izin_tukar_hari: pengajuan.id_izin_tukar_hari } });
      return NextResponse.json({
        message: 'Pengajuan izin tukar hari dihapus permanen.',
        data: { id: pengajuan.id_izin_tukar_hari, deleted: true, hard: true },
      });
    }

    await db.izinTukarHari.update({
      where: { id_izin_tukar_hari: pengajuan.id_izin_tukar_hari },
      data: { deleted_at: new Date() },
    });

    return NextResponse.json({
      message: 'Pengajuan izin tukar hari berhasil dihapus.',
      data: { id: pengajuan.id_izin_tukar_hari, deleted: true, hard: false },
    });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    console.error('DELETE /mobile/pengajuan-izin-tukar-hari/:id error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}
