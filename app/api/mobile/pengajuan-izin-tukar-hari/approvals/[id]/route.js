import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { ensureAuth } from '../../route';
import { sendNotification } from '@/app/utils/services/notificationService';

const DECISION_ALLOWED = new Set(['disetujui', 'ditolak']);
const PENDING_DECISIONS = new Set(['pending']);

const ADMIN_ROLES = new Set(['HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN', 'SUBADMIN', 'SUPERVISI']);

const dateDisplayFormatter = new Intl.DateTimeFormat('id-ID', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

function normalizeDecision(val) {
  if (!val) return null;
  const s = String(val).trim().toLowerCase();
  return DECISION_ALLOWED.has(s) ? s : null;
}

function normalizeRole(role) {
  return String(role || '')
    .trim()
    .toUpperCase();
}

function canManageAll(role) {
  return ADMIN_ROLES.has(normalizeRole(role));
}

function toDateOnly(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function formatDateISO(value) {
  if (!value) return '-';
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return '-';
  }
}

function formatDateDisplay(value) {
  const d = toDateOnly(value);
  if (!d) return '-';
  try {
    return dateDisplayFormatter.format(d);
  } catch {
    return formatDateISO(d);
  }
}

/* -------------------- SHIFT SYNC HELPERS -------------------- */

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

/**
 * Sinkronisasi shift menggunakan UPSERT untuk mengatasi konflik soft-delete.
 * hari_izin -> LIBUR
 * hari_pengganti -> KERJA
 */
async function syncShiftForSwapPairs(tx, { userId, pairs, idPolaKerjaPengganti = null }) {
  if (!tx || !userId || !Array.isArray(pairs) || pairs.length === 0) {
    return createDefaultShiftSyncResult();
  }

  const upsertActions = [];
  const affectedDates = new Set();

  for (const p of pairs) {
    const hariIzin = toDateOnly(p?.hari_izin);
    const hariPengganti = toDateOnly(p?.hari_pengganti);

    // 1. Set Hari Izin menjadi LIBUR
    if (hariIzin) {
      const key = hariIzin.toISOString().slice(0, 10);
      affectedDates.add(key);

      upsertActions.push(
        tx.shiftKerja.upsert({
          where: {
            uniq_shift_per_user_per_date: {
              id_user: userId,
              tanggal_mulai: hariIzin,
            },
          },
          create: {
            id_user: userId,
            tanggal_mulai: hariIzin,
            tanggal_selesai: hariIzin,
            hari_kerja: 'LIBUR',
            status: 'LIBUR',
            id_pola_kerja: null,
            deleted_at: null,
          },
          update: {
            tanggal_selesai: hariIzin,
            hari_kerja: 'LIBUR',
            status: 'LIBUR',
            id_pola_kerja: null,
            deleted_at: null, // un-soft-delete jika perlu
          },
        })
      );
    }

    // 2. Set Hari Pengganti menjadi KERJA
    if (hariPengganti) {
      const key = hariPengganti.toISOString().slice(0, 10);
      affectedDates.add(key);

      upsertActions.push(
        tx.shiftKerja.upsert({
          where: {
            uniq_shift_per_user_per_date: {
              id_user: userId,
              tanggal_mulai: hariPengganti,
            },
          },
          create: {
            id_user: userId,
            tanggal_mulai: hariPengganti,
            tanggal_selesai: hariPengganti,
            hari_kerja: 'KERJA',
            status: 'KERJA',
            id_pola_kerja: idPolaKerjaPengganti ?? null,
            deleted_at: null,
          },
          update: {
            tanggal_selesai: hariPengganti,
            hari_kerja: 'KERJA',
            status: 'KERJA',
            id_pola_kerja: idPolaKerjaPengganti ?? null,
            deleted_at: null, // un-soft-delete juga
          },
        })
      );
    }
  }

  const results = await Promise.all(upsertActions);
  const totalOperations = results.length;

  return {
    updatedCount: totalOperations,
    createdCount: 0, // susah dibedakan dari upsert tanpa query extra
    affectedDates: Array.from(affectedDates).map((k) => new Date(`${k}T00:00:00Z`)),
    returnShift: null, // tidak relevan untuk tukar hari
  };
}

/* -------------------- APPROVAL SUMMARY (sama dengan cuti) -------------------- */

function summarizeApprovalStatus(approvals) {
  const approved = approvals.filter((item) => item.decision === 'disetujui');
  const anyApproved = approved.length > 0;
  const allRejected = approvals.length > 0 && approvals.every((item) => item.decision === 'ditolak');
  const highestApprovedLevel = anyApproved ? approved.reduce((acc, curr) => (curr.level > acc ? curr.level : acc), approved[0].level) : null;

  return { anyApproved, allRejected, highestApprovedLevel };
}

/* -------------------- HANDLER PATCH/PUT -------------------- */

/**
 * PATCH/PUT approval: /api/mobile/izin-tukar-hari/approvals/[id]
 */
async function handleDecision(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth?.actor?.id;
  const actorRole = auth?.actor?.role;
  if (!actorId) {
    return NextResponse.json({ ok: false, message: 'Unauthorized.' }, { status: 401 });
  }

  const id = params?.id;
  if (!id) return NextResponse.json({ ok: false, message: 'id wajib diisi.' }, { status: 400 });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: 'Body request harus berupa JSON.' },
      { status: 400 }
    );
  }

  const decision = normalizeDecision(body?.decision);
  if (!decision) {
    return NextResponse.json(
      { ok: false, message: 'decision harus diisi dengan nilai disetujui atau ditolak.' },
      { status: 400 }
    );
  }

  const note = body?.note === undefined || body?.note === null ? null : String(body.note);
  const idPolaKerjaPengganti = body?.id_pola_kerja_pengganti ? String(body.id_pola_kerja_pengganti) : null;

  try {
    const result = await db.$transaction(async (tx) => {
      const approval = await tx.approvalIzinTukarHari.findUnique({
        where: { id_approval_izin_tukar_hari: id },
        include: {
          izin_tukar_hari: {
            select: {
              id_izin_tukar_hari: true,
              id_user: true,
              status: true,
              current_level: true,
              deleted_at: true,
              kategori: true,
              pairs: {
                select: { hari_izin: true, hari_pengganti: true, catatan_pair: true },
                orderBy: { hari_izin: 'asc' },
              },
            },
          },
        },
      });

      if (!approval || approval.deleted_at) {
        throw NextResponse.json(
          { ok: false, message: 'Approval tidak ditemukan.' },
          { status: 404 }
        );
      }

      const parent = approval.izin_tukar_hari;
      if (!parent || parent.deleted_at) {
        throw NextResponse.json(
          { ok: false, message: 'Pengajuan tidak ditemukan.' },
          { status: 404 }
        );
      }

      const normalizedActorRole = normalizeRole(actorRole);
      const matchesUser = approval.approver_user_id && approval.approver_user_id === actorId;
      const matchesRole = approval.approver_role && normalizeRole(approval.approver_role) === normalizedActorRole;
      const isAdmin = canManageAll(actorRole);

      // DI SINI SUMBER 403 SEBELUMNYA
      if (!isAdmin && !matchesUser && !matchesRole) {
        throw NextResponse.json({ ok: false, message: 'Anda tidak memiliki akses untuk approval ini.' }, { status: 403 });
      }

      if (!PENDING_DECISIONS.has(approval.decision)) {
        throw NextResponse.json({ ok: false, message: 'Approval sudah memiliki keputusan.' }, { status: 409 });
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

      // Kumpulkan status semua level & rangkum (sama seperti cuti)
      const approvals = await tx.approvalIzinTukarHari.findMany({
        where: { id_izin_tukar_hari: parent.id_izin_tukar_hari, deleted_at: null },
        orderBy: { level: 'asc' },
        select: { level: true, decision: true },
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
      let shiftSync = createDefaultShiftSyncResult();

      if (Object.keys(parentUpdate).length) {
        submission = await tx.izinTukarHari.update({
          where: { id_izin_tukar_hari: parent.id_izin_tukar_hari },
          data: parentUpdate,
          include: {
            pairs: {
              select: { hari_izin: true, hari_pengganti: true, catatan_pair: true },
              orderBy: { hari_izin: 'asc' },
            },
          },
        });

        if (parentUpdate.status === 'disetujui') {
          try {
            shiftSync = await syncShiftForSwapPairs(tx, {
              userId: submission.id_user, // pastikan model punya field id_user
              pairs: submission.pairs,
              idPolaKerjaPengganti,
            });
          } catch (e) {
            console.error('Gagal sinkron shift tukar-hari:', e);
            if (e instanceof NextResponse) throw e;
            throw NextResponse.json(
              { ok: false, message: 'Gagal menyelaraskan shift untuk tukar hari.' },
              { status: 500 }
            );
          }
        }
      } else {
        submission = await tx.izinTukarHari.findUnique({
          where: { id_izin_tukar_hari: parent.id_izin_tukar_hari },
          include: {
            pairs: true,
          },
        });
      }

      return { submission, approval: updatedApproval, shiftSync };
    });

    const { submission, approval, shiftSync } = result;

    // Notifikasi keputusan
    if (submission?.id_user) {
      const decisionDisplay = approval.decision === 'disetujui' ? 'disetujui' : 'ditolak';
      const overrideTitle = `Izin tukar hari ${decisionDisplay}`;
      const overrideBody = `Pengajuan izin tukar hari Anda telah ${decisionDisplay}.`;
      const deeplink = `/izin-tukar-hari/${submission.id_izin_tukar_hari}`;

      await sendNotification(
        'SWAP_DECIDED',
        submission.id_user,
        {
          decision: approval.decision,
          note: approval?.note || undefined,
          approval_level: approval?.level,
          related_table: 'izin_tukar_hari',
          related_id: submission.id_izin_tukar_hari,
          overrideTitle,
          overrideBody,
        },
        { deeplink }
      );
    }

    // Notifikasi sinkronisasi shift
    if (
      approval.decision === 'disetujui' &&
      submission?.id_user &&
      (shiftSync.updatedCount > 0 || shiftSync.createdCount > 0)
    ) {
      const ds = (shiftSync.affectedDates || [])
        .map(toDateOnly)
        .filter(Boolean)
        .sort((a, b) => a.getTime() - b.getTime());

      let periodeDisplay = 'tanggal terkait tukar hari';
      if (ds.length) {
        const first = ds[0];
        const last = ds[ds.length - 1] || first;
        const a = formatDateDisplay(first);
        const b = formatDateDisplay(last);
        periodeDisplay = a === b ? `tanggal ${a}` : `periode ${a} - ${b}`;
      }

      const overrideTitle = 'Jadwal kerja diperbarui (tukar hari)';
      const overrideBody = `Shift Anda pada ${periodeDisplay} telah disesuaikan (izin→LIBUR, pengganti→KERJA).`;

      await sendNotification(
        'SHIFT_SWAP_ADJUSTMENT',
        submission.id_user,
        {
          periode_awal: ds.length ? formatDateISO(ds[0]) : undefined,
          periode_awal_display: ds.length ? formatDateDisplay(ds[0]) : '-',
          periode_akhir: ds.length ? formatDateISO(ds[ds.length - 1]) : undefined,
          periode_akhir_display: ds.length ? formatDateDisplay(ds[ds.length - 1]) : '-',
          updated_shift: shiftSync.updatedCount,
          created_shift: shiftSync.createdCount,
          related_table: 'izin_tukar_hari',
          related_id: submission.id_izin_tukar_hari,
          overrideTitle,
          overrideBody,
        },
        { deeplink: '/shift-kerja' }
      );
    }

    return NextResponse.json({
      ok: true,
      message: 'Keputusan approval tersimpan.',
      data: submission,
      shift_adjustment: shiftSync,
    });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    console.error('PATCH/PUT /mobile/izin-tukar-hari/approvals error:', err);
    return NextResponse.json(
      { ok: false, message: 'Terjadi kesalahan saat memproses approval.' },
      { status: 500 }
    );
  }
}

export async function PATCH(req, ctx) {
  return handleDecision(req, ctx || {});
}

export async function PUT(req, ctx) {
  return handleDecision(req, ctx || {});
}
