export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { uploadMediaWithFallback } from '@/app/api/_utils/uploadWithFallback';
import { parseRequestBody, findFileInBody } from '@/app/api/_utils/requestBody';

const ADMIN_ROLES = new Set(['HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN', 'SUBADMIN', 'SUPERVISI']);
const ALLOWED_ORDER_BY = new Set(['created_at', 'updated_at', 'nama_dokumen']);

function getSopDelegate() {
  return db?.sop_karyawan || db?.sopKaryawan || null;
}

function getKategoriDelegate() {
  return db?.kategori_sop || db?.kategoriSop || null;
}

function getUserDelegate() {
  return db?.user || db?.User || null;
}

async function getActor(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    try {
      const payload = await verifyAuthToken(token);
      const id = payload?.sub || payload?.id_user || payload?.userId || payload?.id;
      const role = payload?.role || payload?.jabatan || payload?.level || payload?.akses;
      if (id && role) {
        return { actor: { id: String(id), role: String(role).toUpperCase(), source: 'token' } };
      }
    } catch (_) {
      /* fallback session */
    }
  }

  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;
  return { actor: { id: sessionOrRes.user.id, role: String(sessionOrRes.user.role).toUpperCase(), source: 'session' } };
}

function guardAdmin(actor) {
  const role = String(actor?.role || '').toUpperCase();
  if (!ADMIN_ROLES.has(role)) {
    return NextResponse.json({ message: 'Forbidden: hanya admin yang dapat mengakses resource ini.' }, { status: 403 });
  }
  return null;
}

