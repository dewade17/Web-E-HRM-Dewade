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

export async function GET(_req, { params }) {
  try {
    const { id } = params;
    const data = await db.location.findUnique({
      where: { id_location: id },
      select: {
        id_location: true,
        nama_kantor: true,
        latitude: true,
        longitude: true,
        radius: true,
        created_at: true,
        updated_at: true,
        deleted_at: true,
      },
    });
    if (!data) return NextResponse.json({ message: 'Lokasi tidak ditemukan' }, { status: 404 });
    return NextResponse.json({ data });
  } catch (err) {
    console.error('GET /locations/[id] error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}

export async function PUT(req, { params }) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const { id } = params;
    const body = await req.json();
    const payload = {};

    if (body.nama_kantor !== undefined) payload.nama_kantor = String(body.nama_kantor).trim();
    if (body.latitude !== undefined) {
      const lat = parseFloat(body.latitude);
      if (Number.isNaN(lat) || lat < -90 || lat > 90) {
        return NextResponse.json({ message: 'Latitude tidak valid (-90..90).' }, { status: 400 });
      }
      payload.latitude = lat;
    }
    if (body.longitude !== undefined) {
      const lon = parseFloat(body.longitude);
      if (Number.isNaN(lon) || lon < -180 || lon > 180) {
        return NextResponse.json({ message: 'Longitude tidak valid (-180..180).' }, { status: 400 });
      }
      payload.longitude = lon;
    }
    if (body.radius !== undefined) payload.radius = body.radius === null ? null : parseInt(body.radius, 10);

    const updated = await db.location.update({
      where: { id_location: id },
      data: payload,
      select: { id_location: true, nama_kantor: true, latitude: true, longitude: true, radius: true, updated_at: true },
    });

    return NextResponse.json({ message: 'Lokasi diperbarui.', data: updated });
  } catch (err) {
    if (err?.code === 'P2025') {
      return NextResponse.json({ message: 'Lokasi tidak ditemukan' }, { status: 404 });
    }
    console.error('PUT /location/[id] error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const { id } = params;
    await db.location.update({ where: { id_location: id }, data: { deleted_at: new Date() } });
    return NextResponse.json({ message: 'Lokasi dihapus (soft delete).' });
  } catch (err) {
    if (err?.code === 'P2025') {
      return NextResponse.json({ message: 'Lokasi tidak ditemukan' }, { status: 404 });
    }
    console.error('DELETE /location/[id] error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
