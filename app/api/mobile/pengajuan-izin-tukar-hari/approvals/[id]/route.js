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

function parseShiftPatternOverrides(rawOverrides) {
  if (rawOverrides === undefined || rawOverrides === null) {
    return { overrides: {}, errors: [] };
  }

  if (typeof rawOverrides !== 'object' || Array.isArray(rawOverrides)) {
    return { overrides: {}, errors: ['shift_overrides harus berupa objek.'] };
  }

  const overrides = {};
  const errors = [];

  const targets = [
    { key: 'hari_izin', label: 'hari_izin' },
    { key: 'hari_pengganti', label: 'hari_pengganti' },
  ];

  for (const { key, label } of targets) {
    if (!(key in rawOverrides)) continue;
    const payload = rawOverrides[key];

    if (payload === null || payload === undefined) {
      errors.push(`shift_overrides.${label}.id_pola_kerja wajib diisi.`);
      continue;
    }

    let rawId = payload;
    if (typeof payload === 'object' && !Array.isArray(payload)) {
      if (!Object.prototype.hasOwnProperty.call(payload, 'id_pola_kerja')) {
        errors.push(`shift_overrides.${label}.id_pola_kerja wajib diisi.`);
        continue;
      }
      rawId = payload.id_pola_kerja;
    }

    if (rawId === null || rawId === undefined) {
      errors.push(`shift_overrides.${label}.id_pola_kerja wajib diisi.`);
      continue;
    }

    const normalized = String(rawId).trim();
    if (!normalized) {
      errors.push(`shift_overrides.${label}.id_pola_kerja tidak boleh kosong.`);
      continue;
    }

    overrides[key] = { provided: true, value: normalized };
  }

  return { overrides, errors };
}

function enrichAdjustmentsWithPolaKerja(adjustments, polaKerjaMap) {
  if (!Array.isArray(adjustments) || !adjustments.length) return adjustments;
  if (!polaKerjaMap || !(polaKerjaMap instanceof Map) || polaKerjaMap.size === 0) return adjustments;

  return adjustments.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const appliedId = item.applied_pola_kerja_id;
    if (!appliedId) return item;
    const polaInfo = polaKerjaMap.get(appliedId);
    if (!polaInfo) return item;
    return { ...item, applied_pola_kerja: polaInfo };
  });
}

async function handleDecision(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth?.actor?.id;
  const actorRole = normalizeRole(auth?.actor?.role);
  if (!actorId) {
    return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
  }

  const id = params?.id;
  if (!id) {
    return NextResponse.json({ message: 'id wajib diisi.' }, { status: 400 });
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

  const { overrides: shiftOverrideInput, errors: shiftOverrideErrors } = parseShiftPatternOverrides(body?.shift_overrides);
  if (shiftOverrideErrors.length) {
    return NextResponse.json({ message: 'Input shift_overrides tidak valid.', errors: shiftOverrideErrors }, { status: 400 });
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const approvalRecord = await tx.approvalIzinTukarHari.findUnique({
        where: { id_approval_izin_tukar_hari: id },
        include: {
          // Pull only the scalar fields needed on the parent submission and
          // include the related pairs.  The scalar hari_izin/hari_pengganti
          // fields were removed from the model, so we rely on the first
          // element of the pairs array to determine the affected dates.
          izin_tukar_hari: {
            select: {
              id_izin_tukar_hari: true,
              id_user: true,
              status: true,
              current_level: true,
              deleted_at: true,
              pairs: {
                select: {
                  hari_izin: true,
                  hari_pengganti: true,
                },
                orderBy: { hari_izin: 'asc' },
              },
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
        where: { id_approval_izin_tukar_hari: id },
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
      let polaKerjaMap = new Map();

      const overrideIds = Object.values(shiftOverrideInput || {})
        .filter((item) => item && item.provided && item.value)
        .map((item) => item.value);

      if (overrideIds.length) {
        const uniqueOverrideIds = Array.from(new Set(overrideIds));
        const polaKerjaList = await tx.polaKerja.findMany({
          where: { id_pola_kerja: { in: uniqueOverrideIds } },
          select: { id_pola_kerja: true, nama_pola_kerja: true },
        });

        const foundIds = new Set(polaKerjaList.map((item) => item.id_pola_kerja));
        const missing = uniqueOverrideIds.filter((id) => !foundIds.has(id));
        if (missing.length) {
          throw NextResponse.json(
            {
              message: 'Pola kerja yang diminta tidak ditemukan.',
              missing_pola_kerja_ids: missing,
            },
            { status: 400 }
          );
        }

        polaKerjaMap = new Map(polaKerjaList.map((item) => [item.id_pola_kerja, { id: item.id_pola_kerja, nama: item.nama_pola_kerja }]));
      }
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
          shiftAdjustmentResult = await applyShiftSwapForIzinTukarHari(tx, approvalRecord.izin_tukar_hari, shiftOverrideInput);

          const appliedIds = Array.from(new Set((shiftAdjustmentResult?.adjustments || []).map((item) => item?.applied_pola_kerja_id).filter((value) => typeof value === 'string' && value.length))).filter((id) => !polaKerjaMap.has(id));

          if (appliedIds.length) {
            const polaKerjaFromAdjustments = await tx.polaKerja.findMany({
              where: { id_pola_kerja: { in: appliedIds } },
              select: { id_pola_kerja: true, nama_pola_kerja: true },
            });
            for (const item of polaKerjaFromAdjustments) {
              polaKerjaMap.set(item.id_pola_kerja, {
                id: item.id_pola_kerja,
                nama: item.nama_pola_kerja,
              });
            }
          }

          if (shiftAdjustmentResult && Array.isArray(shiftAdjustmentResult.adjustments)) {
            shiftAdjustmentResult.adjustments = enrichAdjustmentsWithPolaKerja(shiftAdjustmentResult.adjustments, polaKerjaMap);
          }
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