function isNullLike(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

function pickFirstFile(val) {
  if (!val) return null;
  if (Array.isArray(val)) {
    const found = val.find((x) => x && typeof x === 'object' && typeof x.arrayBuffer === 'function' && 'size' in x && x.size > 0);
    return found || null;
  }
  if (val && typeof val === 'object' && typeof val.arrayBuffer === 'function' && 'size' in val && val.size > 0) return val;
  return null;
}

async function getNamaPenggunaSnapshot(actorId) {
  const user = getUserDelegate();
  if (!user || !actorId) return null;

  try {
    const u = await user.findUnique({
      where: { id_user: String(actorId) },
      select: { nama_pengguna: true },
    });
    return u?.nama_pengguna || null;
  } catch {
    return null;
  }
}

const SOP_WITH_KATEGORI_INCLUDE = {
  kategori_sop: {
    select: {
      id_kategori_sop: true,
      nama_kategori: true,
    },
  },
};

export async function GET(req) {
  const actor = await getActor(req);
  if (actor instanceof NextResponse) return actor;

  const role = String(actor.actor.role || '').toUpperCase();
  const isAdmin = ADMIN_ROLES.has(role);

  const sop = getSopDelegate();
  if (!sop) {
    return NextResponse.json({ message: 'Prisma model sop_karyawan tidak ditemukan.' }, { status: 500 });
  }

  try {
    const { searchParams } = new URL(req.url);

    const search = (searchParams.get('search') || '').trim();

    const includeDeleted = isAdmin ? ['1', 'true'].includes((searchParams.get('includeDeleted') || '').toLowerCase()) : false;
    const deletedOnly = isAdmin ? ['1', 'true'].includes((searchParams.get('deletedOnly') || '').toLowerCase()) : false;

    const id_kategori_sop = (searchParams.get('id_kategori_sop') || searchParams.get('kategoriId') || '').trim();

    const orderByParam = (searchParams.get('orderBy') || 'created_at').trim();
    const orderBy = ALLOWED_ORDER_BY.has(orderByParam) ? orderByParam : 'created_at';
    const sort = (searchParams.get('sort') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    const all = ['1', 'true'].includes((searchParams.get('all') || '').toLowerCase());
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
    const pageSize = Math.min(Math.max(parseInt(searchParams.get('pageSize') || '10', 10), 1), 100);

    const where = {
      ...(deletedOnly ? { deleted_at: { not: null } } : {}),
      ...(!includeDeleted && !deletedOnly ? { deleted_at: null } : {}),
      ...(id_kategori_sop ? { id_kategori_sop } : {}),
      ...(search
        ? {
            OR: [
              { nama_dokumen: { contains: search, mode: 'insensitive' } },
              { deskripsi: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    if (all) {
      const items = await sop.findMany({
        where,
        orderBy: { [orderBy]: sort },
        include: SOP_WITH_KATEGORI_INCLUDE,
      });
      return NextResponse.json({ total: items.length, items });
    }

    const skip = (page - 1) * pageSize;
    const [total, items] = await db.$transaction([
      sop.count({ where }),
      sop.findMany({
        where,
        orderBy: { [orderBy]: sort },
        skip,
        take: pageSize,
        include: SOP_WITH_KATEGORI_INCLUDE,
      }),
    ]);

    return NextResponse.json({
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      items,
    });
  } catch (err) {
    console.error('GET /admin/sop-perusahaan error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function POST(req) {
  const actor = await getActor(req);
  if (actor instanceof NextResponse) return actor;
  const forbidden = guardAdmin(actor.actor);
  if (forbidden) return forbidden;

  const sop = getSopDelegate();
  if (!sop) {
    return NextResponse.json(
      { message: 'Prisma model sop_karyawan tidak ditemukan. Pastikan schema + prisma generate sudah benar.' },
      { status: 500 }
    );
  }

  let parsed;
  try {
    parsed = await parseRequestBody(req);
  } catch (err) {
    const status = err?.status || 400;
    return NextResponse.json({ message: err?.message || 'Body tidak valid.' }, { status });
  }

  const body = parsed.body || {};

  try {
    const nama_dokumen = typeof body?.nama_dokumen === 'string' ? body.nama_dokumen.trim() : '';
    if (!nama_dokumen) return NextResponse.json({ message: 'nama_dokumen wajib diisi.' }, { status: 400 });

    const deskripsi = typeof body?.deskripsi === 'string' ? body.deskripsi.trim() : '';
    if (!deskripsi) return NextResponse.json({ message: 'deskripsi wajib diisi.' }, { status: 400 });

    const id_kategori_sop = isNullLike(body?.id_kategori_sop) ? null : String(body.id_kategori_sop).trim();
    if (id_kategori_sop) {
      const kategori = getKategoriDelegate();
      if (!kategori) {
        return NextResponse.json(
          { message: 'Prisma model kategori_sop tidak ditemukan. Pastikan schema + prisma generate sudah benar.' },
          { status: 500 }
        );
      }

      const exists = await kategori.findFirst({
        where: { id_kategori_sop },
        select: { id_kategori_sop: true, deleted_at: true },
      });

      if (!exists || exists.deleted_at) {
        return NextResponse.json({ message: 'Kategori SOP tidak valid.' }, { status: 400 });
      }
    }

    // ✅ FIX: file ada di body.lampiran_sop, bukan parsed.files
    const fileFromBody = pickFirstFile(findFileInBody(body, ['lampiran_sop']) || body?.lampiran_sop);

    let lampiranUrl = null;

    if (fileFromBody) {
      const uploaded = await uploadMediaWithFallback(fileFromBody, {
        storageFolder: 'sop-perusahaan',
        supabasePrefix: 'sop-perusahaan',
        isPublic: true,
      });

      // ✅ FIX: return-nya publicUrl, bukan url
      lampiranUrl = uploaded?.publicUrl || null;
    } else if (Object.prototype.hasOwnProperty.call(body, 'lampiran_sop_url')) {
      lampiranUrl = isNullLike(body.lampiran_sop_url) ? null : String(body.lampiran_sop_url).trim();
    }

    // ✅ Snapshot pakai nama pengguna
    const createdByName = await getNamaPenggunaSnapshot(actor?.actor?.id);

    const created = await sop.create({
      data: {
        nama_dokumen,
        deskripsi,
        lampiran_sop_url: lampiranUrl,
        id_kategori_sop,
        created_by_snapshot_nama_pengguna: createdByName,
      },
      include: SOP_WITH_KATEGORI_INCLUDE,
    });

    return NextResponse.json({ message: 'SOP perusahaan berhasil dibuat.', data: created }, { status: 201 });
  } catch (err) {
    console.error('POST /admin/sop-perusahaan error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}
