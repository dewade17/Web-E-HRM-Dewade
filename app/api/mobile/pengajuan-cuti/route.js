export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { parseDateOnlyToUTC } from '@/helpers/date-helper';
import { uploadMediaWithFallback } from '@/app/api/_utils/uploadWithFallback';
import { parseRequestBody, findFileInBody } from '@/app/api/_utils/requestBody';
import { parseApprovalsFromBody, ensureApprovalUsersExist, syncApprovalRecords } from './_utils/approvals';
import { sendPengajuanCutiEmailNotifications } from './_utils/emailNotifications';

const APPROVE_STATUSES = new Set(['disetujui', 'ditolak', 'pending']);
const ADMIN_ROLES = new Set(['HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN', 'SUBADMIN', 'SUPERVISI']);

const MONTH_ENUM = ['JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI', 'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'];

export const pengajuanInclude = {
  user: {
    select: {
      id_user: true,
      nama_pengguna: true,
      email: true,
      role: true,
      foto_profil_user: true,
      id_departement: true,
      departement: {
        select: {
          id_departement: true,
          nama_departement: true,
        },
      },
      jabatan: {
        select: {
          id_jabatan: true,
          nama_jabatan: true,
        },
      },
    },
  },
  kategori_cuti: {
    select: {
      id_kategori_cuti: true,
      nama_kategori: true,
      pengurangan_kouta: true,
    },
  },
  handover_users: {
    include: {
      user: {
        select: {
          id_user: true,
          nama_pengguna: true,
          email: true,
          role: true,
          foto_profil_user: true,
          id_departement: true,
          departement: {
            select: {
              id_departement: true,
              nama_departement: true,
            },
          },
          jabatan: {
            select: {
              id_jabatan: true,
              nama_jabatan: true,
            },
          },
        },
      },
    },
  },
  approvals: {
    where: { deleted_at: null },
    orderBy: { level: 'asc' },
    select: {
      id_approval_pengajuan_cuti: true,
      id_pengajuan_cuti: true,
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
  tanggal_list: {
    orderBy: { tanggal_cuti: 'asc' },
    select: {
      id_pengajuan_cuti_tanggal: true,
      tanggal_cuti: true,
    },
  },
};

const dateIsoFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'UTC',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const dateDisplayFormatter = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'long',
  day: '2-digit',
});

function formatDateISO(value) {
  if (!value) return null;
  try {
    const asDate = new Date(value);
    if (Number.isNaN(asDate.getTime())) return null;
    return dateIsoFormatter.format(asDate);
  } catch (_) {
    return null;
  }
}

function formatDateDisplay(value) {
  if (!value) return '-';
  try {
    const asDate = new Date(value);
    if (Number.isNaN(asDate.getTime())) return '-';
    return dateDisplayFormatter.format(asDate);
  } catch (_) {
    return '-';
  }
}

export async function ensureAuth(req) {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || '';

  // 1) Bearer token dulu
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    try {
      const payload = verifyAuthToken(token);
      const id = payload?.sub || payload?.id_user || payload?.userId || payload?.id;

      if (id) {
        return {
          actor: {
            id: String(id),
            role: payload?.role,
            source: 'bearer',
          },
          authType: 'bearer',
        };
      }
      // kalau payload valid tapi id kosong, lanjut fallback session
    } catch {
      // fallback session di bawah
    }
  }

  // 2) Fallback ke NextAuth session
  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;

  const user = sessionOrRes?.user;
  const id = user?.id || user?.id_user; // NextAuth: id, beberapa tempat lama: id_user
  const role = user?.role;

  if (!id) {
    return NextResponse.json({ ok: false, message: 'Unauthorized.' }, { status: 401 });
  }

  return {
    actor: {
      id: String(id),
      role,
      source: 'session',
    },
    authType: 'session',
    session: sessionOrRes,
  };
}

function normalizeStatus(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'menunggu') return null;
  if (APPROVE_STATUSES.has(normalized)) return normalized;
  return null;
}

