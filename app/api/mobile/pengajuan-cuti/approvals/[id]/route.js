import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { ensureAuth, pengajuanInclude } from '../../route';
import { sendNotification } from '@/app/utils/services/notificationService';

const DECISION_ALLOWED = new Set(['disetujui', 'ditolak']);
const PENDING_DECISIONS = new Set(['pending', 'menunggu']);

function normalizeDecision(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  return DECISION_ALLOWED.has(normalized) ? normalized : null;
}

function normalizeRole(role) {
  return String(role || '')
    .trim()
    .toUpperCase();
}

function buildInclude() {
  return {
    ...pengajuanInclude,
    approvals: {
      orderBy: { level: 'asc' },
      select: {
        id_approval_pengajuan_cuti: true,
        level: true,
        approver_user_id: true,
        approver_role: true,
        decision: true,
        decided_at: true,
        note: true,
      },
    },
  };
}

function summarizeApprovalStatus(approvals) {
  const approved = approvals.filter((item) => item.decision === 'disetujui');
  const anyApproved = approved.length > 0;
  const allRejected = approvals.length > 0 && approvals.every((item) => item.decision === 'ditolak');
  const highestApprovedLevel = anyApproved ? approved.reduce((acc, curr) => (curr.level > acc ? curr.level : acc), approved[0].level) : null;

  return { anyApproved, allRejected, highestApprovedLevel };
}

async function handleDecision(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth?.actor?.id;
  const actorRole = normalizeRole(auth?.actor?.role);
  if (!actorId) {
    return NextResponse.json({ ok: false, message: 'Unauthorized.' }, { status: 401 });
  }

  const id = params?.id;
  if (!id) {
    return NextResponse.json({ ok: false, message: 'id wajib diisi.' }, { status: 400 });
  }

  let body;
  try {
    body = await req.json();
  } catch (err) {
    return NextResponse.json({ ok: false, message: 'Body request harus berupa JSON.' }, { status: 400 });
  }

  const decision = normalizeDecision(body?.decision);
  if (!decision) {
    return NextResponse.json({ ok: false, message: 'decision harus diisi dengan nilai disetujui atau ditolak.' }, { status: 400 });
  }

  const note = body?.note === undefined || body?.note === null ? null : String(body.note);

  try {
    const result = await db.$transaction(async (tx) => {
      const approvalRecord = await tx.approvalPengajuanCuti.findUnique({
        where: { id_approval_pengajuan_cuti: id },
        include: {
          pengajuan_cuti: {
            select: {
              id_pengajuan_cuti: true,
              id_user: true,
              status: true,
              current_level: true,
              deleted_at: true,
            },
          },
        },
      });

      if (!approvalRecord || approvalRecord.deleted_at) {
        throw NextResponse.json({ ok: false, message: 'Approval tidak ditemukan.' }, { status: 404 });
      }

      if (!approvalRecord.pengajuan_cuti || approvalRecord.pengajuan_cuti.deleted_at) {
        throw NextResponse.json({ ok: false, message: 'Pengajuan tidak ditemukan.' }, { status: 404 });
      }

      const matchesUser = approvalRecord.approver_user_id && approvalRecord.approver_user_id === actorId;
      const matchesRole = approvalRecord.approver_role && normalizeRole(approvalRecord.approver_role) === actorRole;

      if (!matchesUser && !matchesRole) {
        throw NextResponse.json({ ok: false, message: 'Anda tidak memiliki akses untuk approval ini.' }, { status: 403 });
      }

      if (!PENDING_DECISIONS.has(approvalRecord.decision)) {
        throw NextResponse.json({ ok: false, message: 'Approval sudah memiliki keputusan.' }, { status: 409 });
      }

      const updatedApproval = await tx.approvalPengajuanCuti.update({
        where: { id_approval_pengajuan_cuti: id },
        data: {
          decision,
          note,
          decided_at: new Date(),
        },
        select: {
          id_approval_pengajuan_cuti: true,
          id_pengajuan_cuti: true,
          level: true,
          decision: true,
          note: true,
          decided_at: true,
        },
      });

      const approvals = await tx.approvalPengajuanCuti.findMany({
        where: { id_pengajuan_cuti: approvalRecord.id_pengajuan_cuti, deleted_at: null },
        orderBy: { level: 'asc' },
        select: {
          id_approval_pengajuan_cuti: true,
          level: true,
          approver_user_id: true,
          approver_role: true,
          decision: true,
          decided_at: true,
          note: true,
        },
      });

      const { anyApproved, allRejected, highestApprovedLevel } = summarizeApprovalStatus(approvals);
      const parentUpdate = {};

      if (anyApproved) {
        parentUpdate.status = 'disetujui';
        parentUpdate.current_level = highestApprovedLevel;
      } else if (allRejected) {
        parentUpdate.status = 'ditolak';
        parentUpdate.current_level = null;
      }

      let submission;
      if (Object.keys(parentUpdate).length) {
        submission = await tx.pengajuanCuti.update({
          where: { id_pengajuan_cuti: approvalRecord.id_pengajuan_cuti },
          data: parentUpdate,
          include: buildInclude(),
        });
      } else {
        submission = await tx.pengajuanCuti.findUnique({
          where: { id_pengajuan_cuti: approvalRecord.id_pengajuan_cuti },
          include: buildInclude(),
        });
      }

      return { submission, approval: updatedApproval };
    });

    const submission = result?.submission;
    const approval = result?.approval;

    if (submission?.id_user) {
      const decisionDisplay = decision === 'disetujui' ? 'disetujui' : 'ditolak';
      const overrideTitle = `Pengajuan cuti ${decisionDisplay}`;
      const overrideBody = `Pengajuan cuti Anda telah ${decisionDisplay}.`;
      const deeplink = `/pengajuan-cuti/${submission.id_pengajuan_cuti}`;

      await sendNotification(
        'LEAVE_APPROVAL_DECIDED',
        submission.id_user,
        {
          decision,
          note: approval?.note || undefined,
          approval_level: approval?.level,
          related_table: 'pengajuan_cuti',
          related_id: submission.id_pengajuan_cuti,
          overrideTitle,
          overrideBody,
        },
        { deeplink }
      );
    }

    return NextResponse.json({
      ok: true,
      message: 'Keputusan approval berhasil disimpan.',
      data: submission,
    });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    console.error('PATCH /mobile/pengajuan-cuti/approvals error:', err);
    return NextResponse.json({ ok: false, message: 'Terjadi kesalahan saat memproses approval.' }, { status: 500 });
  }
}

export async function PATCH(req, ctx) {
  return handleDecision(req, ctx || {});
}

export async function PUT(req, ctx) {
  return handleDecision(req, ctx || {});
}
