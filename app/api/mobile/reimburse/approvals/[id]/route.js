export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { ensureAuth, reimburseInclude } from '../../route';
import { parseRequestBody, findFileInBody } from '@/app/api/_utils/requestBody';
import { uploadMediaWithFallback } from '@/app/api/_utils/uploadWithFallback';
import { sendNotification } from '@/app/utils/services/notificationService';

const DECISION_ALLOWED = new Set(['disetujui', 'ditolak']);
const PENDING_DECISIONS = new Set(['pending']);

const SUPER_ROLES = new Set(['HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN']);

function normalizeRole(role) {
  return String(role || '')
    .trim()
    .toUpperCase();
}

function isSuperAdmin(role) {
  return SUPER_ROLES.has(normalizeRole(role));
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

function normalizeDecision(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim().toLowerCase();
  return DECISION_ALLOWED.has(s) ? s : null;
}

function normalizeNote(value) {
  if (value === undefined) return undefined;
  if (isNullLike(value)) return null;
  return String(value);
}

async function handleDecision(req, ctx) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  const actorRole = normalizeRole(auth.actor?.role);
  const id = ctx?.params?.id ? String(ctx.params.id).trim() : null;

  if (!actorId) return NextResponse.json({ ok: false, message: 'Unauthorized.' }, { status: 401 });
  if (!id) return NextResponse.json({ ok: false, message: 'id wajib diisi.' }, { status: 400 });

  let body;
  try {
    const result = await parseRequestBody(req);
    body = result.body;
  } catch (err) {
    return NextResponse.json({ ok: false, message: err?.message || 'Body tidak valid.' }, { status: err?.status || 400 });
  }

  const decision = normalizeDecision(body?.decision);
  if (!decision) {
    return NextResponse.json({ ok: false, message: "Field 'decision' wajib diisi dengan nilai disetujui atau ditolak." }, { status: 400 });
  }

  const note = normalizeNote(body?.note);

  let buktiUrl = undefined;
  let uploadMeta = null;

  const buktiFile = findFileInBody(body, ['bukti_approval', 'bukti', 'bukti_approval_reimburse', 'bukti_approval_reimburse_url', 'bukti_url']);
  if (buktiFile) {
    try {
      const uploaded = await uploadMediaWithFallback(buktiFile, {
        storageFolder: 'financial',
        supabasePrefix: 'financial',
        pathSegments: [String(actorId)],
      });

      buktiUrl = uploaded.publicUrl || null;

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
      return NextResponse.json(
        {
          ok: false,
          message: 'Gagal mengunggah bukti approval.',
          detail: e?.message || String(e),
          errors: e?.errors,
        },
        { status: e?.status || 502 }
      );
    }
  } else if (Object.prototype.hasOwnProperty.call(body, 'bukti_approval_reimburse_url')) {
    buktiUrl = isNullLike(body.bukti_approval_reimburse_url) ? null : String(body.bukti_approval_reimburse_url).trim();
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const approvalRecord = await tx.approvalReimburse.findUnique({
        where: { id_approval_reimburse: id },
        include: {
          reimburse: {
            select: {
              id_reimburse: true,
              id_departement: true,
              status: true,
              current_level: true,
              deleted_at: true,
              departement: {
                select: {
                  id_departement: true,
                  nama_departement: true,
                  id_supervisor: true,
                },
              },
            },
          },
        },
      });

      if (!approvalRecord || approvalRecord.deleted_at) {
        throw NextResponse.json({ ok: false, message: 'Approval tidak ditemukan.' }, { status: 404 });
      }

      if (!approvalRecord.reimburse || approvalRecord.reimburse.deleted_at) {
        throw NextResponse.json({ ok: false, message: 'Reimburse tidak ditemukan.' }, { status: 404 });
      }

      const matchesUser = approvalRecord.approver_user_id && approvalRecord.approver_user_id === actorId;
      const matchesRole = approvalRecord.approver_role && normalizeRole(approvalRecord.approver_role) === actorRole;
      const bypass = isSuperAdmin(actorRole);

      if (!matchesUser && !matchesRole && !bypass) {
        throw NextResponse.json({ ok: false, message: 'Anda tidak memiliki akses untuk approval ini.' }, { status: 403 });
      }

      if (!PENDING_DECISIONS.has(approvalRecord.decision)) {
        throw NextResponse.json({ ok: false, message: 'Approval sudah memiliki keputusan.' }, { status: 409 });
      }

      await tx.approvalReimburse.update({
        where: { id_approval_reimburse: id },
        data: {
          decision,
          note: note === undefined ? approvalRecord.note : note,
          decided_at: new Date(),
          approver_user_id: actorId,
          ...(buktiUrl !== undefined ? { bukti_approval_reimburse_url: buktiUrl } : {}),
        },
      });

      const approvals = await tx.approvalReimburse.findMany({
        where: { id_reimburse: approvalRecord.id_reimburse, deleted_at: null },
        orderBy: { level: 'asc' },
        select: { level: true, decision: true },
      });

      const anyApproved = approvals.some((a) => a.decision === 'disetujui');
      const allRejected = approvals.length > 0 && approvals.every((a) => a.decision === 'ditolak');

      const highestApprovedLevel = approvals.filter((a) => a.decision === 'disetujui').reduce((max, a) => (a.level > max ? a.level : max), -1);

      const reimburseUpdate = {};
      const previousStatus = approvalRecord.reimburse.status || null;

      if (anyApproved) {
        reimburseUpdate.current_level = highestApprovedLevel >= 0 ? highestApprovedLevel : null;
        if (previousStatus !== 'disetujui') reimburseUpdate.status = 'disetujui';
      } else if (allRejected) {
        reimburseUpdate.current_level = null;
        if (previousStatus !== 'ditolak') reimburseUpdate.status = 'ditolak';
      }

      if (Object.keys(reimburseUpdate).length) {
        await tx.reimburse.update({
          where: { id_reimburse: approvalRecord.id_reimburse },
          data: reimburseUpdate,
        });
      }

      const full = await tx.reimburse.findUnique({
        where: { id_reimburse: approvalRecord.id_reimburse },
        include: reimburseInclude,
      });

      return { full, previousStatus, nowStatus: full?.status || previousStatus, departement: approvalRecord.reimburse.departement };
    });

    // Notifikasi sederhana: ke supervisor departement (jika ada) + ke actor
    const notifPromises = [];
    const dept = result.departement;
    const basePayload = {
      related_table: 'reimburse',
      related_id: result.full?.id_reimburse,
      nama_departement: dept?.nama_departement || '-',
      id_departement: dept?.id_departement || null,
      status: result.full?.status,
      deeplink: '/reimburse',
    };

    notifPromises.push(
      sendNotification(
        'REIMBURSE_APPROVAL_DECIDED',
        actorId,
        {
          ...basePayload,
          overrideTitle: 'Keputusan approval tersimpan',
          overrideBody: `Keputusan approval reimburse berhasil disimpan.`,
        },
        { deeplink: '/reimburse' }
      )
    );

    if (dept?.id_supervisor && dept.id_supervisor !== actorId) {
      notifPromises.push(
        sendNotification(
          'REIMBURSE_STATUS_UPDATED',
          dept.id_supervisor,
          {
            ...basePayload,
            overrideTitle: 'Status reimburse diperbarui',
            overrideBody: `Status reimburse departement ${basePayload.nama_departement} kini: ${basePayload.status}.`,
          },
          { deeplink: '/reimburse' }
        )
      );
    }

    if (notifPromises.length) await Promise.allSettled(notifPromises);

    return NextResponse.json({
      ok: true,
      message: 'Keputusan approval berhasil disimpan.',
      data: result.full || null,
      upload: uploadMeta,
    });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    console.error('PATCH /mobile/reimburse/approvals/[id] error:', err);
    return NextResponse.json({ ok: false, message: 'Gagal menyimpan keputusan approval.' }, { status: 500 });
  }
}

export async function PATCH(req, ctx) {
  return handleDecision(req, ctx || {});
}

export async function PUT(req, ctx) {
  return handleDecision(req, ctx || {});
}
