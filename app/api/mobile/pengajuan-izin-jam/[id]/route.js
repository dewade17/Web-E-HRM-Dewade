import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { parseDateOnlyToUTC, parseDateTimeToUTC } from '@/helpers/date-helper';
import storageClient from '@/app/api/_utils/storageClient';
import { parseRequestBody, findFileInBody, hasOwn } from '@/app/api/_utils/requestBody';
import { readApprovalsFromBody } from '../_utils/approvals';

const APPROVE_STATUSES = new Set(['disetujui', 'ditolak', 'pending']); // selaras Prisma
const ADMIN_ROLES = new Set(['HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN', 'SUBADMIN', 'SUPERVISI']);

const baseInclude = {
  user: {
    select: { id_user: true, nama_pengguna: true, email: true, role: true },
  },
  kategori: {
    select: { id_kategori_izin_jam: true, nama_kategori: true },
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
      id_approval_pengajuan_izin_jam: true,
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
const isAdminRole = (role) => ADMIN_ROLES.has(normRole(role));

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

// Normalisasi status input (kompatibel klien lama)
function normalizeStatusInput(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim().toLowerCase();
  const mapped = s === 'menunggu' ? 'pending' : s;
  return APPROVE_STATUSES.has(mapped) ? mapped : null;
}

async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const payload = verifyAuthToken(auth.slice(7));
      const id = payload?.sub || payload?.id_user || payload?.userId;
      if (id) {
        return { actor: { id, role: payload?.role, source: 'bearer' } };
      }
    } catch {}
  }

  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;

  const id = sessionOrRes?.user?.id || sessionOrRes?.user?.id_user;
  if (!id) return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });

  return { actor: { id, role: sessionOrRes?.user?.role, source: 'session', session: sessionOrRes } };
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

async function getPengajuanOr404(id) {
  const pengajuan = await db.pengajuanIzinJam.findFirst({
    where: { id_pengajuan_izin_jam: id, deleted_at: null },
    include: baseInclude,
  });
  if (!pengajuan) return NextResponse.json({ message: 'Pengajuan izin jam tidak ditemukan.' }, { status: 404 });
  return pengajuan;
}

