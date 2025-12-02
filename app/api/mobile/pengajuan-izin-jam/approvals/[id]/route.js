import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { ensureAuth, baseInclude } from '../../route';
import { sendNotification } from '@/app/utils/services/notificationService';

const DECISION_ALLOWED = new Set(['disetujui', 'ditolak']);
const PENDING_DECISIONS = new Set(['pending']); // selaras Prisma

// --- Helper Roles ---
const SUPER_ROLES = new Set(['HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN']);

function normalizeRole(role) {
  return String(role || '')
    .trim()
    .toUpperCase();
}

function isSuperAdmin(role) {
  return SUPER_ROLES.has(normalizeRole(role));
}
// --------------------

function normalizeDecision(value) {
  if (!value) return null;
  const s = String(value).trim().toLowerCase();
  return DECISION_ALLOWED.has(s) ? s : null;
}

function buildInclude() {
  return {
    ...baseInclude,
    approvals: {
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
}

function summarizeApprovalStatus(approvals) {
  const approved = approvals.filter((i) => i.decision === 'disetujui');
  const anyApproved = approved.length > 0;
  const allRejected = approvals.length > 0 && approvals.every((i) => i.decision === 'ditolak');

  // Ambil level tertinggi yang sudah approve untuk tracking current_level
  const highestApprovedLevel = anyApproved ? approved.reduce((acc, c) => Math.max(acc, c.level), approved[0].level) : null;

  return { anyApproved, allRejected, highestApprovedLevel };
}

async function handleDecision(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth?.actor?.id;
  const actorRole = normalizeRole(auth?.actor?.role);
  if (!actorId) return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });

  const id = params?.id;
  if (!id) return NextResponse.json({ message: 'id wajib diisi.' }, { status: 400 });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: 'Body request harus berupa JSON.' }, { status: 400 });
  }

  const decision = normalizeDecision(body?.decision);
  if (!decision) return NextResponse.json({ message: 'decision harus berupa disetujui atau ditolak.' }, { status: 400 });
  const note = body?.note === undefined || body?.note === null ? null : String(body.note);

  try {
    const result = await db.$transaction(async (tx) => {
      const approvalRecord = await tx.approvalPengajuanIzinJam.findUnique({
        where: { id_approval_pengajuan_izin_jam: id },
        include: {
          pengajuan_izin_jam: {
            select: { id_pengajuan_izin_jam: true, id_user: true, status: true, current_level: true, deleted_at: true },
          },
        },
      });

      if (!approvalRecord || approvalRecord.deleted_at) throw NextResponse.json({ message: 'Approval tidak ditemukan.' }, { status: 404 });
      if (!approvalRecord.pengajuan_izin_jam || approvalRecord.pengajuan_izin_jam.deleted_at) {
        throw NextResponse.json({ message: 'Pengajuan tidak ditemukan.' }, { status: 404 });
      }

      // Validasi Akses: User Match ATAU Role Match ATAU Super Admin Bypass
      const matchesUser = approvalRecord.approver_user_id && approvalRecord.approver_user_id === actorId;
      const matchesRole = approvalRecord.approver_role && normalizeRole(approvalRecord.approver_role) === actorRole;
      const isAdminBypass = isSuperAdmin(actorRole);

      if (!matchesUser && !matchesRole && !isAdminBypass) {
        throw NextResponse.json({ message: 'Anda tidak memiliki akses untuk approval ini.' }, { status: 403 });
      }

      if (!PENDING_DECISIONS.has(approvalRecord.decision)) {
        throw NextResponse.json({ message: 'Approval sudah memiliki keputusan.' }, { status: 409 });
      }

      const updatedApproval = await tx.approvalPengajuanIzinJam.update({
        where: { id_approval_pengajuan_izin_jam: id },
        data: {
          decision,
          note,
          decided_at: new Date(),
          // Catat siapa yang sebenarnya melakukan approval (berguna jika bypass admin)
          approver_user_id: actorId,
        },
        select: {
          id_approval_pengajuan_izin_jam: true,
          id_pengajuan_izin_jam: true,
          level: true,
          decision: true,
          note: true,
          decided_at: true,
        },
      });

      const approvals = await tx.approvalPengajuanIzinJam.findMany({
        where: { id_pengajuan_izin_jam: approvalRecord.id_pengajuan_izin_jam, deleted_at: null },
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
      });

      const { anyApproved, allRejected, highestApprovedLevel } = summarizeApprovalStatus(approvals);
      const parentUpdate = {};

      const previousStatus = approvalRecord.pengajuan_izin_jam.status;

      if (anyApproved) {
        parentUpdate.current_level = highestApprovedLevel;
        // Logic Bebas: Jika ada 1 yang setuju, status parent jadi disetujui (jika belum)
        if (previousStatus !== 'disetujui') {
          parentUpdate.status = 'disetujui';
        }
      } else if (allRejected) {
        parentUpdate.current_level = null;
        if (previousStatus !== 'ditolak') {
          parentUpdate.status = 'ditolak';
        }
      }

      let submission;
      if (Object.keys(parentUpdate).length) {
        submission = await tx.pengajuanIzinJam.update({
          where: { id_pengajuan_izin_jam: approvalRecord.id_pengajuan_izin_jam },
          data: parentUpdate,
          include: buildInclude(),
        });
      } else {
        submission = await tx.pengajuanIzinJam.findUnique({
          where: { id_pengajuan_izin_jam: approvalRecord.id_pengajuan_izin_jam },
          include: buildInclude(),
        });
      }

      return { submission, approval: updatedApproval };
    });

    const submission = result?.submission;
    const approval = result?.approval;

    if (submission?.id_user) {
      const decisionDisplay = decision === 'disetujui' ? 'disetujui' : 'ditolak';
      const overrideTitle = `Pengajuan izin jam ${decisionDisplay}`;
      const overrideBody = `Pengajuan izin jam Anda telah ${decisionDisplay}.`;
      const deeplink = `/pengajuan-izin-jam/${submission.id_pengajuan_izin_jam}`;

      await sendNotification(
        'IZIN_JAM_APPROVAL_DECIDED',
        submission.id_user,
        {
          decision,
          note: approval?.note || undefined,
          approval_level: approval?.level,
          related_table: 'pengajuan_izin_jam',
          related_id: submission.id_pengajuan_izin_jam,
          overrideTitle,
          overrideBody,
        },
        { deeplink }
      );
    }

    return NextResponse.json({ message: 'Keputusan approval berhasil disimpan.', data: submission });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    console.error('PATCH /mobile/pengajuan-izin-jam/approvals error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function PATCH(req, ctx) {
  return handleDecision(req, ctx || {});
}
export async function PUT(req, ctx) {
  return handleDecision(req, ctx || {});
}
