import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { ensureAuth, pengajuanInclude, summarizeDatesByMonth } from '../../route';
import { sendNotification } from '@/app/utils/services/notificationService';

const DECISION_ALLOWED = new Set(['disetujui', 'ditolak']);
const PENDING_DECISIONS = new Set(['pending']); // ❌ hapus 'menunggu'

// --- (Fungsi-fungsi helper) ---

const DEFAULT_SHIFT_SYNC_RESULT = Object.freeze({
  updatedCount: 0,
  createdCount: 0, // Kita sederhanakan pelaporan, karena upsert sulit dibedakan
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
  return String(role || '').trim().toUpperCase();
}

/**
 * Helper untuk tanggal_cuti pertama (turunan) dari relasi tanggal_list.
 */
function getFirstDateFromList(tanggalList) {
  if (!Array.isArray(tanggalList) || tanggalList.length === 0) return null;

  const firstEntry = tanggalList[0];
  const firstDate = firstEntry?.tanggal_cuti;

  if (firstDate instanceof Date) return firstDate;
  if (firstDate) {
    try {
      const d = new Date(firstDate);
      if (!Number.isNaN(d.getTime())) return d;
    } catch (_) {}
  }

  const dates = tanggalList
    .map((d) => (d?.tanggal_cuti ? (d.tanggal_cuti instanceof Date ? d.tanggal_cuti : new Date(d.tanggal_cuti)) : null))
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime()); // sort by time
  return dates.length ? dates[0] : null;
}

