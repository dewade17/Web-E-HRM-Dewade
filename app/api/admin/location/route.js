import { NextResponse } from 'next/server';
import db from '../../../../lib/prisma';
import { verifyAuthToken } from '../../../../lib/jwt';
import { authenticateRequest } from '../../../utils/auth/authUtils';

async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      verifyAuthToken(auth.slice(7));
      return true;
    } catch (_) {
      /* fallback ke NextAuth */
    }
  }
  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes; // unauthorized
  return true; 
}

export async function GET(req) {
  // Auth (Bearer atau NextAuth)
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
    const pageSize = Math.min(Math.max(parseInt(searchParams.get('pageSize') || '10', 10), 1), 100);
    const search = (searchParams.get('search') || '').trim();
    const includeDeleted = searchParams.get('includeDeleted') === '1';
    const orderBy = searchParams.get('orderBy') || 'created_at';
    const sort = (searchParams.get('sort') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    const where = {
      ...(includeDeleted ? {} : { deleted_at: null }),
      ...(search ? { nama_kantor: { contains: search } } : {}),
    };

    const [total, data] = await Promise.all([
      db.location.count({ where }),
      db.location.findMany({
        where,
        orderBy: { [orderBy]: sort },
        skip: (page - 1) * pageSize,
        take: pageSize,
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
      }),
    ]);

    return NextResponse.json({
      data,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (err) {
    console.error('GET /location error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}

export async function POST(req) {
  const ok = await ensureAuth(req);
  if (ok instanceof NextResponse) return ok;

  try {
    const body = await req.json();
    const required = ['nama_kantor', 'latitude', 'longitude'];
    for (const k of required) {
      if (body[k] === undefined || String(body[k]).trim() === '') {
        return NextResponse.json({ message: `Field '${k}' wajib diisi.` }, { status: 400 });
      }
    }

    const nama_kantor = String(body.nama_kantor).trim();
    const latitude = parseFloat(body.latitude);
    const longitude = parseFloat(body.longitude);
    const radius = body.radius !== undefined && body.radius !== null ? parseInt(body.radius, 10) : null;

    if (Number.isNaN(latitude) || latitude < -90 || latitude > 90) {
      return NextResponse.json({ message: 'Latitude tidak valid (-90..90).' }, { status: 400 });
    }
    if (Number.isNaN(longitude) || longitude < -180 || longitude > 180) {
      return NextResponse.json({ message: 'Longitude tidak valid (-180..180).' }, { status: 400 });
    }

    const created = await db.location.create({
      data: { nama_kantor, latitude, longitude, radius },
      select: { id_location: true, nama_kantor: true, latitude: true, longitude: true, radius: true, created_at: true },
    });

    return NextResponse.json({ message: 'Lokasi dibuat.', data: created }, { status: 201 });
  } catch (err) {
    console.error('POST /location error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
