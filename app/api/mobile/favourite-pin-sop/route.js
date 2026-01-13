export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';

function getPinnedDelegate() {
  return db?.pinnedSop || db?.pinned_sop || db?.pinned_sops || db?.pinnedSops || null;
}

function getSopDelegate() {
  return db?.sop_karyawan || db?.sopKaryawan || null;
}

async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const payload = verifyAuthToken(auth.slice(7).trim());
      const id = payload?.sub || payload?.id_user || payload?.userId;
      return { actor: { id, role: payload?.role, source: 'bearer' } };
    } catch {
      /* fallback ke NextAuth */
    }
  }

  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;

  return {
    actor: {
      id: sessionOrRes?.user?.id || sessionOrRes?.user?.id_user,
      role: sessionOrRes?.user?.role,
      source: 'session',
    },
  };
}

function pickSopId(body, searchParams) {
  return searchParams?.get('id_sop') || searchParams?.get('id_sop_karyawan') || body?.id_sop || body?.id_sop_karyawan || body?.idSop || null;
}

const SOP_SELECT = {
  id_sop_karyawan: true,
  nama_dokumen: true,
  lampiran_sop_url: true,
  deskripsi: true,
  created_by_snapshot_nama_pengguna: true,
  created_at: true,
  updated_at: true,
  deleted_at: true,
  kategori_sop: {
    select: {
      id_kategori_sop: true,
      nama_kategori: true,
    },
  },
};

export async function GET(req) {
  const authRes = await ensureAuth(req);
  if (authRes instanceof NextResponse) return authRes;

  const userId = authRes?.actor?.id;
  if (!userId) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const pinned = getPinnedDelegate();
  if (!pinned) {
    return NextResponse.json({ message: 'Prisma model PinnedSop tidak ditemukan. Pastikan prisma generate sudah benar.' }, { status: 500 });
  }

  try {
    const rows = await pinned.findMany({
      where: {
        id_user: String(userId),
        sop: { deleted_at: null },
      },
      orderBy: { created_at: 'desc' },
      include: {
        sop: { select: SOP_SELECT },
      },
    });

    const data = rows.map((r) => ({
      id_pinned_sop: r.id_pinned_sop,
      id_sop: r.id_sop,
      pinned_at: r.created_at,
      sop: r.sop,
    }));

    return NextResponse.json({ message: 'Pinned SOP berhasil diambil', data }, { status: 200 });
  } catch (error) {
    console.error('GET favourite-pin-sop error:', error);
    return NextResponse.json({ message: 'Terjadi kesalahan', error: error?.message || String(error) }, { status: 500 });
  }
}

export async function POST(req) {
  const authRes = await ensureAuth(req);
  if (authRes instanceof NextResponse) return authRes;

  const userId = authRes?.actor?.id;
  if (!userId) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const pinned = getPinnedDelegate();
  const sop = getSopDelegate();

  if (!pinned || !sop) {
    return NextResponse.json({ message: 'Prisma model PinnedSop / sop_karyawan tidak ditemukan. Pastikan prisma generate sudah benar.' }, { status: 500 });
  }

  let body = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const idSop = pickSopId(body, null);
  if (!idSop) {
    return NextResponse.json({ message: 'id_sop wajib diisi' }, { status: 400 });
  }

  try {
    const sopExists = await sop.findFirst({
      where: { id_sop_karyawan: String(idSop), deleted_at: null },
      select: { id_sop_karyawan: true },
    });

    if (!sopExists) {
      return NextResponse.json({ message: 'SOP tidak ditemukan atau sudah dihapus' }, { status: 404 });
    }

    // Idempotent create: kalau sudah ada, balikin record existing
    try {
      const created = await pinned.create({
        data: {
          id_user: String(userId),
          id_sop: String(idSop),
        },
        include: { sop: { select: SOP_SELECT } },
      });

      return NextResponse.json(
        {
          message: 'SOP berhasil dipin',
          data: {
            id_pinned_sop: created.id_pinned_sop,
            id_sop: created.id_sop,
            pinned_at: created.created_at,
            sop: created.sop,
          },
        },
        { status: 201 }
      );
    } catch (e) {
      // Prisma unique constraint -> sudah dipin
      const existing = await pinned.findFirst({
        where: { id_user: String(userId), id_sop: String(idSop) },
        include: { sop: { select: SOP_SELECT } },
      });

      if (existing) {
        return NextResponse.json(
          {
            message: 'SOP sudah dipin',
            data: {
              id_pinned_sop: existing.id_pinned_sop,
              id_sop: existing.id_sop,
              pinned_at: existing.created_at,
              sop: existing.sop,
            },
          },
          { status: 200 }
        );
      }

      throw e;
    }
  } catch (error) {
    console.error('POST favourite-pin-sop error:', error);
    return NextResponse.json({ message: 'Terjadi kesalahan', error: error?.message || String(error) }, { status: 500 });
  }
}

export async function DELETE(req) {
  const authRes = await ensureAuth(req);
  if (authRes instanceof NextResponse) return authRes;

  const userId = authRes?.actor?.id;
  if (!userId) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const pinned = getPinnedDelegate();
  if (!pinned) {
    return NextResponse.json({ message: 'Prisma model PinnedSop tidak ditemukan. Pastikan prisma generate sudah benar.' }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);

  let body = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const idSop = pickSopId(body, searchParams);
  if (!idSop) {
    return NextResponse.json({ message: 'id_sop wajib diisi (query atau body)' }, { status: 400 });
  }

  try {
    const res = await pinned.deleteMany({
      where: {
        id_user: String(userId),
        id_sop: String(idSop),
      },
    });

    if (!res?.count) {
      return NextResponse.json({ message: 'SOP belum dipin (tidak ada yang dihapus)' }, { status: 404 });
    }

    return NextResponse.json({ message: 'SOP berhasil di-unpin', deleted: res.count }, { status: 200 });
  } catch (error) {
    console.error('DELETE favourite-pin-sop error:', error);
    return NextResponse.json({ message: 'Terjadi kesalahan', error: error?.message || String(error) }, { status: 500 });
  }
}
