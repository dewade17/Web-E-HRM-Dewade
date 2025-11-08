import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { ensureAuth, pengajuanInclude } from '../../route';
import { sendNotification } from '@/app/utils/services/notificationService';

const DECISION_ALLOWED = new Set(['disetujui', 'ditolak']);
const PENDING_DECISIONS = new Set(['pending', 'menunggu']);

// --- (Fungsi-fungsi helper) ---

const DEFAULT_SHIFT_SYNC_RESULT = Object.freeze({
  updatedCount: 0,
  createdCount: 0,
  affectedDates: [],
  returnShift: null,
});

function createDefaultShiftSyncResult() {
  return {
    ...DEFAULT_SHIFT_SYNC_RESULT,
    affectedDates: [],
    returnShift: null,
  };
}

const dateDisplayFormatter = new Intl.DateTimeFormat('id-ID', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

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

/**
 * Helper untuk mendapatkan tanggal cuti pertama (sebagai 'tanggal_mulai' turunan)
 * dari relasi tanggal_list.
 * @param {Array<{tanggal_cuti: Date}>} tanggalList - Array objek dari relasi
 */
function getFirstDateFromList(tanggalList) {
  if (!Array.isArray(tanggalList) || tanggalList.length === 0) {
    return null;
  }
  // 'pengajuanInclude' sudah mengurutkan 'tanggal_list' asc
  const firstEntry = tanggalList[0];
  const firstDate = firstEntry?.tanggal_cuti;

  if (firstDate instanceof Date) {
    return firstDate;
  }
  if (firstDate) {
    try {
      const d = new Date(firstDate);
      if (!Number.isNaN(d.getTime())) return d;
    } catch (_) {}
  }

  // Fallback jika data tidak terurut atau formatnya aneh
  const dates = tanggalList
    .map((d) => (d?.tanggal_cuti ? (d.tanggal_cuti instanceof Date ? d.tanggal_cuti : new Date(d.tanggal_cuti)) : null))
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime()); // Gunakan .getTime() untuk perbandingan Date
  return dates.length ? dates[0] : null;
}

/**
 * Memastikan 'tanggal_list' diambil saat memuat data pengajuan.
 */
function buildInclude() {
  return {
    ...pengajuanInclude, // 'pengajuanInclude' dari route.js sudah berisi 'tanggal_list'
    approvals: {
      where: { deleted_at: null }, // konsisten dengan include lain
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

function toDateOnly(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date, amount) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + amount);
  return result;
}

function formatDateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function formatDateDisplay(value) {
  const date = toDateOnly(value);
  if (!date) return '-';
  try {
    return dateDisplayFormatter.format(date);
  } catch (err) {
    return formatDateKey(date);
  }
}

function parseReturnShiftPayload(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object') {
    throw NextResponse.json({ ok: false, message: 'return_shift harus berupa objek.' }, { status: 400 });
  }

  const { date, id_pola_kerja: idPolaKerjaRaw } = raw;
  const parsedDate = toDateOnly(date);
  if (!parsedDate) {
    throw NextResponse.json({ ok: false, message: 'return_shift.date wajib berisi tanggal valid (format YYYY-MM-DD).' }, { status: 400 });
  }
  if (!idPolaKerjaRaw) {
    throw NextResponse.json({ ok: false, message: 'return_shift.id_pola_kerja wajib diisi saat return_shift dikirim.' }, { status: 400 });
  }
  const idPolaKerja = String(idPolaKerjaRaw);
  return { date: parsedDate, idPolaKerja };
}

