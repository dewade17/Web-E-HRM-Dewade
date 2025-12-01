export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';

const DECISION_STATUSES = new Set(['disetujui', 'ditolak']);

async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const payload = verifyAuthToken(auth.slice(7));
      const id = payload?.sub || payload?.id_user || payload?.userId || payload?.id;
      if (id) {
        return {
          actor: {
            id,
            role: payload?.role,
            source: 'bearer',
          },
        };
      }
    } catch (_) {
      /* fallback ke NextAuth */
    }
  }

  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;

  const id = sessionOrRes?.user?.id || sessionOrRes?.user?.id_user;
  if (!id) {
    return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
  }

  return {
    actor: {
      id,
      role: sessionOrRes?.user?.role,
      source: 'session',
    },
  };
}

const kunjunganInclude = {
  kategori: {
    select: {
      id_kategori_kunjungan: true,
      kategori_kunjungan: true,
    },
  },
  user: {
    select: {
      id_user: true,
      nama_pengguna: true,
      email: true,
    },
  },
  reports: {
    where: { deleted_at: null },
    select: {
      id_kunjungan_report_recipient: true,
      id_user: true,
      recipient_role_snapshot: true,
      recipient_nama_snapshot: true,
      catatan: true,
      status: true,
      notified_at: true,
      read_at: true,
      acted_at: true,
      created_at: true,
      updated_at: true,
    },
  },
};

export async function PUT(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const actorId = auth?.actor?.id;
    if (!actorId) {
      return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
    }

    const { id } = params || {};
    if (!id) {
      return NextResponse.json({ message: "Parameter 'id' wajib diisi." }, { status: 400 });
    }

    const body = await req.json();
    const updates = {};
    let touchRead = false;
    let touchActed = false;

    if ('status' in body) {
      const normalized = String(body.status || '')
        .trim()
        .toLowerCase();
      if (!DECISION_STATUSES.has(normalized)) {
        return NextResponse.json({ message: "Status hanya boleh 'disetujui' atau 'ditolak'." }, { status: 400 });
      }
      updates.status = normalized;
      touchRead = true;
      touchActed = true;
    }

    if ('catatan' in body) {
      updates.catatan = body.catatan === null ? null : String(body.catatan);
    }

    if (body.mark_read === true) {
      touchRead = true;
    }

    if (!Object.keys(updates).length && !touchRead && !touchActed) {
      return NextResponse.json({ message: 'Tidak ada perubahan yang dikirim.' }, { status: 400 });
    }

    const existing = await db.kunjunganReportRecipient.findFirst({
      where: {
        id_kunjungan_report_recipient: id,
        id_user: actorId,
        deleted_at: null,
      },
      select: {
        id_kunjungan_report_recipient: true,
        id_kunjungan: true,
      },
    });

    if (!existing) {
      return NextResponse.json({ message: 'Data persetujuan tidak ditemukan.' }, { status: 404 });
    }

    const now = new Date();
    const data = { ...updates };
    if (touchRead) data.read_at = now;
    if (touchActed) data.acted_at = now;

    const updated = await db.kunjunganReportRecipient.update({
      where: { id_kunjungan_report_recipient: id },
      data,
      include: {
        kunjungan: {
          select: {
            id_kunjungan: true,
            ...kunjunganInclude,
          },
        },
      },
    });

    return NextResponse.json({ ok: true, data: updated });
  } catch (error) {
    console.error('kunjungan report recipient update error:', error);
    const status = error?.status || 500;
    const message = error?.message || 'Terjadi kesalahan ketika memperbarui persetujuan kunjungan.';
    return NextResponse.json({ ok: false, message }, { status });
  }
}
