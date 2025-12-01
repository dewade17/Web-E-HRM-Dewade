import { NextResponse } from 'next/server';
import db from '../../../../lib/prisma';
import { verifyAuthToken } from '../../../../lib/jwt';
import { authenticateRequest } from '../../../../app/utils/auth/authUtils';
import { parseDateTimeToUTC } from '../../../../helpers/date-helper';


/**
 * Autentikasi: terima Bearer JWT atau NextAuth session.
 */
async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      verifyAuthToken(auth.slice(7));
      return true;
    } catch (_) {}
  }
  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;
  return true;
}

/**
 * Helper parsing tanggal/waktu (wajib & opsional).
 * Catatan: Node Date akan tersimpan sebagai UTC di driver, sementara kolom MySQL DATETIME
 * tidak menyimpan zona waktu. Pastikan klien mengirim ISO dengan offset jelas bila perlu.
 */
function parseDateTime(value, field) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Field '${field}' wajib diisi.`);
  }
  const parsed = parseDateTimeToUTC(value);
  if (!(parsed instanceof Date)) {
    throw new Error(`Field '${field}' harus berupa tanggal/waktu yang valid.`);
  }
  return parsed;
}

function parseOptionalDateTime(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = parseDateTimeToUTC(value);
  if (!(parsed instanceof Date)) {
    throw new Error(`Field '${field}' harus berupa tanggal/waktu yang valid.`);
  }
  return parsed;
}

/**
 * Parse integer menit opsional.
 * - undefined / null / ''  => dianggap TIDAK DIKIRIM (return undefined)
 * - kalau ada nilai, harus bilangan bulat >= 0
 */
function parseOptionalIntMinutes(value, field) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(`Field '${field}' harus berupa bilangan bulat menit >= 0.`);
  }
  return n;
}

/**
 * GET /pola-kerja
 * - pagination, pencarian, sorting
 * - bisa sertakan yang deleted (soft delete) pakai ?includeDeleted=1
 */
export async function GET(req) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
    const pageSize = Math.min(Math.max(parseInt(searchParams.get('pageSize') || '10', 10), 1), 100);
    const search = (searchParams.get('search') || '').trim();
    const includeDeleted = searchParams.get('includeDeleted') === '1';

    const allowedOrder = new Set(['nama_pola_kerja', 'jam_mulai', 'jam_selesai', 'jam_istirahat_mulai', 'jam_istirahat_selesai', 'maks_jam_istirahat', 'created_at', 'updated_at', 'deleted_at']);
    const orderByParam = (searchParams.get('orderBy') || 'created_at').trim();
    const orderByField = allowedOrder.has(orderByParam) ? orderByParam : 'created_at';
    const sort = (searchParams.get('sort') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    const where = {
      ...(includeDeleted ? {} : { deleted_at: null }),
      ...(search ? { nama_pola_kerja: { contains: search, mode: 'insensitive' } } : {}),
    };

    const [total, data] = await Promise.all([
      db.polaKerja.count({ where }),
      db.polaKerja.findMany({
        where,
        orderBy: { [orderByField]: sort },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id_pola_kerja: true,
          nama_pola_kerja: true,
          jam_mulai: true,
          jam_selesai: true,
          jam_istirahat_mulai: true,
          jam_istirahat_selesai: true,
          maks_jam_istirahat: true,
          created_at: true,
          updated_at: true,
          deleted_at: true,
        },
      }),
    ]);

    return NextResponse.json({
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err) {
    console.error('GET /pola-kerja error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}

/**
 * POST /pola-kerja
 * Aturan:
 * - 'nama_pola_kerja', 'jam_mulai', 'jam_selesai' wajib.
 * - Jika salah satu jam istirahat diisi, keduanya wajib & harus berada di dalam jam kerja.
 * - 'maks_jam_istirahat' boleh diisi manual (menit), dengan syarat window ada & 0 ≤ max ≤ durasi window.
 *   Jika window ada tapi 'maks_jam_istirahat' tidak dikirim, default = durasi window (kompatibel lama).
 */
export async function POST(req) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const body = await req.json();

    // Wajib: nama
    const nama = body.nama_pola_kerja !== undefined ? String(body.nama_pola_kerja).trim() : '';
    if (!nama) {
      return NextResponse.json({ message: "Field 'nama_pola_kerja' wajib diisi." }, { status: 400 });
    }

    // Wajib: jam kerja
    let jamMulai;
    let jamSelesai;
    try {
      jamMulai = parseDateTime(body.jam_mulai, 'jam_mulai');
      jamSelesai = parseDateTime(body.jam_selesai, 'jam_selesai');
    } catch (parseErr) {
      return NextResponse.json({ message: parseErr.message }, { status: 400 });
    }
    if (jamSelesai < jamMulai) {
      return NextResponse.json({ message: "Field 'jam_selesai' tidak boleh lebih awal dari 'jam_mulai'." }, { status: 400 });
    }

    // Opsional: jendela istirahat
    let istMulai = null;
    let istSelesai = null;
    try {
      istMulai = parseOptionalDateTime(body.jam_istirahat_mulai, 'jam_istirahat_mulai');
      istSelesai = parseOptionalDateTime(body.jam_istirahat_selesai, 'jam_istirahat_selesai');
    } catch (parseErr) {
      return NextResponse.json({ message: parseErr.message }, { status: 400 });
    }

    // Jika salah satu diisi, keduanya wajib
    if ((istMulai && !istSelesai) || (!istMulai && istSelesai)) {
      return NextResponse.json({ message: "Isi keduanya: 'jam_istirahat_mulai' dan 'jam_istirahat_selesai'." }, { status: 400 });
    }

    // Validasi window & hitung durasi window (menit)
    let windowDurasiMenit = null;
    if (istMulai && istSelesai) {
      if (istSelesai < istMulai) {
        return NextResponse.json({ message: "'jam_istirahat_selesai' tidak boleh lebih awal dari 'jam_istirahat_mulai'." }, { status: 400 });
      }
      // rentang istirahat wajib di dalam jam kerja (inklusif)
      if (istMulai < jamMulai || istSelesai > jamSelesai) {
        return NextResponse.json({ message: 'Rentang istirahat harus berada di dalam jam kerja.' }, { status: 400 });
      }
      windowDurasiMenit = Math.round((istSelesai.getTime() - istMulai.getTime()) / 60000);
    }

    // maks_jam_istirahat (opsional & independen, tapi butuh window)
    let maksIstirahat = undefined;
    try {
      const parsedMaks = parseOptionalIntMinutes(body.maks_jam_istirahat, 'maks_jam_istirahat');

      // Jika user mengirim MAX tapi window belum ada => tolak agar aturan jelas
      if (parsedMaks !== undefined && windowDurasiMenit === null) {
        return NextResponse.json(
          {
            message: "Tidak bisa set 'maks_jam_istirahat' tanpa window istirahat. Set 'jam_istirahat_mulai' & 'jam_istirahat_selesai' terlebih dahulu.",
          },
          { status: 400 }
        );
      }

      if (parsedMaks !== undefined) {
        // Validasi 0 ≤ max ≤ durasi window
        if (parsedMaks > windowDurasiMenit) {
          return NextResponse.json(
            {
              message: `'maks_jam_istirahat' (${parsedMaks} menit) tidak boleh melebihi durasi window istirahat (${windowDurasiMenit} menit).`,
            },
            { status: 400 }
          );
        }
        maksIstirahat = parsedMaks;
      } else {
        // Jika window ada tapi MAX tidak dikirim => default ke durasi window (kompatibel lama)
        if (windowDurasiMenit !== null) {
          maksIstirahat = windowDurasiMenit;
        } else {
          // Tidak ada window & tidak ada MAX => biarkan null
          maksIstirahat = null;
        }
      }
    } catch (parseErr) {
      return NextResponse.json({ message: parseErr.message }, { status: 400 });
    }

    const created = await db.polaKerja.create({
      data: {
        nama_pola_kerja: nama,
        jam_mulai: jamMulai,
        jam_selesai: jamSelesai,
        // window istirahat (opsional)
        jam_istirahat_mulai: istMulai,
        jam_istirahat_selesai: istSelesai,
        // max istirahat sesuai aturan di atas
        maks_jam_istirahat: maksIstirahat,
      },
      select: {
        id_pola_kerja: true,
        nama_pola_kerja: true,
        jam_mulai: true,
        jam_selesai: true,
        jam_istirahat_mulai: true,
        jam_istirahat_selesai: true,
        maks_jam_istirahat: true,
        created_at: true,
      },
    });

    return NextResponse.json({ message: 'Pola kerja dibuat.', data: created }, { status: 201 });
  } catch (err) {
    console.error('POST /pola-kerja error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