function getShiftOverlapRange(shift, rangeStart, rangeEnd) {
  const start = shift?.tanggal_mulai ? toDateOnly(shift.tanggal_mulai) : null;
  const endRaw = shift?.tanggal_selesai ? toDateOnly(shift.tanggal_selesai) : null;
  const startDate = start || endRaw || rangeStart;
  const endDate = endRaw || start || rangeEnd;
  if (!startDate || !endDate) return null;

  if (endDate < rangeStart) return null;
  if (startDate > rangeEnd) return null;

  const overlapStart = startDate < rangeStart ? rangeStart : startDate;
  const overlapEnd = endDate > rangeEnd ? rangeEnd : endDate;

  if (overlapStart > overlapEnd) return null;
  return { start: overlapStart, end: overlapEnd };
}

/**
 * Fungsi ini menerima 'startDate' (tanggal cuti pertama, turunan) dan
 * 'returnDate' (tanggal masuk kerja, dari skema).
 */
async function syncShiftLiburForApprovedLeave(tx, { userId, startDate, returnDate, returnShift }) {
  if (!tx || !userId || !startDate) return createDefaultShiftSyncResult();

  const leaveStart = toDateOnly(startDate);
  if (!leaveStart) return createDefaultShiftSyncResult();

  const rawReturn = toDateOnly(returnDate);
  // Tanggal cuti terakhir adalah 1 hari SEBELUM tanggal masuk kerja
  const leaveEnd = rawReturn && rawReturn > leaveStart ? addDays(rawReturn, -1) : leaveStart;
  const effectiveEnd = leaveEnd && leaveEnd >= leaveStart ? leaveEnd : leaveStart;

  const affectedDates = [];
  for (let cursor = new Date(leaveStart.getTime()); cursor <= effectiveEnd; cursor = addDays(cursor, 1)) {
    affectedDates.push(new Date(cursor.getTime()));
  }
  if (!affectedDates.length) affectedDates.push(leaveStart);

  // Cari shift yang tumpang tindih dengan rentang cuti
  const existingShifts = await tx.shiftKerja.findMany({
    where: {
      id_user: userId,
      deleted_at: null,
      AND: [{ tanggal_mulai: { lte: effectiveEnd } }, { tanggal_selesai: { gte: leaveStart } }],
    },
    select: {
      id_shift_kerja: true,
      tanggal_mulai: true,
      tanggal_selesai: true,
      status: true,
    },
  });

  const updates = [];
  const updatedIds = [];
  for (const shift of existingShifts) {
    const overlap = getShiftOverlapRange(shift, leaveStart, effectiveEnd);
    if (!overlap) continue;
    if (shift.status !== 'LIBUR') {
      updates.push(
        tx.shiftKerja.update({
          where: { id_shift_kerja: shift.id_shift_kerja },
          data: { status: 'LIBUR' }, // Set jadi LIBUR
        })
      );
      updatedIds.push(shift.id_shift_kerja);
    }
  }
  if (updates.length) await Promise.all(updates);

  // Cek tanggal cuti mana yang belum ter-cover oleh shift (misal: hari libur)
  const coverage = new Set();
  for (const shift of existingShifts) {
    const overlap = getShiftOverlapRange(shift, leaveStart, effectiveEnd);
    if (!overlap) continue;
    for (let cursor = new Date(overlap.start.getTime()); cursor <= overlap.end; cursor = addDays(cursor, 1)) {
      coverage.add(formatDateKey(cursor));
    }
  }

  const missingDates = [];
  for (const date of affectedDates) {
    const key = formatDateKey(date);
    if (!coverage.has(key)) missingDates.push(new Date(date.getTime()));
  }

  // Buat shift LIBUR baru untuk tanggal yang belum ada
  let createdCount = 0;
  if (missingDates.length) {
    const data = missingDates.map((date) => ({
      id_user: userId,
      tanggal_mulai: date,
      tanggal_selesai: date,
      hari_kerja: 'LIBUR',
      status: 'LIBUR',
      id_pola_kerja: null,
    }));
    const createResult = await tx.shiftKerja.createMany({ data, skipDuplicates: true });
    createdCount = createResult?.count ?? data.length;
  }

  // (Opsional) Sesuaikan shift pada HARI MASUK KERJA jika diminta
  let returnShiftAdjustment = null;
  const effectiveReturnShift = returnShift?.date ? toDateOnly(returnShift.date) : toDateOnly(returnDate);
  const returnShiftIdPolaKerja = returnShift?.idPolaKerja || null;

  if (effectiveReturnShift && returnShiftIdPolaKerja) {
    const existingReturnShift = await tx.shiftKerja.findFirst({
      where: {
        id_user: userId,
        deleted_at: null,
        tanggal_mulai: effectiveReturnShift,
      },
    });

    if (existingReturnShift) {
      const updated = await tx.shiftKerja.update({
        where: { id_shift_kerja: existingReturnShift.id_shift_kerja },
        data: {
          tanggal_mulai: effectiveReturnShift,
          tanggal_selesai: effectiveReturnShift,
          hari_kerja: 'KERJA',
          status: 'KERJA',
          id_pola_kerja: returnShiftIdPolaKerja,
        },
      });
      returnShiftAdjustment = {
        action: 'updated',
        id_shift_kerja: updated.id_shift_kerja,
        tanggal_mulai: updated.tanggal_mulai,
        id_pola_kerja: updated.id_pola_kerja,
        status: 'KERJA',
        tanggal_mulai_display: formatDateDisplay(updated.tanggal_mulai),
      };
    } else {
      const created = await tx.shiftKerja.create({
        data: {
          id_user: userId,
          tanggal_mulai: effectiveReturnShift,
          tanggal_selesai: effectiveReturnShift,
          hari_kerja: 'KERJA',
          status: 'KERJA',
          id_pola_kerja: returnShiftIdPolaKerja,
        },
      });
      returnShiftAdjustment = {
        action: 'created',
        id_shift_kerja: created.id_shift_kerja,
        tanggal_mulai: created.tanggal_mulai,
        id_pola_kerja: created.id_pola_kerja,
        status: 'KERJA',
        tanggal_mulai_display: formatDateDisplay(created.tanggal_mulai),
      };
    }
  }

  return {
    updatedCount: updatedIds.length,
    createdCount,
    affectedDates,
    returnShift: returnShiftAdjustment,
  };
}

