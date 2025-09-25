import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';

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
    } catch (_) {
      /* fallback ke NextAuth */
    }
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

function guardOperational(actor) {
  if (actor?.role !== 'OPERASIONAL') {
    return NextResponse.json({ message: 'Forbidden: hanya role OPERASIONAL yang dapat mengakses resource ini.' }, { status: 403 });
  }
  return null;
}

export async function GET(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = params;
    const data = await db.masterDataKunjungan.findUnique({
      where: { id_master_data_kunjungan: id },
      select: {
        id_master_data_kunjungan: true,
        kategori_kunjungan: true,
        created_at: true,
        updated_at: true,
        deleted_at: true,
      },
    });

    if (!data) {
      return NextResponse.json({ message: 'Master data kunjungan tidak ditemukan.' }, { status: 404 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    console.error('GET /master-data-kunjungan/[id] error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function PUT(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;
  const forbidden = guardOperational(auth.actor);
  if (forbidden) return forbidden;

  try {
    const body = await req.json();
    const payload = {};

    if (Object.prototype.hasOwnProperty.call(body, 'kategori_kunjungan')) {
      if (body.kategori_kunjungan === null || String(body.kategori_kunjungan).trim() === '') {
        return NextResponse.json({ message: "Field 'kategori_kunjungan' tidak boleh kosong." }, { status: 400 });
      }
      payload.kategori_kunjungan = String(body.kategori_kunjungan).trim();
    }

    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ message: 'Tidak ada perubahan yang diberikan.' }, { status: 400 });
    }

    const updated = await db.masterDataKunjungan.update({
      where: { id_master_data_kunjungan: params.id },
      data: payload,
      select: {
        id_master_data_kunjungan: true,
        kategori_kunjungan: true,
        updated_at: true,
      },
    });

    return NextResponse.json({ message: 'Master data kunjungan diperbarui.', data: updated });
  } catch (err) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ message: 'Kategori kunjungan sudah terdaftar.' }, { status: 409 });
    }
    if (err?.code === 'P2025') {
      return NextResponse.json({ message: 'Master data kunjungan tidak ditemukan.' }, { status: 404 });
    }
    console.error('PUT /master-data-kunjungan/[id] error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;
  const forbidden = guardOperational(auth.actor);
  if (forbidden) return forbidden;

  try {
    await db.masterDataKunjungan.update({
      where: { id_master_data_kunjungan: params.id },
      data: { deleted_at: new Date() },
    });

    return NextResponse.json({ message: 'Master data kunjungan dihapus (soft delete).' });
  } catch (err) {
    if (err?.code === 'P2025') {
      return NextResponse.json({ message: 'Master data kunjungan tidak ditemukan.' }, { status: 404 });
    }
    console.error('DELETE /master-data-kunjungan/[id] error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}