function parseDateQuery(value) {
  if (!value) return null;
  const asDate = parseDateOnlyToUTC(value);
  return asDate || null;
}

function sanitizeHandoverIds(input) {
  if (input === undefined) return undefined;
  if (input === null || input === '' || input === '[]') return [];

  let rawArr = [];

  // Jika input berupa string, coba parse jika itu JSON array atau split jika koma
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        rawArr = JSON.parse(trimmed);
      } catch (e) {
        rawArr = [trimmed]; // Gagal parse, anggap satu string biasa
      }
    } else if (trimmed.includes(',')) {
      rawArr = trimmed.split(',').map(v => v.trim());
    } else {
      rawArr = [trimmed];
    }
  } else if (Array.isArray(input)) {
    rawArr = input;
  } else {
    rawArr = [input];
  }

  const ids = rawArr
    .flatMap((v) => {
      if (v === undefined || v === null) return [];
      if (Array.isArray(v)) return v;
      return [v];
    })
    .map((v) => String(v).trim())
    .filter(Boolean);

  return Array.from(new Set(ids));
}

export function summarizeDatesByMonth(dateList) {
  const groups = new Map();
  for (const dateVal of dateList || []) {
    const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
    if (Number.isNaN(d.getTime())) continue;

    const year = d.getUTCFullYear();
    const monthIndex = d.getUTCMonth();
    const key = `${year}-${monthIndex}`;
    const arr = groups.get(key) || [];
    arr.push(d);
    groups.set(key, arr);
  }

  const results = [];
  for (const [key, list] of groups.entries()) {
    list.sort((a, b) => a.getTime() - b.getTime());
    const [yearStr, monthIndexStr] = key.split('-');
    const year = Number(yearStr);
    const monthIndex = Number(monthIndexStr);
    const monthName = MONTH_ENUM[monthIndex] || `Bulan-${monthIndex + 1}`;
    results.push({
      key,
      year,
      monthIndex,
      monthName,
      totalDays: list.length,
      firstDate: list[0],
      lastDate: list[list.length - 1],
      dates: list,
    });
  }

  results.sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    return a.monthIndex - b.monthIndex;
  });

  return results;
}

