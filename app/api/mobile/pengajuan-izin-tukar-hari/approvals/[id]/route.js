import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { ensureAuth, baseInclude } from '../../route';
import { sendNotification } from '@/app/utils/services/notificationService';
import { applyShiftSwapForIzinTukarHari } from '../../helpers/shiftAdjuster';

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
    ...baseInclude,
    approvals: {
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
    return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
  }

  const approvalId = params?.approvalId;
  if (!approvalId) {
    return NextResponse.json({ message: 'approvalId wajib diisi.' }, { status: 400 });
  }

  let body;
  try {
    body = await req.json();
  } catch (err) {
    return NextResponse.json({ message: 'Body request harus berupa JSON.' }, { status: 400 });
  }

  const decision = normalizeDecision(body?.decision);
  if (!decision) {
    return NextResponse.json({ message: 'decision harus berupa disetujui atau ditolak.' }, { status: 400 });
  }

  const note = body?.note === undefined || body?.note === null ? null : String(body.note);

  try {
    const result = await db.$transaction(async (tx) => {
      const approvalRecord = await tx.approvalIzinTukarHari.findUnique({
        where: { id_approval_izin_tukar_hari: approvalId },
        include: {
          izin_tukar_hari: {
            select: {
              id_izin_tukar_hari: true,
              id_user: true,
              hari_izin: true,
              hari_pengganti: true,
              status: true,
              current_level: true,
              deleted_at: true,
            },
          },
        },
      });

      if (!approvalRecord || approvalRecord.deleted_at) {
        throw NextResponse.json({ message: 'Approval tidak ditemukan.' }, { status: 404 });
      }

      if (!approvalRecord.izin_tukar_hari || approvalRecord.izin_tukar_hari.deleted_at) {
        throw NextResponse.json({ message: 'Pengajuan tidak ditemukan.' }, { status: 404 });
      }

      const matchesUser = approvalRecord.approver_user_id && approvalRecord.approver_user_id === actorId;
      const matchesRole = approvalRecord.approver_role && normalizeRole(approvalRecord.approver_role) === actorRole;

      if (!matchesUser && !matchesRole) {
        throw NextResponse.json({ message: 'Anda tidak memiliki akses untuk approval ini.' }, { status: 403 });
      }

      if (!PENDING_DECISIONS.has(approvalRecord.decision)) {
        throw NextResponse.json({ message: 'Approval sudah memiliki keputusan.' }, { status: 409 });
      }

      const updatedApproval = await tx.approvalIzinTukarHari.update({
        where: { id_approval_izin_tukar_hari: approvalId },
        data: {
          decision,
          note,
          decided_at: new Date(),
        },
        select: {
          id_approval_izin_tukar_hari: true,
          id_izin_tukar_hari: true,
          level: true,
          decision: true,
          note: true,
          decided_at: true,
        },
      });

      const approvals = await tx.approvalIzinTukarHari.findMany({
        where: { id_izin_tukar_hari: approvalRecord.id_izin_tukar_hari, deleted_at: null },
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
      });

      const { anyApproved, allRejected, highestApprovedLevel } = summarizeApprovalStatus(approvals);
      const parentUpdate = {};
      const previousStatus = approvalRecord.izin_tukar_hari.status;

      if (anyApproved) {
        if (previousStatus !== 'disetujui') {
          parentUpdate.status = 'disetujui';
        }
        if (typeof highestApprovedLevel === 'number' && approvalRecord.izin_tukar_hari.current_level !== highestApprovedLevel) {
          parentUpdate.current_level = highestApprovedLevel;
        }
      } else if (allRejected) {
        parentUpdate.status = 'ditolak';
        parentUpdate.current_level = null;
      }

      let submission;
      let shiftAdjustmentResult = null;
      if (Object.keys(parentUpdate).length) {
        submission = await tx.izinTukarHari.update({
          where: { id_izin_tukar_hari: approvalRecord.id_izin_tukar_hari },
          data: parentUpdate,
          include: buildInclude(),
        });
      } else {
        submission = await tx.izinTukarHari.findUnique({
          where: { id_izin_tukar_hari: approvalRecord.id_izin_tukar_hari },
          include: buildInclude(),
        });
      }
      if (decision === 'disetujui' && previousStatus !== 'disetujui') {
        try {
          shiftAdjustmentResult = await applyShiftSwapForIzinTukarHari(tx, approvalRecord.izin_tukar_hari);
        } catch (shiftErr) {
          console.error('Gagal memperbarui shift tukar hari:', shiftErr);
          shiftAdjustmentResult = {
            adjustments: [],
            issues: [
              {
                message: 'Terjadi kesalahan saat memperbarui jadwal shift pemohon.',
                detail: shiftErr?.message || String(shiftErr),
              },
            ],
          };
        }
      }

      return { submission, approval: updatedApproval, shiftAdjustment: shiftAdjustmentResult };
    });

    const submission = result?.submission;
    const approval = result?.approval;
    const shiftAdjustment = result?.shiftAdjustment;
    let responseData = submission;
    if (submission) {
      responseData = {
        ...submission,
        ...(shiftAdjustment?.adjustments?.length ? { shift_adjustments: shiftAdjustment.adjustments } : {}),
        ...(shiftAdjustment?.issues?.length ? { shift_adjustment_issues: shiftAdjustment.issues } : {}),
      };
    } else if (shiftAdjustment) {
      responseData = {
        ...(shiftAdjustment?.adjustments?.length ? { shift_adjustments: shiftAdjustment.adjustments } : {}),
        ...(shiftAdjustment?.issues?.length ? { shift_adjustment_issues: shiftAdjustment.issues } : {}),
      };
    }

    if (submission?.id_user) {
      const decisionDisplay = decision === 'disetujui' ? 'disetujui' : 'ditolak';
      const overrideTitle = `Pengajuan izin tukar hari ${decisionDisplay}`;
      const overrideBody = `Pengajuan izin tukar hari Anda telah ${decisionDisplay}.`;
      const deeplink = `/pengajuan-izin-tukar-hari/${submission.id_izin_tukar_hari}`;

      await sendNotification(
        'IZIN_TUKAR_HARI_APPROVAL_DECIDED',
        submission.id_user,
        {
          decision,
          note: approval?.note || undefined,
          approval_level: approval?.level,
          related_table: 'izin_tukar_hari',
          related_id: submission.id_izin_tukar_hari,
          shift_adjustments: shiftAdjustment?.adjustments,
          shift_adjustment_issues: shiftAdjustment?.issues,
          overrideTitle,
          overrideBody,
        },
        { deeplink }
      );
    }

    return NextResponse.json({ message: 'Keputusan approval berhasil disimpan.', data: responseData });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    console.error('PATCH /mobile/pengajuan-izin-tukar-hari/approvals error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function PATCH(req, ctx) {
  return handleDecision(req, ctx || {});
}

export async function PUT(req, ctx) {
  return handleDecision(req, ctx || {});
}
