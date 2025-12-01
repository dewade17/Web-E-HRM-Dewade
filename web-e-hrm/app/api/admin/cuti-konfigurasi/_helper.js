import { NextResponse } from 'next/server';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';

export async function ensureAdminAuth(req) {
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
      // ignore invalid token and fall back to session auth
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

export function guardHr(actor) {
  const role = String(actor?.role || '')
    .trim()
    .toUpperCase();
  if (!['HR', 'OPERASIONAL', 'SUPERADMIN'].includes(role)) {
    return NextResponse.json(
      {
        message: 'Forbidden: hanya HR/OPERASIONAL/SUPERADMIN yang dapat mengakses resource ini.',
      },
      { status: 403 }
    );
  }
  return null;
}
