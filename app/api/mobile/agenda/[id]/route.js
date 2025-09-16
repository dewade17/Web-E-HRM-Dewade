// app/api/agenda/[id]/route.js
import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';

// Autentikasi (JWT/NextAuth)
async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      verifyAuthToken(auth.slice(7));
      return true;
    } catch {
      /* fallback ke NextAuth */
    }
  }
  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes; // unauthorized
  return true;
}

// GET /api/agenda/[id]
export async function GET(_req, { params }) {
  try {
    const item = await db.agenda.findFirst({
      where: { id_agenda: params.id, deleted_at: null },
      include: {
        _count: { select: { items: true } },
        // opsional: cuplikan 5 item terakhir
        items: {
          where: { deleted_at: null },
          orderBy: [{ created_at: 'desc' }],
          take: 5,
          select: {
            id_agenda_kerja: true,
            deskripsi_kerja: true,
            start_date: true,
            end_date: true,
            duration_seconds: true,
            status: true,
            created_at: true,
          },
        },
      },
    });

    if (!item) {
      return NextResponse.json({ ok: false, message: 'Agenda tidak ditemukan' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, data: item });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, message: 'Gagal mengambil detail agenda' }, { status: 500 });
  }
}

// PUT /api/agenda/[id]
export async function PUT(request, { params }) {
  const okAuth = await ensureAuth(request);
  if (okAuth instanceof NextResponse) return okAuth;

  try {
    const current = await db.agenda.findUnique({ where: { id_agenda: params.id } });
    if (!current || current.deleted_at) {
      return NextResponse.json({ ok: false, message: 'Agenda tidak ditemukan' }, { status: 404 });
    }

    const body = await request.json();
    const data = {
      ...(body.nama_agenda !== undefined && { nama_agenda: String(body.nama_agenda).trim() }),
    };

    if (data.nama_agenda !== undefined && !data.nama_agenda) {
      return NextResponse.json({ ok: false, message: 'nama_agenda tidak boleh kosong' }, { status: 400 });
    }

    const updated = await db.agenda.update({
      where: { id_agenda: params.id },
      data,
      include: { _count: { select: { items: true } } },
    });

    return NextResponse.json({ ok: true, data: updated });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, message: 'Gagal mengubah agenda' }, { status: 500 });
  }
}

// DELETE /api/agenda/[id]?hard=0|1
export async function DELETE(request, { params }) {
  const okAuth = await ensureAuth(request);
  if (okAuth instanceof NextResponse) return okAuth;

  try {
    const current = await db.agenda.findUnique({ where: { id_agenda: params.id } });
    if (!current || current.deleted_at) {
      return NextResponse.json({ ok: false, message: 'Agenda tidak ditemukan' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const hard = searchParams.get('hard');

    if (hard === '1' || hard === 'true') {
      await db.agenda.delete({ where: { id_agenda: params.id } });
      return NextResponse.json({ ok: true, data: { id: params.id, deleted: true, hard: true } });
    }

    await db.agenda.update({
      where: { id_agenda: params.id },
      data: { deleted_at: new Date() },
    });

    return NextResponse.json({ ok: true, data: { id: params.id, deleted: true, hard: false } });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, message: 'Gagal menghapus agenda' }, { status: 500 });
  }
}
