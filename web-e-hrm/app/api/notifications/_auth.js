import { NextResponse } from 'next/server';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';

export async function ensureNotificationAuth(req) {
  const authHeader = req.headers.get('authorization') || '';

  // 1) Bearer token (mobile / API client)
  if (authHeader.startsWith('Bearer ')) {
    const rawToken = authHeader.slice(7).trim();
    try {
      const payload = verifyAuthToken(rawToken);

      const id = payload?.id_user || payload?.sub || payload?.userId || payload?.id || payload?.user_id;

      if (id) {
        return {
          actor: {
            id,
            role: payload?.role,
            source: 'bearer',
          },
        };
      }
    } catch (err) {
      console.warn('[notifications] invalid bearer token, fallback to session:', err?.message || err);
    }
  }

  // 2) Session (NextAuth / custom)
  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;

  const id = sessionOrRes?.user?.id || sessionOrRes?.user?.id_user;
  if (!id) {
    return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
  }

  return {
    actor: {
      id,
      role: sessionOrRes?.user?.role,
      source: 'session',
      session: sessionOrRes,
    },
  };
}
