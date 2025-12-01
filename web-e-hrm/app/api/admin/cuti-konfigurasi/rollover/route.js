import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { ensureAdminAuth, guardHr } from '../_helpers';
import { rolloverCutiKonfigurasi } from './rollover.mjs';

export async function POST(req) {
  const auth = await ensureAdminAuth(req);
  if (auth instanceof NextResponse) return auth;
  const forbidden = guardHr(auth.actor);
  if (forbidden) return forbidden;

  try {
    const summary = await rolloverCutiKonfigurasi(db);
    return NextResponse.json({ message: 'Rollover cuti selesai.', summary });
  } catch (error) {
    console.error('POST /admin/cuti-konfigurasi/rollover error:', error);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}
