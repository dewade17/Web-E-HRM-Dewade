import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';

const ALLOWED_MONTHS = new Set(['JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI', 'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER']);

async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const payload = verifyAuthToken(auth.slice(7));
      return {
        actor: {
          id: payload?.sub || payload?.id_user || payload?.userId,
          role: payload?.role,
          source: 'bearer',
        },
      };
    } catch (_) {}
  }

  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;

  return {
    actor: {
      id: sessionOrRes.user.id,
      role: sessionOrRes.user.role,
      source: 'session',
    },
  };
}

function guardHr(actor) {
  const role = String(actor?.role || '')
    .trim()
    .toUpperCase();
  if (!['HR', 'OPERASIONAL', 'SUPERADMIN'].includes(role)) {
    return NextResponse.json({ message: 'Forbidden: hanya HR/OPERASIONAL/SUPERADMIN yang dapat mengakses resource ini.' }, { status: 403 });
  }
  return null;
}

function parseKouta(value) {
  if (value === undefined) return undefined;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) {
    throw new Error("Field 'kouta_cuti' harus berupa bilangan bulat >= 0.");
  }
  return num;
}

function parseCutiTabung(value) {
  if (value === undefined) return undefined;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) {
    throw new Error("Field 'cuti_tabung' harus berupa bilangan bulat >= 0.");
  }
  return num;
}

export async function GET(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;
  const forbidden = guardHr(auth.actor);
  if (forbidden) return forbidden;

  try {
    const { id } = params;

    const row = await db.cutiKonfigurasi.findUnique({
      where: { id_cuti_konfigurasi: id },
      select: {
        id_cuti_konfigurasi: true,
        id_user: true,
        bulan: true,
        kouta_cuti: true,
        cuti_tabung: true,
        created_at: true,
        updated_at: true,
        deleted_at: true,
        user: {
          select: {
            id_user: true,
            nama_pengguna: true,
            email: true,
            nomor_induk_karyawan: true,
            role: true,
          },
        },
      },
    });

    if (!row) {
      return NextResponse.json({ message: 'Konfigurasi cuti tidak ditemukan.' }, { status: 404 });
    }

    return NextResponse.json({ data: row });
  } catch (err) {
    console.error(`GET /admin/cuti-konfigurasi/${params?.id} error:`, err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function PUT(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;
  const forbidden = guardHr(auth.actor);
  if (forbidden) return forbidden;

  try {
    const { id } = params;
    const body = await req.json();

    const data = {};

    if (Object.prototype.hasOwnProperty.call(body, 'id_user')) {
      const idUser = String(body.id_user || '').trim();
      if (!idUser) {
        return NextResponse.json({ message: "Field 'id_user' wajib diisi." }, { status: 400 });
      }
      const user = await db.user.findUnique({
        where: { id_user: idUser },
        select: { id_user: true },
      });
      if (!user) {
        return NextResponse.json({ message: 'User tidak ditemukan.' }, { status: 404 });
      }
      data.id_user = idUser;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'bulan')) {
      const bulanInput = String(body.bulan || '')
        .trim()
        .toUpperCase();
      if (!bulanInput || !ALLOWED_MONTHS.has(bulanInput)) {
        return NextResponse.json({ message: "Field 'bulan' tidak valid." }, { status: 400 });
      }
      data.bulan = bulanInput;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'kouta_cuti')) {
      try {
        data.kouta_cuti = parseKouta(body.kouta_cuti);
      } catch (err) {
        return NextResponse.json({ message: err.message }, { status: 400 });
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'cuti_tabung')) {
      try {
        data.cuti_tabung = parseCutiTabung(body.cuti_tabung);
      } catch (err) {
        return NextResponse.json({ message: err.message }, { status: 400 });
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ message: 'Tidak ada perubahan yang dikirim.' }, { status: 400 });
    }

    const updated = await db.cutiKonfigurasi.update({
      where: { id_cuti_konfigurasi: id },
      data,
      select: {
        id_cuti_konfigurasi: true,
        id_user: true,
        bulan: true,
        kouta_cuti: true,
        cuti_tabung: true,
        updated_at: true,
      },
    });

    return NextResponse.json({ message: 'Konfigurasi cuti diperbarui.', data: updated });
  } catch (err) {
    if (err?.code === 'P2025') {
      return NextResponse.json({ message: 'Konfigurasi cuti tidak ditemukan.' }, { status: 404 });
    }
    if (err?.code === 'P2002') {
      return NextResponse.json({ message: 'Konfigurasi cuti untuk user dan bulan tersebut sudah ada.' }, { status: 409 });
    }

    console.error(`PUT /admin/cuti-konfigurasi/${params?.id} error:`, err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function PATCH(req, ctx) {
  return PUT(req, ctx);
}

export async function DELETE(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;
  const forbidden = guardHr(auth.actor);
  if (forbidden) return forbidden;

  try {
    const { id } = params;

    const record = await db.cutiKonfigurasi.findUnique({
      where: { id_cuti_konfigurasi: id },
      select: { id_cuti_konfigurasi: true, deleted_at: true },
    });

    if (!record) {
      return NextResponse.json({ message: 'Konfigurasi cuti tidak ditemukan.' }, { status: 404 });
    }

    if (record.deleted_at) {
      return NextResponse.json({ message: 'Konfigurasi cuti sudah dihapus.' });
    }

    await db.cutiKonfigurasi.update({
      where: { id_cuti_konfigurasi: id },
      data: { deleted_at: new Date() },
    });

    return NextResponse.json({ message: 'Konfigurasi cuti dihapus.' });
  } catch (err) {
    console.error(`DELETE /admin/cuti-konfigurasi/${params?.id} error:`, err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}
