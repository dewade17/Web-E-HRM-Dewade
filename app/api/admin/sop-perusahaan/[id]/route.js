export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import db from '@/lib/prisma';
import { verifyAuthToken } from '@/lib/jwt';
import { authenticateRequest } from '@/app/utils/auth/authUtils';
import { uploadMediaWithFallback } from '@/app/api/_utils/uploadWithFallback';
import { parseRequestBody, findFileInBody } from '@/app/api/_utils/requestBody';

const ADMIN_ROLES = new Set(['HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN', 'SUBADMIN', 'SUPERVISI']);

function getSopDelegate() {
  return db?.sop_karyawan || db?.sopKaryawan || null;
}

function getKategoriDelegate() {
  return db?.kategori_sop || db?.kategoriSop || null;
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

const SOP_WITH_KATEGORI_INCLUDE = {
  kategori_sop: {
    select: {
      id_kategori_sop: true,
      nama_kategori: true,
    },
  },
};

export async function GET(req, { params }) {
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

  const { searchParams } = new URL(req.url);
  const includeDeleted = ['1', 'true'].includes((searchParams.get('includeDeleted') || '').toLowerCase());

  try {
    const data = await sop.findFirst({
      where: {
        id_sop_karyawan: params.id,
        ...(!includeDeleted ? { deleted_at: null } : {}),
      },
      include: SOP_WITH_KATEGORI_INCLUDE,
    });

    if (!data) {
      return NextResponse.json({ message: 'SOP perusahaan tidak ditemukan.' }, { status: 404 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    console.error('GET /admin/sop-perusahaan/[id] error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function PUT(req, { params }) {
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
    const exists = await sop.findFirst({
      where: { id_sop_karyawan: params.id },
      select: { id_sop_karyawan: true },
    });

    if (!exists) {
      return NextResponse.json({ message: 'SOP perusahaan tidak ditemukan.' }, { status: 404 });
    }

    const updateData = {};

    if (Object.prototype.hasOwnProperty.call(body, 'nama_dokumen')) {
      const nama_dokumen = typeof body.nama_dokumen === 'string' ? body.nama_dokumen.trim() : '';
      if (!nama_dokumen) return NextResponse.json({ message: 'nama_dokumen tidak boleh kosong.' }, { status: 400 });
      updateData.nama_dokumen = nama_dokumen;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'deskripsi')) {
      const deskripsi = typeof body.deskripsi === 'string' ? body.deskripsi.trim() : '';
      if (!deskripsi) return NextResponse.json({ message: 'deskripsi tidak boleh kosong.' }, { status: 400 });
      updateData.deskripsi = deskripsi;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'id_kategori_sop')) {
      const id_kategori_sop = isNullLike(body.id_kategori_sop) ? null : String(body.id_kategori_sop).trim();

      if (id_kategori_sop) {
        const kategori = getKategoriDelegate();
        if (!kategori) {
          return NextResponse.json(
            { message: 'Prisma model kategori_sop tidak ditemukan. Pastikan schema + prisma generate sudah benar.' },
            { status: 500 }
          );
        }

        const existsKategori = await kategori.findFirst({
          where: { id_kategori_sop },
          select: { id_kategori_sop: true, deleted_at: true },
        });

        if (!existsKategori || existsKategori.deleted_at) {
          return NextResponse.json({ message: 'Kategori SOP tidak valid.' }, { status: 400 });
        }
      }

      updateData.id_kategori_sop = id_kategori_sop;
    }

    // ✅ FIX: file ada di body.lampiran_sop
    const fileFromBody = pickFirstFile(findFileInBody(body, ['lampiran_sop']) || body?.lampiran_sop);

    if (fileFromBody) {
      const uploaded = await uploadMediaWithFallback(fileFromBody, {
        storageFolder: 'sop-perusahaan',
        supabasePrefix: 'sop-perusahaan',
        isPublic: true,
      });
      updateData.lampiran_sop_url = uploaded?.publicUrl || null;
    } else if (Object.prototype.hasOwnProperty.call(body, 'lampiran_sop_url')) {
      updateData.lampiran_sop_url = isNullLike(body.lampiran_sop_url) ? null : String(body.lampiran_sop_url).trim();
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ message: 'Tidak ada field yang diupdate.' }, { status: 400 });
    }

    const updated = await sop.update({
      where: { id_sop_karyawan: params.id },
      data: updateData,
      include: SOP_WITH_KATEGORI_INCLUDE,
    });

    return NextResponse.json({ message: 'SOP perusahaan diupdate.', data: updated });
  } catch (err) {
    console.error('PUT /admin/sop-perusahaan/[id] error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
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

  try {
    const exists = await sop.findFirst({
      where: { id_sop_karyawan: params.id },
      select: { id_sop_karyawan: true, deleted_at: true },
    });

    if (!exists) {
      return NextResponse.json({ message: 'SOP perusahaan tidak ditemukan.' }, { status: 404 });
    }

    if (exists.deleted_at) {
      return NextResponse.json({ message: 'SOP perusahaan sudah dihapus.' }, { status: 400 });
    }

    const deleted = await sop.update({
      where: { id_sop_karyawan: params.id },
      data: { deleted_at: new Date() },
      include: SOP_WITH_KATEGORI_INCLUDE,
    });

    return NextResponse.json({ message: 'SOP perusahaan dihapus (soft delete).', data: deleted });
  } catch (err) {
    console.error('DELETE /admin/sop-perusahaan/[id] error:', err);
    return NextResponse.json({ message: 'Server error.' }, { status: 500 });
  }
}