/**
 * Handle: PATCH /api/mobile/pengajuan-cuti/approvals/[id]
 * Mengubah status approval (disetujui/ditolak)
 */
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

  let returnShift;
  try {
    returnShift = parseReturnShiftPayload(body?.return_shift);
  } catch (err) {
    if (err instanceof NextResponse) return err;
    throw err;
  }

  try {
    const result = await db.$transaction(async (tx) => {
      // Ambil data approval DAN data pengajuan terkait (termasuk relasi tanggal_list)
      const approvalRecord = await tx.approvalPengajuanCuti.findUnique({
        where: { id_approval_pengajuan_cuti: id },
        include: {
          pengajuan_cuti: {
            select: {
              id_pengajuan_cuti: true,
              id_user: true,
              status: true,
              tanggal_masuk_kerja: true, // Field skema (dibutuhkan)
              current_level: true,
              deleted_at: true,
              tanggal_list: {
                // Ambil relasi tanggal_list
                select: { tanggal_cuti: true },
                orderBy: { tanggal_cuti: 'asc' },
              },
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

      // Validasi hak akses approver
      const matchesUser = approvalRecord.approver_user_id && approvalRecord.approver_user_id === actorId;
      const matchesRole = approvalRecord.approver_role && normalizeRole(approvalRecord.approver_role) === actorRole;
      if (!matchesUser && !matchesRole) {
        throw NextResponse.json({ ok: false, message: 'Anda tidak memiliki akses untuk approval ini.' }, { status: 403 });
      }

      if (!PENDING_DECISIONS.has(approvalRecord.decision)) {
        throw NextResponse.json({ ok: false, message: 'Approval sudah memiliki keputusan.' }, { status: 409 });
      }

      // Update approval
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

      // Cek status agregat
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
      let shiftSyncResult = createDefaultShiftSyncResult();

      // Update status pengajuan utama jika perlu
      if (Object.keys(parentUpdate).length) {
        submission = await tx.pengajuanCuti.update({
          where: { id_pengajuan_cuti: approvalRecord.id_pengajuan_cuti },
          data: parentUpdate,
          include: buildInclude(), // 'buildInclude' memuat 'tanggal_list'
        });

        // Jika status baru adalah 'disetujui', sinkronkan shift
        if (parentUpdate.status === 'disetujui') {
          const targetUserId = submission?.id_user;

          // Ambil 'tanggal_list' dari data 'submission' yang baru di-fetch
          const tanggalList = submission?.tanggal_list;
          const tanggalMulaiCuti = getFirstDateFromList(tanggalList); // Dihitung dari relasi

          const tanggalMasukKerja = submission?.tanggal_masuk_kerja; // Diambil dari skema

          try {
            shiftSyncResult = await syncShiftLiburForApprovedLeave(tx, {
              userId: targetUserId,
              startDate: tanggalMulaiCuti, // Gunakan tanggal yang sudah dihitung
              returnDate: tanggalMasukKerja,
              returnShift,
            });
          } catch (shiftErr) {
            console.error('Gagal menyelaraskan shift kerja selama cuti:', shiftErr);
            throw NextResponse.json({ ok: false, message: 'Terjadi kesalahan saat menyelaraskan jadwal shift pemohon.' }, { status: 500 });
          }
        }
      } else {
        // Jika status tidak berubah, ambil data terbaru
        submission = await tx.pengajuanCuti.findUnique({
          where: { id_pengajuan_cuti: approvalRecord.id_pengajuan_cuti },
          include: buildInclude(),
        });
      }

      return { submission, approval: updatedApproval, shiftSyncResult };
    });

    const submission = result?.submission;
    const approval = result?.approval;
    const shiftSyncResult = result?.shiftSyncResult || createDefaultShiftSyncResult();

    // Kirim notifikasi ke pemohon
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

    // Kirim notifikasi penyesuaian shift jika disetujui
    if (decision === 'disetujui' && submission?.id_user && shiftSyncResult && (shiftSyncResult.updatedCount > 0 || shiftSyncResult.createdCount > 0)) {
      const affectedDates = (shiftSyncResult.affectedDates || [])
        .map(toDateOnly)
        .filter(Boolean)
        .sort((a, b) => a.getTime() - b.getTime());
      const firstDate = affectedDates[0];
      const lastDate = affectedDates[affectedDates.length - 1] || firstDate;

      const periodeMulaiDisplay = formatDateDisplay(firstDate);
      const periodeSelesaiDisplay = formatDateDisplay(lastDate);

      const overrideTitle = 'Jadwal kerja diperbarui selama cuti';
      const overrideBody = `Shift Anda pada periode ${periodeMulaiDisplay} - ${periodeSelesaiDisplay} telah disesuaikan menjadi LIBUR.`;

      await sendNotification(
        'SHIFT_LEAVE_ADJUSTMENT',
        submission.id_user,
        {
          periode_mulai: firstDate ? formatDateKey(firstDate) : undefined,
          periode_mulai_display: periodeMulaiDisplay,
          periode_selesai: lastDate ? formatDateKey(lastDate) : undefined,
          periode_selesai_display: periodeSelesaiDisplay,
          updated_shift: shiftSyncResult.updatedCount,
          created_shift: shiftSyncResult.createdCount,
          related_table: 'pengajuan_cuti',
          related_id: submission.id_pengajuan_cuti,
          overrideTitle,
          overrideBody,
        },
        { deeplink: '/shift-kerja' }
      );
    }

    return NextResponse.json({
      ok: true,
      message: 'Keputusan approval berhasil disimpan.',
      data: submission,
      shift_adjustment: shiftSyncResult,
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
