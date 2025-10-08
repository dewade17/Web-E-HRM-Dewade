// app/api/admin/notification-templates/route.js
import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';

async function ensureAuth(req) {
  const authHeader = req.headers.get('authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    try {
      const payload = verifyAuthToken(authHeader.slice(7));
      return {
        actor: {
          id: payload?.sub || payload?.id_user || payload?.userId,
          role: payload?.role,
          source: 'bearer',
        },
        session: null,
        payload,
      };
    } catch (_) {
      /* fallback ke NextAuth */
    }
  }
  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;
  return {
    actor: {
      id: sessionOrRes.user?.id,
      role: sessionOrRes.user?.role,
      source: 'session',
    },
    session: sessionOrRes,
    payload: null,
  };
}

/**
 * GET: Mengambil semua template notifikasi
 */
export async function GET(request) {
  const auth = await ensureAuth(request);
  if (auth instanceof NextResponse) return auth;

  if (!['HR', 'SUPERADMIN'].includes(auth.actor?.role)) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const templates = await prisma.notificationTemplate.findMany({
      orderBy: { description: 'asc' },
    });
    return NextResponse.json(templates);
  } catch (error) {
    console.error('Error fetching notification templates:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * POST: Menambahkan template notifikasi baru
 * Body JSON harus berisi: eventTrigger, description, titleTemplate, bodyTemplate.
 * Optional: placeholders, isActive.
 */
export async function POST(request) {
  const auth = await ensureAuth(request);
  if (auth instanceof NextResponse) return auth;

  if (!['HR', 'SUPERADMIN'].includes(auth.actor?.role)) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { eventTrigger, description, titleTemplate, bodyTemplate, placeholders, isActive } = await request.json();

    // Validasi input dasar
    if (!eventTrigger || !description || !titleTemplate || !bodyTemplate) {
      return NextResponse.json({ message: 'eventTrigger, description, titleTemplate dan bodyTemplate wajib diisi' }, { status: 400 });
    }

    // Buat record baru
    const newTemplate = await prisma.notificationTemplate.create({
      data: {
        eventTrigger,
        description,
        titleTemplate,
        bodyTemplate,
        placeholders: placeholders ?? null,
        isActive: typeof isActive === 'boolean' ? isActive : true,
      },
    });

    return NextResponse.json(newTemplate, { status: 201 });
  } catch (error) {
    console.error('Error creating notification template:', error);
    // P2002 = duplikat key (eventTrigger sudah ada)
    if (error.code === 'P2002') {
      return NextResponse.json({ message: 'eventTrigger sudah digunakan, gunakan nama lain' }, { status: 409 });
    }
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