export async function GET(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;
  const actorRole = auth.actor?.role;
  const actorId = auth.actor?.id;
  if (!actorId) return NextResponse.json({ ok: false, message: 'Unauthorized.' }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);

    const rawPage = parseInt(searchParams.get('page') || '1', 10);
    const page = Number.isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
    const perPageRaw = parseInt(searchParams.get('perPage') || searchParams.get('pageSize') || '20', 10);
    const perPageBase = Number.isNaN(perPageRaw) || perPageRaw < 1 ? 20 : perPageRaw;
    const perPage = Math.min(Math.max(perPageBase, 1), 100);

    const search = (searchParams.get('search') || '').trim();
    const statusParam = searchParams.get('status');
    const status = normalizeStatus(statusParam);

    const isAdmin = actorRole && ADMIN_ROLES.has(String(actorRole).toUpperCase());
    const targetUserFilter = (searchParams.get('id_user') || '').trim();
    const kategoriId = (searchParams.get('id_kategori_cuti') || '').trim();

    const tanggalCutiEqParam = (searchParams.get('tanggal_cuti') || searchParams.get('tanggal_mulai') || '').trim();
    const tanggalCutiStartParam = (searchParams.get('start_date') || '').trim();
    const tanggalCutiEndParam = (searchParams.get('end_date') || '').trim();

    const tanggalMasukEqParam = (searchParams.get('tanggal_masuk_kerja') || '').trim();
    const tanggalMasukStartParam = (searchParams.get('tanggal_masuk_start') || '').trim();
    const tanggalMasukEndParam = (searchParams.get('tanggal_masuk_end') || '').trim();

    const where = { deleted_at: null };

    if (!isAdmin) {
      where.id_user = actorId;
    } else if (targetUserFilter) {
      where.id_user = targetUserFilter;
    }

    if (status) {
      where.status = status;
    }

    if (kategoriId) where.id_kategori_cuti = kategoriId;

    if (tanggalCutiEqParam) {
      const parsed = parseDateQuery(tanggalCutiEqParam);
      if (parsed) {
        const start = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 0, 0, 0));
        const end = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 23, 59, 59, 999));
        where.tanggal_list = {
          some: {
            tanggal_cuti: {
              gte: start,
              lte: end,
            },
          },
        };
      }
    } else if (tanggalCutiStartParam || tanggalCutiEndParam) {
      const gte = parseDateQuery(tanggalCutiStartParam);
      const lte = parseDateQuery(tanggalCutiEndParam);
      if (gte || lte) {
        const start = gte ? new Date(Date.UTC(gte.getUTCFullYear(), gte.getUTCMonth(), gte.getUTCDate(), 0, 0, 0)) : undefined;
        const end = lte ? new Date(Date.UTC(lte.getUTCFullYear(), lte.getUTCMonth(), lte.getUTCDate(), 23, 59, 59, 999)) : undefined;
        where.tanggal_list = {
          some: {
            tanggal_cuti: {
              ...(start ? { gte: start } : {}),
              ...(end ? { lte: end } : {}),
            },
          },
        };
      }
    }

    if (tanggalMasukEqParam) {
      const parsed = parseDateQuery(tanggalMasukEqParam);
      if (parsed) {
        const start = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 0, 0, 0));
        const end = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 23, 59, 59, 999));
        where.tanggal_masuk_kerja = { gte: start, lte: end };
      }
    } else if (tanggalMasukStartParam || tanggalMasukEndParam) {
      const gteMasuk = parseDateQuery(tanggalMasukStartParam);
      const lteMasuk = parseDateQuery(tanggalMasukEndParam);
      if (gteMasuk || lteMasuk) {
        const start = gteMasuk ? new Date(Date.UTC(gteMasuk.getUTCFullYear(), gteMasuk.getUTCMonth(), gteMasuk.getUTCDate(), 0, 0, 0)) : undefined;
        const end = lteMasuk ? new Date(Date.UTC(lteMasuk.getUTCFullYear(), lteMasuk.getUTCMonth(), lteMasuk.getUTCDate(), 23, 59, 59, 999)) : undefined;
        where.tanggal_masuk_kerja = {
          ...(start ? { gte: start } : {}),
          ...(end ? { lte: end } : {}),
        };
      }
    }

    if (search) {
      where.OR = [{ user: { nama_pengguna: { contains: search } } }, { user: { email: { contains: search } } }, { keperluan: { contains: search } }, { kategori_cuti: { nama_kategori: { contains: search } } }];
    }

    const [total, items] = await Promise.all([
      db.pengajuanCuti.count({ where }),
      db.pengajuanCuti.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: pengajuanInclude,
      }),
    ]);

    const normalizedItems = (items || []).map((item) => {
      const dates = (item?.tanggal_list || []).map((d) => d?.tanggal_cuti).filter(Boolean);
      const summary = summarizeDatesByMonth(dates);
      const totalDays = summary.reduce((acc, s) => acc + (s.totalDays || 0), 0);

      const tanggalMulai = summary.length ? summary[0]?.firstDate : null;
      const tanggalSelesai = summary.length ? summary[summary.length - 1]?.lastDate : null;

      const { tanggal_list: _unused, ...rest } = item;

      return {
        ...rest,
        tanggal_cuti: formatDateISO(tanggalMulai),
        tanggal_selesai: formatDateISO(tanggalSelesai),
        tanggal_cuti_display: formatDateDisplay(tanggalMulai),
        tanggal_selesai_display: formatDateDisplay(tanggalSelesai),
        summary_dates: summary.map((s) => ({
          year: s.year,
          monthIndex: s.monthIndex,
          monthName: s.monthName,
          totalDays: s.totalDays,
          firstDate: formatDateISO(s.firstDate),
          lastDate: formatDateISO(s.lastDate),
        })),
        total_days: totalDays,
        tanggal_list: item?.tanggal_list || [],
      };
    });

    return NextResponse.json({
      ok: true,
      data: normalizedItems,
      pagination: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
      },
    });
  } catch (err) {
    console.error('GET /mobile/pengajuan-cuti error:', err);
    return NextResponse.json({ ok: false, message: 'Gagal memuat pengajuan cuti.' }, { status: 500 });
  }
}

