import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { ensureAuth, parseTagUserIds, normalizeApprovals, baseInclude } from '../route';
import storageClient from '@/app/api/_utils/storageClient';
import { parseRequestBody, findFileInBody, hasOwn } from '@/app/api/_utils/requestBody';
import { parseDateOnlyToUTC } from '@/helpers/date-helper';

const APPROVE_STATUSES = new Set(['disetujui', 'ditolak', 'pending']); // selaras Prisma
const ADMIN_ROLES = new Set(['HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN', 'SUBADMIN', 'SUPERVISI']);

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

// terima alias 'menunggu' → simpan 'pending'
function normalizeStatusInput(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim().toLowerCase();
  const mapped = s === 'menunggu' ? 'pending' : s;
  return APPROVE_STATUSES.has(mapped) ? mapped : null;
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

async function getPengajuanOr404(rawId) {
  const id = String(rawId || '').trim();
  if (!id) return NextResponse.json({ message: 'Pengajuan izin sakit tidak ditemukan.' }, { status: 404 });

  const pengajuan = await db.pengajuanIzinSakit.findFirst({
    where: { id_pengajuan_izin_sakit: id, deleted_at: null },
    include: baseInclude,
  });
  if (!pengajuan) return NextResponse.json({ message: 'Pengajuan izin sakit tidak ditemukan.' }, { status: 404 });
  return pengajuan;
}

export async function GET(_req, { params }) {
  try {
    const pengajuan = await getPengajuanOr404(params?.id);
    if (pengajuan instanceof NextResponse) return pengajuan;
    return NextResponse.json({ message: 'Detail pengajuan izin sakit berhasil diambil.', data: pengajuan });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    console.error('GET /mobile/pengajuan-izin-sakit/:id error:', err);
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
    const pengajuan = await getPengajuanOr404(params?.id);
    if (pengajuan instanceof NextResponse) return pengajuan;

    if (pengajuan.id_user !== actorId && !isAdminRole(actorRole)) {
      return NextResponse.json({ message: 'Forbidden.' }, { status: 403 });
    }

    const parsed = await parseRequestBody(req);
    const body = parsed.body || {};
    const data = {};
    const approvalsInput = normalizeApprovals(body);

    // tanggal_pengajuan (opsional, nullable)
    if (hasOwn(body, 'tanggal_pengajuan')) {
      const raw = body.tanggal_pengajuan;
      if (raw === undefined) {
        // abaikan
      } else if (isNullLike(raw)) {
        data.tanggal_pengajuan = null;
      } else {
        const parsedTanggal = parseDateOnlyToUTC(raw);
        if (!parsedTanggal) {
          return NextResponse.json({ message: "Field 'tanggal_pengajuan' harus berupa tanggal valid (YYYY-MM-DD)." }, { status: 400 });
        }
        data.tanggal_pengajuan = parsedTanggal;
      }
    }

    // pemilik pengajuan
    if (hasOwn(body, 'id_user')) {
      const nextId = String(body.id_user || '').trim();
      if (!nextId) return NextResponse.json({ message: "Field 'id_user' tidak boleh kosong." }, { status: 400 });
      if (!isAdminRole(actorRole) && nextId !== pengajuan.id_user) return NextResponse.json({ message: 'Forbidden.' }, { status: 403 });

      const targetUser = await db.user.findFirst({ where: { id_user: nextId, deleted_at: null }, select: { id_user: true } });
      if (!targetUser) return NextResponse.json({ message: 'User tujuan tidak ditemukan.' }, { status: 404 });
      data.id_user = nextId;
    }

    // kategori sakit
    if (hasOwn(body, 'id_kategori_sakit')) {
      const nextKategoriId = String(body.id_kategori_sakit || '').trim();
      if (!nextKategoriId) return NextResponse.json({ message: "Field 'id_kategori_sakit' tidak boleh kosong." }, { status: 400 });

      const kategori = await db.kategoriSakit.findFirst({
        where: { id_kategori_sakit: nextKategoriId, deleted_at: null },
        select: { id_kategori_sakit: true },
      });
      if (!kategori) return NextResponse.json({ message: 'Kategori sakit tidak ditemukan.' }, { status: 404 });

      data.id_kategori_sakit = nextKategoriId;
    }

    if (hasOwn(body, 'handover')) {
      data.handover = isNullLike(body.handover) ? null : String(body.handover).trim();
    }

    if (hasOwn(body, 'status')) {
      const normalized = normalizeStatusInput(body.status);
      if (!normalized) return NextResponse.json({ message: 'status tidak valid.' }, { status: 400 });
      data.status = normalized;
    }

    if (hasOwn(body, 'current_level')) {
      if (body.current_level === null || body.current_level === undefined || body.current_level === '') {
        data.current_level = null;
      } else {
        const levelNumber = Number(body.current_level);
        if (!Number.isFinite(levelNumber)) return NextResponse.json({ message: 'current_level harus berupa angka.' }, { status: 400 });
        data.current_level = levelNumber;
      }
    }

    // lampiran
    let uploadMeta = null;
    const newFile = findFileInBody(body, ['lampiran_izin_sakit', 'lampiran', 'lampiran_file', 'file', 'lampiran_izin']);
    if (newFile) {
      try {
        const res = await storageClient.uploadBufferWithPresign(newFile, { folder: 'pengajuan' });
        data.lampiran_izin_sakit_url = res.publicUrl || null;
        uploadMeta = { key: res.key, publicUrl: res.publicUrl, etag: res.etag, size: res.size };
      } catch (e) {
        return NextResponse.json({ message: 'Gagal mengunggah lampiran.', detail: e?.message || String(e) }, { status: 502 });
      }
    } else if (hasOwn(body, 'lampiran_izin_sakit_url') || hasOwn(body, 'lampiran_url') || hasOwn(body, 'lampiran') || hasOwn(body, 'lampiran_izin')) {
      const lampiran = normalizeLampiranInput(body.lampiran_izin_sakit_url ?? body.lampiran_url ?? body.lampiran ?? body.lampiran_izin);
      data.lampiran_izin_sakit_url = lampiran;
    }

    // handover/tagged users (dukung 'tag_user_ids' atau 'handover_user_ids')
    const tagUserIds = parseTagUserIds(body.tag_user_ids ?? body.handover_user_ids);
    if (tagUserIds !== undefined) await validateTaggedUsers(tagUserIds);

    if (!Object.keys(data).length && tagUserIds === undefined && approvalsInput === undefined) {
      return NextResponse.json({ message: 'Tidak ada perubahan yang dilakukan.', data: pengajuan });
    }

    const updated = await db.$transaction(async (tx) => {
      const saved = await tx.pengajuanIzinSakit.update({
        where: { id_pengajuan_izin_sakit: pengajuan.id_pengajuan_izin_sakit },
        data,
      });

      if (tagUserIds !== undefined) {
        await tx.handoverIzinSakit.deleteMany({
          where: {
            id_pengajuan_izin_sakit: saved.id_pengajuan_izin_sakit,
            ...(tagUserIds.length ? { id_user_tagged: { notIn: tagUserIds } } : {}),
          },
        });

        if (tagUserIds.length) {
          const existing = await tx.handoverIzinSakit.findMany({
            where: { id_pengajuan_izin_sakit: saved.id_pengajuan_izin_sakit, id_user_tagged: { in: tagUserIds } },
            select: { id_user_tagged: true },
          });
          const existingSet = new Set(existing.map((i) => i.id_user_tagged));
          const toCreate = tagUserIds
            .filter((id) => !existingSet.has(id))
            .map((id) => ({
              id_pengajuan_izin_sakit: saved.id_pengajuan_izin_sakit,
              id_user_tagged: id,
            }));
          if (toCreate.length) await tx.handoverIzinSakit.createMany({ data: toCreate, skipDuplicates: true });
        }
      }

      // sinkron approvals → reset decision ke 'pending' saat metadata berubah
      if (approvalsInput !== undefined) {
        const existingApprovals = await tx.approvalIzinSakit.findMany({
          where: { id_pengajuan_izin_sakit: saved.id_pengajuan_izin_sakit, deleted_at: null },
          select: { id_approval_izin_sakit: true, level: true, approver_user_id: true, approver_role: true },
        });

        const existingMap = new Map(existingApprovals.map((a) => [a.id_approval_izin_sakit, a]));
        const providedIds = new Set(approvalsInput.filter((a) => a.id).map((a) => a.id));

        const toDeleteIds = existingApprovals.filter((a) => !providedIds.has(a.id_approval_izin_sakit)).map((a) => a.id_approval_izin_sakit);
        if (toDeleteIds.length) {
          await tx.approvalIzinSakit.deleteMany({
            where: { id_pengajuan_izin_sakit: saved.id_pengajuan_izin_sakit, id_approval_izin_sakit: { in: toDeleteIds } },
          });
        }

        for (const a of approvalsInput) {
          if (a.id && existingMap.has(a.id)) {
            const cur = existingMap.get(a.id);
            const nextRole = a.approver_role ? normRole(a.approver_role) : null;
            const curRole = cur.approver_role ? normRole(cur.approver_role) : null;
            const nextUser = a.approver_user_id || null;
            const curUser = cur.approver_user_id || null;
            if (cur.level !== a.level || curUser !== nextUser || curRole !== nextRole) {
              await tx.approvalIzinSakit.update({
                where: { id_approval_izin_sakit: a.id },
                data: {
                  level: a.level,
                  approver_user_id: a.approver_user_id,
                  approver_role: a.approver_role,
                  decision: 'pending',
                  decided_at: null,
                  note: null,
                },
              });
            }
          } else {
            await tx.approvalIzinSakit.create({
              data: {
                id_pengajuan_izin_sakit: saved.id_pengajuan_izin_sakit,
                level: a.level,
                approver_user_id: a.approver_user_id,
                approver_role: a.approver_role,
                decision: 'pending',
                decided_at: null,
                note: null,
              },
            });
          }
        }

        // parent reset ke pending agar alur sesuai enum
        await tx.pengajuanIzinSakit.update({
          where: { id_pengajuan_izin_sakit: saved.id_pengajuan_izin_sakit },
          data: { status: 'pending', current_level: null },
        });
      }

      return tx.pengajuanIzinSakit.findUnique({
        where: { id_pengajuan_izin_sakit: saved.id_pengajuan_izin_sakit },
        include: baseInclude,
      });
    });

    return NextResponse.json({ message: 'Pengajuan izin sakit berhasil diperbarui.', data: updated, upload: uploadMeta || undefined });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    if (err?.code === 'P2003') return NextResponse.json({ message: 'Data referensi tidak valid.' }, { status: 400 });
    console.error('PUT /mobile/pengajuan-izin-sakit/:id error:', err);
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
    const pengajuan = await getPengajuanOr404(params?.id);
    if (pengajuan instanceof NextResponse) return pengajuan;

    if (pengajuan.id_user !== actorId && !isAdminRole(actorRole)) {
      return NextResponse.json({ message: 'Forbidden.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const hard = searchParams.get('hard');

    if (hard === '1' || hard === 'true') {
      await db.pengajuanIzinSakit.delete({ where: { id_pengajuan_izin_sakit: pengajuan.id_pengajuan_izin_sakit } });
      return NextResponse.json({ message: 'Pengajuan izin sakit dihapus permanen.', data: { id: pengajuan.id_pengajuan_izin_sakit, deleted: true, hard: true } });
    }

    await db.pengajuanIzinSakit.update({
      where: { id_pengajuan_izin_sakit: pengajuan.id_pengajuan_izin_sakit },
      data: { deleted_at: new Date() },
    });

    return NextResponse.json({ message: 'Pengajuan izin sakit berhasil dihapus.', data: { id: pengajuan.id_pengajuan_izin_sakit, deleted: true, hard: false } });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    console.error('DELETE /mobile/pengajuan-izin-sakit/:id error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export { getPengajuanOr404 };
