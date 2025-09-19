import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';

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
 * parseOptionalDate:
 * - undefined  => field tidak dikirim (jangan ubah)
 * - null / ''  => dianggap error (tidak boleh kosong) — menjaga kontrak lama
 */
function parseOptionalDate(value, field) {
  if (value === undefined) return undefined;
  if (value === null || value === '') {
    throw new Error(`Field '${field}' tidak boleh kosong.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Field '${field}' harus berupa tanggal/waktu yang valid.`);
  }
  return parsed;
}

/**
 * parseOptionalIntMinutes:
 * - undefined => field tidak dikirim
 * - nol/positif integer dalam menit
 */
function parseOptionalIntMinutes(value, field) {
  if (value === undefined) return undefined;
  if (value === null || value === '') {
    throw new Error(`Field '${field}' tidak boleh kosong.`);
  }
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(`Field '${field}' harus berupa bilangan bulat menit >= 0.`);
  }
  return n;
}

export async function GET(_req, { params }) {
  try {
    const { id } = params;
    const data = await db.polaKerja.findUnique({
      where: { id_pola_kerja: id },
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
    });
    if (!data) {
      return NextResponse.json({ message: 'Pola kerja tidak ditemukan' }, { status: 404 });
    }
    return NextResponse.json({ data });
  } catch (err) {
    console.error('GET /pola-kerja/[id] error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}

export async function PUT(req, { params }) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const { id } = params;
    const existing = await db.polaKerja.findUnique({
      where: { id_pola_kerja: id },
      select: {
        id_pola_kerja: true,
        nama_pola_kerja: true,
        jam_mulai: true,
        jam_selesai: true,
        jam_istirahat_mulai: true,
        jam_istirahat_selesai: true,
        maks_jam_istirahat: true,
      },
    });
    if (!existing) {
      return NextResponse.json({ message: 'Pola kerja tidak ditemukan' }, { status: 404 });
    }

    const body = await req.json();
    const data = {};

    // --- nama pola kerja (opsional, tapi kalau dikirim tidak boleh kosong) ---
    if (body.nama_pola_kerja !== undefined) {
      const nama = String(body.nama_pola_kerja).trim();
      if (!nama) {
        return NextResponse.json({ message: "Field 'nama_pola_kerja' tidak boleh kosong." }, { status: 400 });
      }
      data.nama_pola_kerja = nama;
    }

    // --- jam kerja (opsional; jika dikirim harus valid & urutan benar) ---
    let newJamMulai = existing.jam_mulai;
    let newJamSelesai = existing.jam_selesai;
    try {
      const parsedMulai = parseOptionalDate(body.jam_mulai, 'jam_mulai');
      if (parsedMulai !== undefined) {
        newJamMulai = parsedMulai;
        data.jam_mulai = parsedMulai;
      }
      const parsedSelesai = parseOptionalDate(body.jam_selesai, 'jam_selesai');
      if (parsedSelesai !== undefined) {
        newJamSelesai = parsedSelesai;
        data.jam_selesai = parsedSelesai;
      }
    } catch (parseErr) {
      return NextResponse.json({ message: parseErr.message }, { status: 400 });
    }

    if ((body.jam_mulai !== undefined || body.jam_selesai !== undefined) && newJamSelesai < newJamMulai) {
      return NextResponse.json({ message: "Field 'jam_selesai' tidak boleh lebih awal dari 'jam_mulai'." }, { status: 400 });
    }

    // --- jam istirahat (opsional; kalau kirim salah satu harus kirim keduanya) ---
    let newIstMulai = existing.jam_istirahat_mulai;
    let newIstSelesai = existing.jam_istirahat_selesai;

    const istMulaiSent = Object.prototype.hasOwnProperty.call(body, 'jam_istirahat_mulai');
    const istSelesaiSent = Object.prototype.hasOwnProperty.call(body, 'jam_istirahat_selesai');

    try {
      const parsedIstMulai = parseOptionalDate(body.jam_istirahat_mulai, 'jam_istirahat_mulai');
      if (parsedIstMulai !== undefined) {
        newIstMulai = parsedIstMulai;
        data.jam_istirahat_mulai = parsedIstMulai;
      }
      const parsedIstSelesai = parseOptionalDate(body.jam_istirahat_selesai, 'jam_istirahat_selesai');
      if (parsedIstSelesai !== undefined) {
        newIstSelesai = parsedIstSelesai;
        data.jam_istirahat_selesai = parsedIstSelesai;
      }
    } catch (parseErr) {
      return NextResponse.json({ message: parseErr.message }, { status: 400 });
    }

    // Larang kirim salah satu tanpa pasangannya
    if ((istMulaiSent && !istSelesaiSent) || (!istMulaiSent && istSelesaiSent)) {
      return NextResponse.json({ message: "Isi keduanya: 'jam_istirahat_mulai' dan 'jam_istirahat_selesai'." }, { status: 400 });
    }

    // Perlu validasi konsistensi jika jam kerja berubah atau jam istirahat berubah
    const jamKerjaBerubah = body.hasOwnProperty('jam_mulai') || body.hasOwnProperty('jam_selesai');
    const jamIstirahatBerubah = istMulaiSent || istSelesaiSent;

    if (jamKerjaBerubah || jamIstirahatBerubah) {
      if ((newIstMulai && !newIstSelesai) || (!newIstMulai && newIstSelesai)) {
        return NextResponse.json({ message: "Isi keduanya: 'jam_istirahat_mulai' dan 'jam_istirahat_selesai'." }, { status: 400 });
      }

      if (newIstMulai && newIstSelesai) {
        // istirahat harus di dalam jam kerja
        if (newIstMulai < newJamMulai || newIstSelesai > newJamSelesai) {
          return NextResponse.json({ message: 'Rentang istirahat harus berada di dalam jam kerja.' }, { status: 400 });
        }
        // urutan window
        if (newIstSelesai < newIstMulai) {
          return NextResponse.json({ message: "'jam_istirahat_selesai' tidak boleh lebih awal dari 'jam_istirahat_mulai'." }, { status: 400 });
        }
      }
    }

    // --- maks_jam_istirahat (opsional & independent) ---
    let newMaks = existing.maks_jam_istirahat;
    try {
      const parsedMaks = parseOptionalIntMinutes(body.maks_jam_istirahat, 'maks_jam_istirahat');
      if (parsedMaks !== undefined) {
        newMaks = parsedMaks;
        data.maks_jam_istirahat = parsedMaks;
      }
    } catch (parseErr) {
      return NextResponse.json({ message: parseErr.message }, { status: 400 });
    }

    // --- Validasi relasi MAX vs WINDOW bila window tersedia (existing atau baru) ---
    const effIstMulai = newIstMulai ?? existing.jam_istirahat_mulai;
    const effIstSelesai = newIstSelesai ?? existing.jam_istirahat_selesai;
    const windowAda = !!(effIstMulai && effIstSelesai);

    // Jika ingin set MAX tapi window belum ada => tolak (supaya aturan bisnis jelas)
    if (!windowAda && body.maks_jam_istirahat !== undefined) {
      return NextResponse.json(
        {
          message: "Tidak bisa set 'maks_jam_istirahat' tanpa window istirahat. Set 'jam_istirahat_mulai' & 'jam_istirahat_selesai' terlebih dahulu.",
        },
        { status: 400 }
      );
    }

    // Jika window ada, batasi 0 ≤ MAX ≤ durasi window (menit)
    if (windowAda) {
      const windowDurasiMenit = Math.round((effIstSelesai.getTime() - effIstMulai.getTime()) / 60000);
      if (windowDurasiMenit < 0) {
        return NextResponse.json({ message: 'Rentang istirahat tidak valid.' }, { status: 400 });
      }

      // 1) Ketika user mengirim MAX baru, cek ≤ window
      if (body.maks_jam_istirahat !== undefined && newMaks > windowDurasiMenit) {
        return NextResponse.json(
          {
            message: `'maks_jam_istirahat' (${newMaks} menit) tidak boleh melebihi durasi window istirahat (${windowDurasiMenit} menit).`,
          },
          { status: 400 }
        );
      }

      // 2) Ketika window diubah tapi MAX tidak dikirim, pastikan MAX lama masih valid
      if (jamIstirahatBerubah && body.maks_jam_istirahat === undefined && existing.maks_jam_istirahat != null) {
        if (existing.maks_jam_istirahat > windowDurasiMenit) {
          return NextResponse.json(
            {
              message: `Window istirahat baru hanya ${windowDurasiMenit} menit, sedangkan 'maks_jam_istirahat' lama ${existing.maks_jam_istirahat} menit. Kirim 'maks_jam_istirahat' yang baru (≤ ${windowDurasiMenit}).`,
            },
            { status: 400 }
          );
        }
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ message: 'Tidak ada perubahan yang diberikan.' }, { status: 400 });
    }

    const updated = await db.polaKerja.update({
      where: { id_pola_kerja: id },
      data,
      select: {
        id_pola_kerja: true,
        nama_pola_kerja: true,
        jam_mulai: true,
        jam_selesai: true,
        jam_istirahat_mulai: true,
        jam_istirahat_selesai: true,
        maks_jam_istirahat: true,
        updated_at: true,
        deleted_at: true,
      },
    });

    return NextResponse.json({ message: 'Pola kerja diperbarui.', data: updated });
  } catch (err) {
    if (err?.code === 'P2025') {
      return NextResponse.json({ message: 'Pola kerja tidak ditemukan' }, { status: 404 });
    }
    console.error('PUT /pola-kerja/[id] error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const { id } = params;
    const { searchParams } = new URL(req.url);
    const hardDelete = searchParams.get('hard') === '1' || searchParams.get('force') === '1';

    const existing = await db.polaKerja.findUnique({
      where: { id_pola_kerja: id },
      select: { id_pola_kerja: true, deleted_at: true },
    });
    if (!existing) {
      return NextResponse.json({ message: 'Pola kerja tidak ditemukan' }, { status: 404 });
    }

    if (hardDelete) {
      try {
        await db.polaKerja.delete({ where: { id_pola_kerja: id } });
        return NextResponse.json({ message: 'Pola kerja dihapus permanen.' });
      } catch (err) {
        if (err?.code === 'P2003') {
          return NextResponse.json({ message: 'Gagal menghapus: pola kerja masih digunakan oleh shift lain.' }, { status: 409 });
        }
        throw err;
      }
    }

    if (existing.deleted_at) {
      return NextResponse.json({ message: 'Pola kerja sudah dalam status terhapus.' });
    }

    await db.polaKerja.update({
      where: { id_pola_kerja: id },
      data: { deleted_at: new Date() },
    });

    return NextResponse.json({ message: 'Pola kerja dihapus (soft delete).' });
  } catch (err) {
    if (err?.code === 'P2025') {
      return NextResponse.json({ message: 'Pola kerja tidak ditemukan' }, { status: 404 });
    }
    console.error('DELETE /pola-kerja/[id] error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
