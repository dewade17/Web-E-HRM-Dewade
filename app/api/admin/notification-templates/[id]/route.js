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

export async function PUT(request, { params }) {
  const auth = await ensureAuth(request);
  if (auth instanceof NextResponse) return auth;

  if (!['HR', 'SUPERADMIN'].includes(auth.actor?.role)) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const { id } = params;

  try {
    const body = await request.json();
    const { titleTemplate, bodyTemplate, isActive } = body;

    // Validasi input
    if (!titleTemplate || !bodyTemplate) {
      return NextResponse.json({ message: 'Title dan Body template tidak boleh kosong' }, { status: 400 });
    }

    const updatedTemplate = await prisma.notificationTemplate.update({
      where: { id: id },
      data: {
        titleTemplate: titleTemplate,
        bodyTemplate: bodyTemplate,
        // Hanya update isActive jika nilainya boolean, untuk menghindari null/undefined
        isActive: typeof isActive === 'boolean' ? isActive : undefined,
      },
    });

    return NextResponse.json(updatedTemplate);
  } catch (error) {
    console.error(`Error updating notification template ${id}:`, error);
    if (error.code === 'P2025') {
      // Kode error Prisma untuk "record not found"
      return NextResponse.json({ message: 'Template tidak ditemukan' }, { status: 404 });
    }
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
