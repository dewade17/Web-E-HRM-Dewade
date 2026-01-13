export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { ensureAuth, paymentInclude } from '../../route';
import { parseRequestBody, findFileInBody } from '@/app/api/_utils/requestBody';
import { uploadMediaWithFallback } from '@/app/api/_utils/uploadWithFallback';
import { sendNotification } from '@/app/utils/services/notificationService';

const DECISION_ALLOWED = new Set(['disetujui', 'ditolak']);
const PENDING_DECISIONS = new Set(['pending']);

const SUPER_ROLES = new Set(['HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN']);

function normalizeRole(role) {
  return (
    String(role || '')
      .trim()
      .toUpperCase() || null
  );
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

  const decision = String(body?.decision || body?.status || '').trim();
  if (!DECISION_ALLOWED.has(decision)) {
    return NextResponse.json({ ok: false, message: "decision wajib 'disetujui' atau 'ditolak'." }, { status: 400 });
  }

  const note = !isNullLike(body?.note) ? String(body.note).trim() : null;

  // upload bukti approval (optional)
  let buktiUrl = null;
  let uploadMeta = null;
  const buktiFile = findFileInBody(body, ['bukti_approval_payment', 'bukti_approval', 'bukti', 'file']);
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
          message: 'Gaga...approval.',
          detail: e?.message || String(e),
          errors: e?.errors,
        },
        { status: e?.status || 502 }
      );
    }
  } else if (Object.prototype.hasOwnProperty.call(body, 'bukti_approval_payment_url')) {
    buktiUrl = isNullLike(body.bukti_approval_payment_url) ? null : String(body.bukti_approval_payment_url).trim();
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const approvalRecord = await tx.approvalPayment.findUnique({
        where: { id_approval_payment: id },
        include: {
          payment: {
            select: {
              id_payment: true,
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

      if (!approvalRecord.payment || approvalRecord.payment.deleted_at) {
        throw NextResponse.json({ ok: false, message: 'Payment tidak ditemukan.' }, { status: 404 });
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

      await tx.approvalPayment.update({
        where: { id_approval_payment: id },
        data: {
          decision,
          decided_at: new Date(),
          note,
          bukti_approval_payment_url: buktiUrl,
          approver_user_id: actorId,
        },
      });

      const approvals = await tx.approvalPayment.findMany({
        where: { id_payment: approvalRecord.id_payment, deleted_at: null },
        orderBy: { level: 'asc' },
        select: { level: true, decision: true },
      });

      const anyApproved = approvals.some((a) => a.decision === 'disetujui');
      const allRejected = approvals.length > 0 && approvals.every((a) => a.decision === 'ditolak');

      const highestApprovedLevel = approvals.filter((a) => a.decision === 'disetujui').reduce((max, a) => (a.level > max ? a.level : max), -1);

      const paymentUpdate = {};
      const previousStatus = approvalRecord.payment.status || null;

      if (anyApproved) {
        paymentUpdate.current_level = highestApprovedLevel >= 0 ? highestApprovedLevel : null;
        if (previousStatus !== 'disetujui') paymentUpdate.status = 'disetujui';
      } else if (allRejected) {
        paymentUpdate.current_level = null;
        if (previousStatus !== 'ditolak') paymentUpdate.status = 'ditolak';
      }

      if (Object.keys(paymentUpdate).length) {
        await tx.payment.update({
          where: { id_payment: approvalRecord.id_payment },
          data: paymentUpdate,
        });
      }

      const full = await tx.payment.findUnique({
        where: { id_payment: approvalRecord.id_payment },
        include: paymentInclude,
      });

      return {
        full,
        previousStatus,
        nowStatus: full?.status || previousStatus,
        departement: approvalRecord.payment.departement,
      };
    });

    // Notifikasi sederhana: ke supervisor departement + ke actor approver
    const notifPromises = [];
    const dept = result.departement;
    const basePayload = {
      related_table: 'payment',
      related_id: result.full?.id_payment,
      decision,
      status: result.full?.status,
      deeplink: '/payment',
    };

    if (dept?.id_supervisor) {
      notifPromises.push(sendNotification('PAYMENT_APPROVAL_DECIDED', dept.id_supervisor, basePayload));
    }
    notifPromises.push(sendNotification('PAYMENT_APPROVAL_DECIDED', actorId, basePayload));

    if (result.previousStatus !== result.nowStatus) {
      if (dept?.id_supervisor) {
        notifPromises.push(sendNotification('PAYMENT_STATUS_UPDATED', dept.id_supervisor, basePayload));
      }
      notifPromises.push(sendNotification('PAYMENT_STATUS_UPDATED', actorId, basePayload));
    }

    Promise.allSettled(notifPromises).catch(() => {});

    return NextResponse.json({ ok: true, message: 'Approval berhasil diproses.', data: result.full, upload: uploadMeta });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    console.error('PATCH /mobile/payment/approvals/[id] error:', err);
    return NextResponse.json({ ok: false, message: err?.message || 'Gagal memproses approval.' }, { status: err?.status || 500 });
  }
}

export async function PATCH(req, ctx) {
  return handleDecision(req, ctx || {});
}

export async function PUT(req, ctx) {
  return handleDecision(req, ctx || {});
}
