import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';

async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const payload = verifyAuthToken(auth.slice(7));
      const id = payload?.sub || payload?.id_user || payload?.userId;
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

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

const coordinateFields = ['end_latitude', 'end_longitude'];
const allowedFields = new Set(['jam_selesai', 'end_latitude', 'end_longitude', 'duration']);

export async function PUT(req, { params }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  if (!actorId) {
    return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
  }

  const { id } = params || {};
  if (!id) {
    return NextResponse.json({ message: "Parameter 'id' wajib diisi." }, { status: 400 });
  }

  let body;
  try {
    body = await req.json();
  } catch (_) {
    return NextResponse.json({ message: 'Body harus berupa JSON.' }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ message: 'Body tidak valid.' }, { status: 400 });
  }

  const unknownFields = Object.keys(body).filter((key) => !allowedFields.has(key));
  if (unknownFields.length > 0) {
    return NextResponse.json({ message: `Field ${unknownFields.join(', ')} tidak diizinkan.` }, { status: 400 });
  }

  const existing = await db.kunjungan.findFirst({
    where: {
      id_kunjungan: id,
      id_user: actorId,
      deleted_at: null,
    },
    select: {
      id_kunjungan: true,
      jam_mulai: true,
    },
  });

  if (!existing) {
    return NextResponse.json({ message: 'Kunjungan klien tidak ditemukan.' }, { status: 404 });
  }

  const data = {};

  if (hasOwn(body, 'jam_selesai')) {
    const value = body.jam_selesai;
    if (value === null || value === '') {
      data.jam_selesai = null;
    } else {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ message: "Field 'jam_selesai' tidak valid." }, { status: 400 });
      }
      if (existing.jam_mulai && parsed < existing.jam_mulai) {
        return NextResponse.json({ message: "'jam_selesai' tidak boleh sebelum 'jam_mulai'." }, { status: 400 });
      }
      data.jam_selesai = parsed;
    }
  }

  for (const field of coordinateFields) {
    if (!hasOwn(body, field)) continue;
    const value = body[field];
    if (value === null || value === '') {
      data[field] = null;
      continue;
    }
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) {
      return NextResponse.json({ message: `Field ${field} tidak valid.` }, { status: 400 });
    }
    data[field] = numberValue;
  }

  if (hasOwn(body, 'duration')) {
    const value = body.duration;
    if (value === null || value === '') {
      data.duration = null;
    } else {
      const numberValue = Number(value);
      if (!Number.isFinite(numberValue) || !Number.isInteger(numberValue) || numberValue < 0) {
        return NextResponse.json({ message: "Field 'duration' tidak valid." }, { status: 400 });
      }
      data.duration = numberValue;
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ message: 'Tidak ada perubahan yang diberikan.' }, { status: 400 });
  }

  try {
    const updated = await db.kunjungan.update({
      where: { id_kunjungan: id },
      data,
      select: {
        id_kunjungan: true,
        jam_mulai: true,
        jam_selesai: true,
        end_latitude: true,
        end_longitude: true,
        duration: true,
        updated_at: true,
      },
    });

    return NextResponse.json({ message: 'Kunjungan klien diperbarui.', data: updated });
  } catch (err) {
    console.error('PATCH /mobile/kunjungan-klien/[id]/submit-kunjungan error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}