export async function GET(_req, { params }) {
  try {
    const pengajuan = await getPengajuanOr404(params.id);
    if (pengajuan instanceof NextResponse) return pengajuan;
    return NextResponse.json({ ok: true, data: pengajuan });
  } catch (err) {
    console.error('GET /mobile/pengajuan-izin-jam/:id error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function PUT(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  const actorRole = auth.actor?.role;
  if (!actorId) return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });

  try {
    const pengajuan = await getPengajuanOr404(params.id);
    if (pengajuan instanceof NextResponse) return pengajuan;

    if (pengajuan.id_user !== actorId && !isAdminRole(actorRole)) {
      return NextResponse.json({ message: 'Forbidden.' }, { status: 403 });
    }

    const parsed = await parseRequestBody(req);
    const body = parsed.body || {};

    let approvalsInput;
    try {
      approvalsInput = readApprovalsFromBody(body);
    } catch (err) {
      if (err instanceof NextResponse) return err;
      throw err;
    }

    const data = {};

    if (Object.prototype.hasOwnProperty.call(body, 'id_user')) {
      const nextId = String(body.id_user || '').trim();
      if (!nextId) return NextResponse.json({ message: "Field 'id_user' tidak boleh kosong." }, { status: 400 });
      if (!isAdminRole(actorRole) && nextId !== pengajuan.id_user) {
        return NextResponse.json({ message: 'Forbidden.' }, { status: 403 });
      }
      const targetUser = await db.user.findFirst({ where: { id_user: nextId, deleted_at: null }, select: { id_user: true } });
      if (!targetUser) return NextResponse.json({ message: 'User tujuan tidak ditemukan.' }, { status: 404 });
      data.id_user = nextId;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'tanggal_izin')) {
      const parsed = parseDateOnlyToUTC(body.tanggal_izin);
      if (!parsed) return NextResponse.json({ message: "Field 'tanggal_izin' harus berupa tanggal yang valid." }, { status: 400 });
      data.tanggal_izin = parsed;
    }

    let jamMulai = pengajuan.jam_mulai;
    let jamSelesai = pengajuan.jam_selesai;
    let jamMulaiPengganti = pengajuan.jam_mulai_pengganti;
    let jamSelesaiPengganti = pengajuan.jam_selesai_pengganti;

    if (Object.prototype.hasOwnProperty.call(body, 'jam_mulai')) {
      const parsed = parseDateTimeToUTC(body.jam_mulai);
      if (!parsed) return NextResponse.json({ message: "Field 'jam_mulai' harus berupa waktu yang valid." }, { status: 400 });
      data.jam_mulai = parsed;
      jamMulai = parsed;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'jam_selesai')) {
      const parsed = parseDateTimeToUTC(body.jam_selesai);
      if (!parsed) return NextResponse.json({ message: "Field 'jam_selesai' harus berupa waktu yang valid." }, { status: 400 });
      data.jam_selesai = parsed;
      jamSelesai = parsed;
    }

    if (jamMulai && jamSelesai && jamSelesai <= jamMulai) {
      return NextResponse.json({ message: 'jam_selesai harus lebih besar dari jam_mulai.' }, { status: 400 });
    }

    if (Object.prototype.hasOwnProperty.call(body, 'tanggal_pengganti')) {
      if (isNullLike(body.tanggal_pengganti)) {
        data.tanggal_pengganti = null;
      } else {
        const parsed = parseDateOnlyToUTC(body.tanggal_pengganti);
        if (!parsed) return NextResponse.json({ message: "Field 'tanggal_pengganti' harus berupa tanggal yang valid." }, { status: 400 });
        data.tanggal_pengganti = parsed;
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'jam_mulai_pengganti')) {
      if (isNullLike(body.jam_mulai_pengganti)) {
        data.jam_mulai_pengganti = null;
        jamMulaiPengganti = null;
      } else {
        const parsed = parseDateTimeToUTC(body.jam_mulai_pengganti);
        if (!parsed) return NextResponse.json({ message: "Field 'jam_mulai_pengganti' harus berupa waktu yang valid." }, { status: 400 });
        data.jam_mulai_pengganti = parsed;
        jamMulaiPengganti = parsed;
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'jam_selesai_pengganti')) {
      if (isNullLike(body.jam_selesai_pengganti)) {
        data.jam_selesai_pengganti = null;
        jamSelesaiPengganti = null;
      } else {
        const parsed = parseDateTimeToUTC(body.jam_selesai_pengganti);
        if (!parsed) return NextResponse.json({ message: "Field 'jam_selesai_pengganti' harus berupa waktu yang valid." }, { status: 400 });
        data.jam_selesai_pengganti = parsed;
        jamSelesaiPengganti = parsed;
      }
    }

    if (jamMulaiPengganti && jamSelesaiPengganti && jamSelesaiPengganti <= jamMulaiPengganti) {
      return NextResponse.json({ message: 'jam_selesai_pengganti harus lebih besar dari jam_mulai_pengganti.' }, { status: 400 });
    }

    if (Object.prototype.hasOwnProperty.call(body, 'id_kategori_izin_jam')) {
      const kategoriId = String(body.id_kategori_izin_jam || '').trim();
      if (!kategoriId) return NextResponse.json({ message: "Field 'id_kategori_izin_jam' tidak boleh kosong." }, { status: 400 });

      const kategori = await db.kategoriIzinJam.findFirst({
        where: { id_kategori_izin_jam: kategoriId, deleted_at: null },
        select: { id_kategori_izin_jam: true },
      });
      if (!kategori) return NextResponse.json({ message: 'Kategori izin jam tidak ditemukan.' }, { status: 404 });

      data.id_kategori_izin_jam = kategoriId;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'keperluan')) {
      data.keperluan = isNullLike(body.keperluan) ? null : String(body.keperluan).trim();
    }

    if (Object.prototype.hasOwnProperty.call(body, 'handover')) {
      data.handover = isNullLike(body.handover) ? null : String(body.handover).trim();
    }

    if (Object.prototype.hasOwnProperty.call(body, 'status')) {
      const normalized = normalizeStatusInput(body.status);
      if (!normalized) return NextResponse.json({ message: 'status tidak valid.' }, { status: 400 });
      data.status = normalized;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'current_level')) {
      if (body.current_level === null || body.current_level === undefined || body.current_level === '') {
        data.current_level = null;
      } else {
        const levelNumber = Number(body.current_level);
        if (!Number.isFinite(levelNumber)) return NextResponse.json({ message: 'current_level harus berupa angka.' }, { status: 400 });
        data.current_level = levelNumber;
      }
    }

    let uploadMeta = null;
    const newFile = findFileInBody(body, ['lampiran_izin_jam', 'lampiran', 'lampiran_file', 'file']);
    if (newFile) {
      try {
        const res = await storageClient.uploadBufferWithPresign(newFile, { folder: 'pengajuan' });
        data.lampiran_izin_jam_url = res.publicUrl || null;
        uploadMeta = { key: res.key, publicUrl: res.publicUrl, etag: res.etag, size: res.size };
      } catch (e) {
        return NextResponse.json({ message: 'Gagal mengunggah lampiran.', detail: e?.message || String(e) }, { status: 502 });
      }
    } else if (hasOwn(body, 'lampiran_izin_jam_url') || hasOwn(body, 'lampiran_url') || hasOwn(body, 'lampiran')) {
      const lampiran = normalizeLampiranInput(body.lampiran_izin_jam_url ?? body.lampiran_url ?? body.lampiran);
      data.lampiran_izin_jam_url = lampiran;
    }

    const tagUserIds = parseTagUserIds(body.tag_user_ids);
    if (tagUserIds !== undefined) await validateTaggedUsers(tagUserIds);

    const existingApprovals = Array.isArray(pengajuan.approvals) ? pengajuan.approvals : [];
    const updated = await db.$transaction(async (tx) => {
      const saved = await tx.pengajuanIzinJam.update({
        where: { id_pengajuan_izin_jam: pengajuan.id_pengajuan_izin_jam },
        data,
      });

      if (tagUserIds !== undefined) {
        await tx.handoverIzinJam.deleteMany({
          where: {
            id_pengajuan_izin_jam: saved.id_pengajuan_izin_jam,
            ...(tagUserIds.length ? { id_user_tagged: { notIn: tagUserIds } } : {}),
          },
        });

        if (tagUserIds.length) {
          const existing = await tx.handoverIzinJam.findMany({
            where: { id_pengajuan_izin_jam: saved.id_pengajuan_izin_jam, id_user_tagged: { in: tagUserIds } },
            select: { id_user_tagged: true },
          });
          const existingSet = new Set(existing.map((i) => i.id_user_tagged));
          const toCreate = tagUserIds.filter((id) => !existingSet.has(id)).map((id) => ({ id_pengajuan_izin_jam: saved.id_pengajuan_izin_jam, id_user_tagged: id }));

          if (toCreate.length) await tx.handoverIzinJam.createMany({ data: toCreate, skipDuplicates: true });
        }
      }

      if (approvalsInput !== undefined) {
        const existingMap = new Map(existingApprovals.map((it) => [it.id_approval_pengajuan_izin_jam, it]));
        const seenIds = new Set();
        const toCreate = [];
        const toUpdate = [];

        approvalsInput.forEach((approval) => {
          if (approval.id && existingMap.has(approval.id)) {
            seenIds.add(approval.id);
            const current = existingMap.get(approval.id);
            const currentRole = current?.approver_role ? String(current.approver_role).trim().toUpperCase() : null;
            const currentUser = current?.approver_user_id || null;
            if (current?.level !== approval.level || currentUser !== (approval.approver_user_id || null) || currentRole !== (approval.approver_role || null)) {
              toUpdate.push(approval);
            }
          } else {
            toCreate.push(approval);
          }
        });

        const toDeleteIds = existingApprovals.filter((it) => !seenIds.has(it.id_approval_pengajuan_izin_jam)).map((it) => it.id_approval_pengajuan_izin_jam);

        if (toDeleteIds.length) {
          await tx.approvalPengajuanIzinJam.deleteMany({
            where: { id_pengajuan_izin_jam: saved.id_pengajuan_izin_jam, id_approval_pengajuan_izin_jam: { in: toDeleteIds } },
          });
        }

        if (toUpdate.length) {
          await Promise.all(
            toUpdate.map((approval) =>
              tx.approvalPengajuanIzinJam.update({
                where: { id_approval_pengajuan_izin_jam: approval.id },
                data: {
                  level: approval.level,
                  approver_user_id: approval.approver_user_id,
                  approver_role: approval.approver_role,
                  decision: 'pending', // reset sesuai enum Prisma
                  decided_at: null,
                  note: null,
                },
              })
            )
          );
        }

        if (toCreate.length) {
          await tx.approvalPengajuanIzinJam.createMany({
            data: toCreate.map((approval) => ({
              id_pengajuan_izin_jam: saved.id_pengajuan_izin_jam,
              level: approval.level,
              approver_user_id: approval.approver_user_id,
              approver_role: approval.approver_role,
              decision: 'pending',
            })),
          });
        }
      }

      return tx.pengajuanIzinJam.findUnique({
        where: { id_pengajuan_izin_jam: saved.id_pengajuan_izin_jam },
        include: baseInclude,
      });
    });

    return NextResponse.json({ message: 'Pengajuan izin jam berhasil diperbarui.', data: updated, upload: uploadMeta || undefined });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    if (err?.code === 'P2003') return NextResponse.json({ message: 'Data referensi tidak valid.' }, { status: 400 });
    console.error('PUT /mobile/pengajuan-izin-jam/:id error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  const actorRole = auth.actor?.role;
  if (!actorId) return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });

  try {
    const pengajuan = await getPengajuanOr404(params.id);
    if (pengajuan instanceof NextResponse) return pengajuan;

    if (pengajuan.id_user !== actorId && !isAdminRole(actorRole)) {
      return NextResponse.json({ message: 'Forbidden.' }, { status: 403 });
    }

    // Logic Change: Always hard delete (langsung hapus permanen)
    await db.pengajuanIzinJam.delete({
      where: { id_pengajuan_izin_jam: pengajuan.id_pengajuan_izin_jam },
    });

    return NextResponse.json({
      message: 'Pengajuan izin jam berhasil dihapus permanen.',
      data: { id: pengajuan.id_pengajuan_izin_jam, deleted: true },
    });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    // Handle foreign key constraint errors
    if (err?.code === 'P2003') {
      return NextResponse.json({ message: 'Gagal menghapus: Data ini masih direferensikan oleh data lain.' }, { status: 409 });
    }
    console.error('DELETE /mobile/pengajuan-izin-jam/:id error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}
