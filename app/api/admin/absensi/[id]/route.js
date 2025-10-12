import { NextResponse } from 'next/server';
import { authenticateRequest } from '../../../../../app/utils/auth/authUtils';
import db from '../../../../../lib/prisma';
import { verifyAuthToken } from '../../../../../lib/jwt';

const DECISION_STATUSES = new Set(['disetujui', 'ditolak']);

async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const claims = verifyAuthToken(auth.slice(7));
      return { claims };
    } catch (_) {
      /* fallback ke NextAuth */
    }
  }
  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes; // unauthorized
  return { session: sessionOrRes };
}

export async function PUT(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const { claims, session } = auth;
    const actorId = claims?.sub || claims?.id_user || claims?.userId || claims?.id || session?.user?.id || session?.user?.id_user;

    if (!actorId) {
      return NextResponse.json({ message: 'Payload token tidak sesuai' }, { status: 401 });
    }

    const { id } = params;
    const body = await req.json();

    const updates = {};
    let shouldTouchActedAt = false;
    let shouldTouchReadAt = false;

    if ('status' in body) {
      const normalized = String(body.status || '')
        .trim()
        .toLowerCase();
      if (!DECISION_STATUSES.has(normalized)) {
        return NextResponse.json({ message: "Status hanya boleh 'disetujui' atau 'ditolak'." }, { status: 400 });
      }
      updates.status = normalized;
      shouldTouchActedAt = true;
      shouldTouchReadAt = true;
    }

    if ('catatan' in body) {
      updates.catatan = body.catatan === null ? null : String(body.catatan);
    }

    if (body.mark_read === true) {
      shouldTouchReadAt = true;
    }

    if (!Object.keys(updates).length && !shouldTouchReadAt && !shouldTouchActedAt) {
      return NextResponse.json({ message: 'Tidak ada perubahan yang dikirim.' }, { status: 400 });
    }

    const existing = await db.absensiReportRecipient.findFirst({
      where: {
        id_absensi_report_recipient: id,
        id_user: actorId,
        deleted_at: null,
      },
      select: { id_absensi_report_recipient: true },
    });

    if (!existing) {
      return NextResponse.json({ message: 'Data persetujuan tidak ditemukan.' }, { status: 404 });
    }

    const now = new Date();
    const data = { ...updates };

    if (shouldTouchActedAt) data.acted_at = now;
    if (shouldTouchReadAt) data.read_at = now;

    const updated = await db.absensiReportRecipient.update({
      where: { id_absensi_report_recipient: id },
      data,
      include: {
        absensi: {
          include: {
            user: {
              select: {
                id_user: true,
                nama_pengguna: true,
                email: true,
                role: true,
                // >>>>>>>>>>>>>>>>>>>> PERBAIKAN: kirim foto & jabatan
                foto_profil_user: true,
                jabatan: { select: { id_jabatan: true, nama_jabatan: true } },
                // <<<<<<<<<<<<<<<<<<<<
                departement: { select: { id_departement: true, nama_departement: true } },
              },
            },
            lokasiIn: {
              select: {
                id_location: true,
                nama_kantor: true,
                latitude: true,
                longitude: true,
                radius: true,
              },
            },
            lokasiOut: {
              select: {
                id_location: true,
                nama_kantor: true,
                latitude: true,
                longitude: true,
                radius: true,
              },
            },
          },
        },
      },
    });

    return NextResponse.json({ ok: true, data: updated });
  } catch (error) {
    const status = error?.status || 500;
    const message = error?.message || 'Terjadi kesalahan ketika memperbarui persetujuan absensi.';
    console.error('absensi approvals update error:', error);
    return NextResponse.json({ ok: false, message }, { status });
  }
}
