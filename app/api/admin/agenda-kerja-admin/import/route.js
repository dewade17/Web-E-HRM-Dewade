export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';

const normRole = (r) =>
  String(r || '')
    .trim()
    .toUpperCase();
const canManageAll = (role) => ['OPERASIONAL','SUPERADMIN'].includes(normRole(role));

async function ensureAuth(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const payload = verifyAuthToken(auth.slice(7));
      return { actor: { id: payload?.sub || payload?.id_user || payload?.userId, role: payload?.role } };
    } catch {}
  }
  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;
  return { actor: { id: sessionOrRes?.user?.id || sessionOrRes?.user?.id_user, role: sessionOrRes?.user?.role } };
}

function parseHHmm(s) {
  if (!s) return { h: null, m: null, s: null };
  const m = String(s)
    .trim()
    .match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return { h: null, m: null, s: null };
  return { h: Number(m[1]), m: Number(m[2]), s: m[3] ? Number(m[3]) : 0 };
}
function makeUTC(dateYMD, timeHM) {
  if (!dateYMD) return null;
  const [y, mo, d] = dateYMD.split('-').map(Number);
  const h = timeHM?.h ?? 0,
    mi = timeHM?.m ?? 0,
    se = timeHM?.s ?? 0;
  if (!y || !mo || !d) return null;
  return new Date(Date.UTC(y, mo - 1, d, h, mi, se));
}
function normText(s) {
  return String(s || '').trim();
}

export async function POST(req) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (!canManageAll(auth.actor?.role)) {
    return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  }

  try {
    const form = await req.formData();
    const file = form.get('file');
    const userId = normText(form.get('user_id'));
    const createAgendaIfMissing = String(form.get('createAgendaIfMissing') || '') === '1';

    if (!file || typeof file.arrayBuffer !== 'function') {
      return NextResponse.json({ ok: false, message: 'File tidak ditemukan' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ ok: false, message: 'user_id wajib dikirim (target karyawan)' }, { status: 400 });
    }

    const ab = await file.arrayBuffer();
    const XLSX = await import('xlsx');
    const wb = XLSX.read(ab, { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    const errors = [];
    const toCreate = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      const tanggalRaw = row['Tanggal Proyek'] ?? row['Tanggal'] ?? row['Tanggal Aktivitas'] ?? row['tanggal proyek'] ?? row['tanggal'] ?? row['tanggal aktivitas'];
      const aktivitas = normText(row['Aktivitas'] ?? row['aktivitas'] ?? row['Deskripsi'] ?? row['deskripsi']);
      const proyekName = normText(row['Proyek/Agenda'] ?? row['Proyek'] ?? row['Agenda'] ?? row['proyek/agenda'] ?? row['proyek'] ?? row['agenda']);
      const mulaiRaw = normText(row['Mulai'] ?? row['mulai']);
      const selesaiRaw = normText(row['Selesai'] ?? row['selesai']);
      const statusRaw = normText(row['Status'] ?? row['status']) || 'diproses';

      if (!aktivitas) {
        errors.push({ row: i + 2, message: 'Aktivitas wajib diisi' });
        continue;
      }
      if (!proyekName) {
        errors.push({ row: i + 2, message: 'Proyek/Agenda wajib diisi' });
        continue;
      }

      // tanggal (YYYY-MM-DD atau Date Excel)
      let dateYMD = '';
      if (tanggalRaw instanceof Date && !Number.isNaN(tanggalRaw.getTime())) {
        const y = tanggalRaw.getUTCFullYear();
        const m = String(tanggalRaw.getUTCMonth() + 1).padStart(2, '0');
        const d = String(tanggalRaw.getUTCDate()).padStart(2, '0');
        dateYMD = `${y}-${m}-${d}`;
      } else {
        const s = normText(tanggalRaw);
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) {
          errors.push({ row: i + 2, message: 'Tanggal Proyek harus YYYY-MM-DD atau tanggal Excel' });
          continue;
        }
        dateYMD = s;
      }

      const startHM = parseHHmm(mulaiRaw);
      const endHM = parseHHmm(selesaiRaw);
      const startDate = mulaiRaw && startHM.h != null ? makeUTC(dateYMD, startHM) : null;
      const endDate = selesaiRaw && endHM.h != null ? makeUTC(dateYMD, endHM) : null;
      if (startDate && endDate && endDate < startDate) {
        errors.push({ row: i + 2, message: 'Selesai tidak boleh sebelum Mulai' });
        continue;
      }

      // agenda case-insensitive
      let agenda = await db.agenda.findFirst({
        where: { deleted_at: null, nama_agenda: { equals: proyekName, mode: 'insensitive' } },
        select: { id_agenda: true },
      });
      if (!agenda && createAgendaIfMissing) {
        agenda = await db.agenda.create({
          data: { nama_agenda: proyekName },
          select: { id_agenda: true },
        });
      }
      if (!agenda) {
        errors.push({ row: i + 2, message: `Proyek/Agenda '${proyekName}' tidak ditemukan` });
        continue;
      }

      toCreate.push({
        id_user: userId,
        id_agenda: agenda.id_agenda,
        deskripsi_kerja: aktivitas,
        status: ['diproses', 'ditunda', 'selesai'].includes(statusRaw.toLowerCase()) ? statusRaw.toLowerCase() : 'diproses',
        start_date: startDate,
        end_date: endDate,
        duration_seconds: startDate && endDate ? Math.max(0, Math.floor((endDate - startDate) / 1000)) : null,
      });
    }

    if (errors.length) {
      return NextResponse.json({ ok: false, message: 'Validasi impor gagal', errors, summary: { errors } }, { status: 400 });
    }

    if (!toCreate.length) {
      return NextResponse.json({ ok: true, message: 'Tidak ada baris valid untuk dibuat', summary: { created: 0 } });
    }

    await db.$transaction(toCreate.map((data) => db.agendaKerja.create({ data })));

    return NextResponse.json({ ok: true, message: 'Impor selesai', summary: { created: toCreate.length } });
  } catch (err) {
    console.error('IMPORT agenda-kerja error:', err);
    return NextResponse.json({ ok: false, message: 'Gagal impor', detail: err?.message }, { status: 500 });
  }
}