export async function POST(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  if (!actorId) {
    return NextResponse.json({ ok: false, message: 'Unauthorized.' }, { status: 401 });
  }

  let parsed;
  try {
    parsed = await parseRequestBody(req);
  } catch (err) {
    const status = err?.status || 400;
    return NextResponse.json({ ok: false, message: err?.message || 'Body request tidak valid.' }, { status });
  }

  const body = parsed.body || {};

  try {
    const id_kategori_cuti = String(body?.id_kategori_cuti || '').trim();

    const tanggalCutiInput = body?.['tanggal_cuti[]'] ?? body?.tanggal_cuti ?? body?.['tanggal_mulai[]'] ?? body?.tanggal_mulai;

    const tanggalMasukInput = body?.tanggal_masuk_kerja;

    const keperluan = body?.keperluan === undefined || body?.keperluan === null ? null : String(body.keperluan);
    const handover = body?.handover === undefined || body?.handover === null ? null : String(body.handover);

    const jenis_pengajuan = 'cuti';

    if (!id_kategori_cuti) {
      return NextResponse.json({ ok: false, message: 'id_kategori_cuti wajib diisi.' }, { status: 400 });
    }

    const kategori = await db.kategoriCuti.findFirst({
      where: { id_kategori_cuti, deleted_at: null },
      select: { id_kategori_cuti: true, pengurangan_kouta: true },
    });
    if (!kategori) {
      return NextResponse.json({ ok: false, message: 'Kategori cuti tidak ditemukan.' }, { status: 404 });
    }

    const tanggalMasukKerja = parseDateOnlyToUTC(tanggalMasukInput);
    if (!tanggalMasukKerja) {
      return NextResponse.json({ ok: false, message: 'tanggal_masuk_kerja wajib diisi dan harus valid.' }, { status: 400 });
    }

    const tanggalCutiArray = Array.isArray(tanggalCutiInput) ? tanggalCutiInput : [tanggalCutiInput];
    const parsedCutiDates = [];

    if (tanggalCutiArray.length === 0 || tanggalCutiArray[0] === undefined) {
      return NextResponse.json({ ok: false, message: 'tanggal_cuti wajib diisi.' }, { status: 400 });
    }

    for (const raw of tanggalCutiArray) {
      const tanggalCuti = parseDateOnlyToUTC(raw);
      if (!tanggalCuti) {
        return NextResponse.json({ ok: false, message: `Tanggal cuti '${raw}' tidak valid.` }, { status: 400 });
      }
      if (tanggalMasukKerja <= tanggalCuti) {
        return NextResponse.json({ ok: false, message: `Tanggal cuti '${raw}' harus sebelum tanggal_masuk_kerja.` }, { status: 400 });
      }
      parsedCutiDates.push(tanggalCuti);
    }

    const dedupDatesMap = new Map();
    for (const dt of parsedCutiDates) {
      dedupDatesMap.set(formatDateISO(dt), dt);
    }
    const dedupDates = Array.from(dedupDatesMap.values()).sort((a, b) => a.getTime() - b.getTime());

    if (!dedupDates.length) {
      return NextResponse.json({ ok: false, message: 'tanggal_cuti wajib diisi.' }, { status: 400 });
    }

    const handoverIds = sanitizeHandoverIds(body?.handover_tag_user_ids ?? body?.['handover_tag_user_ids[]']);
    if (handoverIds !== undefined && handoverIds.length) {
      const handoverUsers = await db.user.findMany({
        where: {
          id_user: { in: handoverIds },
          deleted_at: null,
        },
        select: { id_user: true },
      });

      const foundIds = new Set(handoverUsers.map((u) => u.id_user));
      const missing = handoverIds.filter((id) => !foundIds.has(id));

      if (missing.length) {
        const validOnes = handoverIds.filter((id) => foundIds.has(id));
        handoverIds.length = 0;
        handoverIds.push(...validOnes);
      }
    }
    
    let approvalsInput;
    try {
      approvalsInput = parseApprovalsFromBody(body);
    } catch (err) {
      const status = err?.status || 400;
      return NextResponse.json({ ok: false, message: err?.message || 'Data approvals tidak valid.' }, { status });
    }

    try {
      if (approvalsInput !== undefined) {
        await ensureApprovalUsersExist(db, approvalsInput);
      }
    } catch (err) {
      const status = err?.status || 400;
      return NextResponse.json({ ok: false, message: err?.message || 'Approver tidak valid.' }, { status });
    }

    let uploadMeta = null;
    let lampiranUrl = null;

    const lampiranFile = findFileInBody(body, ['lampiran_cuti', 'lampiran', 'lampiran_file', 'file']);
    if (lampiranFile) {
      try {
        const uploaded = await uploadMediaWithFallback(lampiranFile, {
          folder: 'pengajuan-cuti',
          namespace: actorId,
        });
        uploadMeta = uploaded;
        lampiranUrl = uploaded.publicUrl || null;
      } catch (e) {
        console.error('Upload lampiran cuti gagal:', e);
        return NextResponse.json(
          {
            ok: false,
            message: 'Gagal mengunggah lampiran.',
            error: {
              code: e?.code,
              message: e?.message,
              errors: e?.errors,
            },
          },
          { status: e?.status || 502 }
        );
      }
    }

    const fullPengajuan = await db.$transaction(async (tx) => {
      const created = await tx.pengajuanCuti.create({
        data: {
          id_user: actorId,
          id_kategori_cuti,
          keperluan,
          tanggal_masuk_kerja: tanggalMasukKerja,
          handover,
          jenis_pengajuan,
          lampiran_cuti_url: lampiranUrl,
        },
      });

      if (dedupDates.length) {
        await tx.pengajuanCutiTanggal.createMany({
          data: dedupDates.map((tgl) => ({
            id_pengajuan_cuti: created.id_pengajuan_cuti,
            tanggal_cuti: tgl,
          })),
          skipDuplicates: true,
        });
      }

      if (approvalsInput !== undefined) {
        await syncApprovalRecords(tx, created.id_pengajuan_cuti, approvalsInput);
      }

      if (handoverIds !== undefined && handoverIds.length) {
        await tx.handoverCuti.createMany({
          data: handoverIds.map((id_user_tagged) => ({
            id_pengajuan_cuti: created.id_pengajuan_cuti,
            id_user_tagged,
          })),
          skipDuplicates: true,
        });
      }

      return tx.pengajuanCuti.findUnique({
        where: { id_pengajuan_cuti: created.id_pengajuan_cuti },
        include: pengajuanInclude,
      });
    });

    if (fullPengajuan) {
      try {
        await sendPengajuanCutiEmailNotifications(req, fullPengajuan);
      } catch (emailErr) {
        console.warn('POST /mobile/pengajuan-cuti: email notification failed:', emailErr?.message || emailErr);
      }
    }

    const responseData = fullPengajuan || null;

    return NextResponse.json({
      ok: true,
      message: 'Pengajuan cuti berhasil dibuat.',
      data: responseData,
      upload: uploadMeta || undefined,
    });
  } catch (err) {
    console.error('POST /mobile/pengajuan-cuti error:', err);
    return NextResponse.json({ ok: false, message: 'Gagal membuat pengajuan cuti.' }, { status: 500 });
  }
}