function buildInclude() {
  return {
    ...pengajuanInclude,
    approvals: {
      where: { deleted_at: null },
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
  const highestApprovedLevel = anyApproved
    ? approved.reduce((acc, curr) => (curr.level > acc ? curr.level : acc), approved[0].level)
    : null;

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

// -----------------------------------------------------------------
// ▼▼▼ PERBAIKAN: FUNGSI SINKRONISASI SHIFT MENGGUNAKAN UPSERT ▼▼▼
// -----------------------------------------------------------------

/**
 * Menerapkan status LIBUR untuk shift pada tanggal-tanggal cuti spesifik
 * menggunakan `upsert` untuk menangani konflik unique constraint dan soft-delete.
 */
async function syncShiftLiburForApprovedLeave(tx, { userId, tanggalList, returnDate, returnShift }) {
  if (!tx || !userId) return createDefaultShiftSyncResult();

  // 1. Ambil daftar tanggal cuti spesifik
  const affectedDates = (Array.isArray(tanggalList) ? tanggalList : [])
    .map((d) => toDateOnly(d?.tanggal_cuti))
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime());

  if (!affectedDates.length) {
    return createDefaultShiftSyncResult(); // Tidak ada tanggal cuti yang valid
  }

  const upsertActions = [];

  // 2. Loop melalui setiap tanggal cuti dan siapkan UPSERT
  for (const date of affectedDates) {
    const createData = {
      id_user: userId,
      tanggal_mulai: date,
      tanggal_selesai: date,
      hari_kerja: 'LIBUR',
      status: 'LIBUR',
      id_pola_kerja: null,
      deleted_at: null, // Pastikan record baru aktif
    };

    const updateData = {
      tanggal_selesai: date, // Pastikan konsisten (jika menimpa rentang)
      hari_kerja: 'LIBUR',
      status: 'LIBUR',
      id_pola_kerja: null,
      deleted_at: null, // <-- INI KUNCINYA: "Menghidupkan" kembali record yang soft-deleted
    };

    upsertActions.push(
      tx.shiftKerja.upsert({
        where: {
          uniq_shift_per_user_per_date: {
            // Gunakan unique constraint dari schema
            id_user: userId,
            tanggal_mulai: date,
          },
        },
        create: createData,
        update: updateData,
        select: { id_shift_kerja: true }, // Hanya pilih ID agar ringan
      })
    );
  }

  // 3. Eksekusi semua upsert untuk tanggal cuti
  const results = await Promise.all(upsertActions);
  const totalOperations = results.length;

  // 4. (Opsional) Sesuaikan shift HARI MASUK KERJA (juga gunakan upsert)
  let returnShiftAdjustment = null;
  const effectiveReturnShift = returnShift?.date ? toDateOnly(returnShift.date) : toDateOnly(returnDate);
  const returnShiftIdPolaKerja = returnShift?.idPolaKerja || null;

  if (effectiveReturnShift && returnShiftIdPolaKerja) {
    const returnCreate = {
      id_user: userId,
      tanggal_mulai: effectiveReturnShift,
      tanggal_selesai: effectiveReturnShift,
      hari_kerja: 'KERJA',
      status: 'KERJA',
      id_pola_kerja: returnShiftIdPolaKerja,
      deleted_at: null,
    };
    const returnUpdate = {
      tanggal_selesai: effectiveReturnShift,
      hari_kerja: 'KERJA',
      status: 'KERJA',
      id_pola_kerja: returnShiftIdPolaKerja,
      deleted_at: null, // "Hidupkan" juga jika tanggal masuk kebetulan terhapus
    };

    const upsertedReturnShift = await tx.shiftKerja.upsert({
      where: {
        uniq_shift_per_user_per_date: {
          id_user: userId,
          tanggal_mulai: effectiveReturnShift,
        },
      },
      create: returnCreate,
      update: returnUpdate,
      select: { id_shift_kerja: true, tanggal_mulai: true, id_pola_kerja: true, status: true },
    });

    returnShiftAdjustment = {
      action: 'upserted', // Status generik karena bisa create/update
      id_shift_kerja: upsertedReturnShift.id_shift_kerja,
      tanggal_mulai: upsertedReturnShift.tanggal_mulai,
      id_pola_kerja: upsertedReturnShift.id_pola_kerja,
      status: upsertedReturnShift.status,
      tanggal_mulai_display: formatDateDisplay(upsertedReturnShift.tanggal_mulai),
    };
  }

  return {
    updatedCount: totalOperations, // Sederhanakan: laporkan jumlah total operasi
    createdCount: 0, // Sulit dibedakan dari upsert tanpa query tambahan
    affectedDates: affectedDates,
    returnShift: returnShiftAdjustment,
  };
}
// -----------------------------------------------------------------
// ▲▲▲ AKHIR SINKRONISASI ▲▲▲
// -----------------------------------------------------------------

/**
 * Handle: PATCH /api/mobile/pengajuan-cuti/approvals/[id]
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
      // Ambil data approval & pengajuan beserta tanggal_list
      const approvalRecord = await tx.approvalPengajuanCuti.findUnique({
        where: { id_approval_pengajuan_cuti: id },
        include: {
          pengajuan_cuti: {
            select: {
              id_pengajuan_cuti: true,
              id_user: true,
              id_kategori_cuti: true,
              status: true,
              tanggal_masuk_kerja: true,
              current_level: true,
              deleted_at: true,
              tanggal_list: {
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

      // Update keputusan approver
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

      // Cek agregat
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

      const pengajuanData = approvalRecord.pengajuan_cuti;
      const previousStatus = pengajuanData?.status || null;
      const tanggalPengajuan = Array.isArray(pengajuanData?.tanggal_list) ? pengajuanData.tanggal_list.map((item) => item?.tanggal_cuti) : [];
      const quotaAdjustments = summarizeDatesByMonth(tanggalPengajuan);

      if (anyApproved) {
        parentUpdate.current_level = highestApprovedLevel;
        if (previousStatus !== 'disetujui') parentUpdate.status = 'disetujui';
      } else if (allRejected) {
        parentUpdate.current_level = null;
        if (previousStatus !== 'ditolak') parentUpdate.status = 'ditolak';
      }

      const willApprove = parentUpdate.status === 'disetujui' && previousStatus !== 'disetujui';
      const willReject = parentUpdate.status === 'ditolak' && previousStatus === 'disetujui';
      let categoryRecord = null;

      let submission;
      let shiftSyncResult = createDefaultShiftSyncResult();

      // Update status pengajuan utama jika perlu
      if (Object.keys(parentUpdate).length) {
        if (willApprove || willReject) {
          categoryRecord = await tx.kategoriCuti.findFirst({
            where: { id_kategori_cuti: pengajuanData.id_kategori_cuti, deleted_at: null },
            select: { id_kategori_cuti: true, pengurangan_kouta: true },
          });
          if (!categoryRecord) {
            throw NextResponse.json({ ok: false, message: 'Kategori cuti tidak ditemukan.' }, { status: 404 });
          }
        }

        if (willApprove && categoryRecord?.pengurangan_kouta && quotaAdjustments.length) {
          const months = quotaAdjustments.map(([bulan]) => bulan).filter(Boolean);
          if (months.length) {
            const configs = await tx.cutiKonfigurasi.findMany({
              where: { id_user: pengajuanData.id_user, bulan: { in: months }, deleted_at: null },
              select: { id_cuti_konfigurasi: true, bulan: true, kouta_cuti: true },
            });
            const configMap = new Map(configs.map((cfg) => [cfg.bulan, cfg]));
            const insufficientMonths = [];

            for (const [bulan, count] of quotaAdjustments) {
              if (!bulan || !Number.isFinite(count) || count <= 0) continue;
              const config = configMap.get(bulan);
              if (!config || config.kouta_cuti < count) {
                insufficientMonths.push(bulan);
              }
            }

            if (insufficientMonths.length) {
              throw NextResponse.json(
                {
                  ok: false,
                  message: insufficientMonths.length === 1 ? `Kuota cuti tidak mencukupi untuk bulan ${insufficientMonths[0]}.` : `Kuota cuti tidak mencukupi untuk bulan ${insufficientMonths.join(', ')}.`,
                },
                { status: 409 }
              );
            }

            for (const [bulan, count] of quotaAdjustments) {
              if (!bulan || !Number.isFinite(count) || count <= 0) continue;
              const config = configMap.get(bulan);
              if (!config) continue;
              const newQuota = config.kouta_cuti - count;
              await tx.cutiKonfigurasi.update({
                where: { id_cuti_konfigurasi: config.id_cuti_konfigurasi },
                data: { kouta_cuti: newQuota < 0 ? 0 : newQuota },
              });
            }
          }
        }

        if (willReject && categoryRecord?.pengurangan_kouta && quotaAdjustments.length) {
          const months = quotaAdjustments.map(([bulan]) => bulan).filter(Boolean);
          if (months.length) {
            const configs = await tx.cutiKonfigurasi.findMany({
              where: { id_user: pengajuanData.id_user, bulan: { in: months } },
              select: { id_cuti_konfigurasi: true, bulan: true, kouta_cuti: true, deleted_at: true },
            });
            const configMap = new Map(configs.map((cfg) => [cfg.bulan, cfg]));

            for (const [bulan, count] of quotaAdjustments) {
              if (!bulan || !Number.isFinite(count) || count <= 0) continue;
              const existing = configMap.get(bulan);
              if (existing) {
                await tx.cutiKonfigurasi.update({
                  where: { id_cuti_konfigurasi: existing.id_cuti_konfigurasi },
                  data: { kouta_cuti: existing.kouta_cuti + count, deleted_at: null },
                });
              } else {
                await tx.cutiKonfigurasi.create({
                  data: {
                    id_user: pengajuanData.id_user,
                    bulan,
                    kouta_cuti: count,
                  },
                });
              }
            }
          }
        }
        submission = await tx.pengajuanCuti.update({
          where: { id_pengajuan_cuti: approvalRecord.id_pengajuan_cuti },
          data: parentUpdate,
          include: buildInclude(),
        });

        if (parentUpdate.status === 'disetujui') {
          const targetUserId = submission?.id_user;
          const tanggalList = submission?.tanggal_list; // Menggunakan hasil include terbaru
          const tanggalMasukKerja = submission?.tanggal_masuk_kerja;

          try {
            // Panggil fungsi sync YANG SUDAH DIPERBAIKI (dengan upsert)
            shiftSyncResult = await syncShiftLiburForApprovedLeave(tx, {
              userId: targetUserId,
              tanggalList: tanggalList, // <-- Mengirim list tanggal [14, 16, 18]
              returnDate: tanggalMasukKerja,
              returnShift,
            });
          } catch (shiftErr) {
            console.error('Gagal menyelaraskan shift kerja selama cuti:', shiftErr);
            // Jika error-nya adalah NextResponse, lempar kembali agar transaksi di-rollback
            if (shiftErr instanceof NextResponse) {
              throw shiftErr;
            }
            // Jika error lain (misal dari upsert), bungkus sebagai error server
            throw NextResponse.json({ ok: false, message: 'Terjadi kesalahan saat menyelaraskan jadwal shift pemohon.' }, { status: 500 });
          }
        }
      } else {
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

    // Notifikasi ke pemohon soal keputusan
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

    // Notifikasi penyesuaian shift saat cuti
    if (decision === 'disetujui' && submission?.id_user && shiftSyncResult && (shiftSyncResult.updatedCount > 0 || shiftSyncResult.createdCount > 0)) {
      const affectedDates = (shiftSyncResult.affectedDates || [])
        .map(toDateOnly)
        .filter(Boolean)
        .sort((a, b) => a.getTime() - b.getTime());

      let periodeDisplay = 'tanggal-tanggal cuti Anda';
      if (affectedDates.length > 0) {
        const firstDate = affectedDates[0];
        const lastDate = affectedDates[affectedDates.length - 1] || firstDate;
        const periodeCutiDisplay = formatDateDisplay(firstDate);
        const periodeSelesaiDisplay = formatDateDisplay(lastDate);
        if (periodeCutiDisplay === periodeSelesaiDisplay) {
          periodeDisplay = `tanggal ${periodeCutiDisplay}`;
        } else {
          periodeDisplay = `periode ${periodeCutiDisplay} - ${periodeSelesaiDisplay}`;
        }
      }

      const overrideTitle = 'Jadwal kerja diperbarui selama cuti';
      const overrideBody = `Shift Anda pada ${periodeDisplay} telah disesuaikan menjadi LIBUR.`;

      await sendNotification(
        'SHIFT_LEAVE_ADJUSTMENT',
        submission.id_user,
        {
          periode_cuti: affectedDates.length ? formatDateKey(affectedDates[0]) : undefined,
          periode_cuti_display: affectedDates.length ? formatDateDisplay(affectedDates[0]) : '-',
          periode_selesai: affectedDates.length ? formatDateKey(affectedDates[affectedDates.length - 1]) : undefined,
          periode_selesai_display: affectedDates.length ? formatDateDisplay(affectedDates[affectedDates.length - 1]) : '-',
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
    // Tangkap error yang dilempar dari dalam transaksi (termasuk NextResponse)
    if (err instanceof NextResponse) {
      // Jika sudah berupa NextResponse, kembalikan langsung
      return err;
    }
    // Jika error tidak dikenal
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
