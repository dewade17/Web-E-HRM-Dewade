  // app/api/agenda-kerja/route.js
  import { NextResponse } from 'next/server';
  import db from '@/lib/prisma';
  import { verifyAuthToken } from '@/lib/jwt';
  import { authenticateRequest } from '@/app/utils/auth/authUtils';

  // Autentikasi (JWT atau NextAuth)
  async function ensureAuth(req) {
    const auth = req.headers.get('authorization') || '';
    if (auth.startsWith('Bearer ')) {
      try {
        verifyAuthToken(auth.slice(7));
        return true;
      } catch {
        /* fallback ke NextAuth */
      }
    }
    const sessionOrRes = await authenticateRequest();
    if (sessionOrRes instanceof NextResponse) return sessionOrRes; // unauthorized
    return true;
  }

  function toDateOrNull(v) {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  function startOfDay(d) {
    const dd = new Date(d);
    dd.setHours(0, 0, 0, 0);
    return dd;
  }
  function endOfDay(d) {
    const dd = new Date(d);
    dd.setHours(23, 59, 59, 999);
    return dd;
  }

  // Helper filter overlap rentang tanggal (start_date..end_date)
  function overlapRangeFilter(fromSOD, toEOD) {
    return {
      AND: [{ OR: [{ start_date: null }, { start_date: { lte: toEOD } }] }, { OR: [{ end_date: null }, { end_date: { gte: fromSOD } }] }],
    };
  }

  // Validasi status enum baru
  const VALID_STATUS = ['diproses', 'ditunda', 'selesai'];

  /**
   * GET /api/agenda-kerja
   * Query (opsional):
   *  - user_id
   *  - id_agenda
   *  - id_absensi
   *  - status=diproses|ditunda|selesai
   *  - date=YYYY-MM-DD  (overlap 1 hari)
   *  - from=YYYY-MM-DD&to=YYYY-MM-DD  (overlap range)
   *  - page, perPage
   */
  export async function GET(request) {
    const okAuth = await ensureAuth(request);
    if (okAuth instanceof NextResponse) return okAuth;

    try {
      const { searchParams } = new URL(request.url);

      const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
      const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get('perPage') || '20', 10)));

      const user_id = searchParams.get('user_id') || undefined;
      const id_agenda = searchParams.get('id_agenda') || undefined;
      const id_absensi = searchParams.get('id_absensi') || undefined;
      const status = searchParams.get('status') || undefined;

      const dateEq = searchParams.get('date');
      const from = searchParams.get('from');
      const to = searchParams.get('to');

      const where = { deleted_at: null };
      if (user_id) where.id_user = user_id;
      if (id_agenda) where.id_agenda = id_agenda;
      if (id_absensi) where.id_absensi = id_absensi;
      if (status && VALID_STATUS.includes(String(status).toLowerCase())) {
        where.status = String(status).toLowerCase();
      }

      // Filter tanggal overlap
      const and = [];
      if (dateEq) {
        const d = toDateOrNull(dateEq);
        if (d) and.push(overlapRangeFilter(startOfDay(d), endOfDay(d)));
      } else if (from || to) {
        const gte = toDateOrNull(from);
        const lte = toDateOrNull(to);
        if (gte || lte) {
          and.push(overlapRangeFilter(gte ? startOfDay(gte) : new Date('1970-01-01'), lte ? endOfDay(lte) : new Date('2999-12-31')));
        }
      }
      if (and.length) where.AND = and;

      const [total, items] = await Promise.all([
        db.agendaKerja.count({ where }),
        db.agendaKerja.findMany({
          where,
          orderBy: [{ start_date: 'desc' }, { created_at: 'desc' }],
          skip: (page - 1) * perPage,
          take: perPage,
          include: {
            agenda: { select: { id_agenda: true, nama_agenda: true } },
            absensi: { select: { id_absensi: true, tanggal: true, jam_masuk: true, jam_pulang: true } },
            user: { select: { id_user: true, nama_pengguna: true, email: true, role: true } },
          },
        }),
      ]);

      return NextResponse.json({
        ok: true,
        data: items,
        meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
      });
    } catch (err) {
      console.error(err);
      return NextResponse.json({ ok: false, message: 'Failed to fetch agenda kerja' }, { status: 500 });
    }
  }

  /**
   * POST /api/agenda-kerja
   * Body JSON:
   *  - id_user (required)
   *  - id_agenda (required)
   *  - deskripsi_kerja (required)
   *  - status? 'diproses'|'ditunda'|'selesai' (default: 'diproses')
   *  - start_date? (ISO datetime)
   *  - end_date?   (ISO datetime)
   *  - duration_seconds? (number; jika tak dikirim & ada start/end, dihitung otomatis)
   *  - id_absensi? (string|null)
   */
  export async function POST(request) {
    const okAuth = await ensureAuth(request);
    if (okAuth instanceof NextResponse) return okAuth;

    try {
      const body = await request.json();

      const id_user = (body.id_user || '').trim();
      const id_agenda = (body.id_agenda || '').trim();
      const deskripsi_kerja = (body.deskripsi_kerja || '').trim();

      if (!id_user) return NextResponse.json({ ok: false, message: 'id_user wajib diisi' }, { status: 400 });
      if (!id_agenda) return NextResponse.json({ ok: false, message: 'id_agenda wajib diisi' }, { status: 400 });
      if (!deskripsi_kerja) return NextResponse.json({ ok: false, message: 'deskripsi_kerja wajib diisi' }, { status: 400 });

      const status = String(body.status || 'diproses').toLowerCase();
      if (!VALID_STATUS.includes(status)) {
        return NextResponse.json({ ok: false, message: 'status tidak valid' }, { status: 400 });
      }

      const start_date = toDateOrNull(body.start_date);
      const end_date = toDateOrNull(body.end_date);

      if (start_date && end_date && end_date < start_date) {
        return NextResponse.json({ ok: false, message: 'end_date tidak boleh sebelum start_date' }, { status: 400 });
      }

      let duration_seconds = body.duration_seconds ?? null;
      if (duration_seconds == null && start_date && end_date) {
        duration_seconds = Math.max(0, Math.floor((end_date - start_date) / 1000));
      }

      const data = {
        id_user,
        id_agenda,
        deskripsi_kerja,
        status,
        start_date,
        end_date,
        duration_seconds,
        id_absensi: body.id_absensi ?? null,
      };

      const created = await db.agendaKerja.create({
        data,
        include: {
          agenda: { select: { id_agenda: true, nama_agenda: true } },
          absensi: { select: { id_absensi: true, tanggal: true, jam_masuk: true, jam_pulang: true } },
          user: { select: { id_user: true, nama_pengguna: true, email: true, role: true } },
        },
      });

      return NextResponse.json({ ok: true, data: created }, { status: 201 });
    } catch (err) {
      console.error(err);
      return NextResponse.json({ ok: false, message: 'Gagal membuat agenda kerja' }, { status: 500 });
    }
  }
