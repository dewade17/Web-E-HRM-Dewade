import { NextResponse } from 'next/server';
import db from '../../../../lib/prisma';
import { verifyAuthToken } from '../../../../lib/jwt';
import { authenticateRequest } from '../../../utils/auth/authUtils';

async function getActor(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const payload = verifyAuthToken(auth.slice(7));
      return { id: payload?.sub || payload?.id_user || payload?.userId, role: payload?.role, source: 'bearer' };
    } catch (_) {}
  }
  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;
  return { id: sessionOrRes.user.id, role: sessionOrRes.user.role, source: 'session' };
}

const ALLOWED_ORDER_BY = new Set(['created_at', 'updated_at', 'nama_pengguna', 'email', 'role', 'status_cuti']);

export async function GET(req) {
  const actor = await getActor(req);
  if (actor instanceof NextResponse) return actor; // unauthorized
  if (!['HR', 'DIREKTUR', 'OPERASIONAL', 'SUPERADMIN'].includes(actor.role)) {
    return NextResponse.json({ message: 'Forbidden: tidak memiliki akses.' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);

    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
    const pageSize = Math.min(Math.max(parseInt(searchParams.get('pageSize') || '10', 10), 1), 100);

    const search = (searchParams.get('search') || '').trim();
    const role = (searchParams.get('role') || '').trim();
    const statusCutiParam = (searchParams.get('statusCuti') || '').trim().toLowerCase();
    const statusCuti = statusCutiParam === 'aktif' || statusCutiParam === 'nonaktif' ? statusCutiParam : '';
    const departementId = (searchParams.get('departementId') || '').trim();
    const locationId = (searchParams.get('locationId') || '').trim();
    const jabatanId = (searchParams.get('jabatanId') || '').trim();
    const namaPengguna = (searchParams.get('namaPengguna') || '').trim();
    const includeDeleted = (searchParams.get('includeDeleted') || '') === '1';
    const orderByParam = (searchParams.get('orderBy') || 'created_at').trim();
    const orderBy = ALLOWED_ORDER_BY.has(orderByParam) ? orderByParam : 'created_at';
    const sort = (searchParams.get('sort') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    const where = {
      ...(includeDeleted ? {} : { deleted_at: null }),
      ...(role ? { role } : {}),
      ...(departementId ? { id_departement: departementId } : {}),
      ...(statusCuti ? { status_cuti: statusCuti } : {}),
      ...(locationId ? { id_location: locationId } : {}),
      ...(jabatanId ? { id_jabatan: jabatanId } : {}),
      ...(namaPengguna ? { nama_pengguna: { contains: namaPengguna } } : {}),
      ...(search
        ? {
            OR: [
              { nama_pengguna: { contains: search } },
              { email: { contains: search } },
              { kontak: { contains: search } },
            ],
          }
        : {}),
    };

    const [total, data] = await Promise.all([
      db.user.count({ where }),
      db.user.findMany({
        where,
        orderBy: { [orderBy]: sort },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id_user: true,
          nama_pengguna: true,
          email: true,
          kontak: true,

          // NEW: kontak darurat
          nama_kontak_darurat: true,
          kontak_darurat: true,

          agama: true,
          foto_profil_user: true,
          tanggal_lahir: true,
          tempat_lahir: true,
          jenis_kelamin: true,
          golongan_darah: true,
          status_perkawinan: true,
          alamat_ktp: true,
          alamat_ktp_provinsi: true,
          alamat_ktp_kota: true,
          alamat_domisili: true,
          alamat_domisili_provinsi: true,
          alamat_domisili_kota: true,
          zona_waktu: true,
          jenjang_pendidikan: true,
          jurusan: true,
          nama_institusi_pendidikan: true,
          tahun_lulus: true,
          nomor_induk_karyawan: true,
          divisi: true,
          role: true,
          id_departement: true,
          id_location: true,
          id_jabatan: true,
          status_kerja: true,
          status_cuti: true,

          tanggal_mulai_bekerja: true,
          nomor_rekening: true,
          jenis_bank: true,

          created_at: true,
          updated_at: true,

          deleted_at: true,
          catatan_delete: true,

          departement: { select: { id_departement: true, nama_departement: true } },
          kantor: { select: { id_location: true, nama_kantor: true } },
          jabatan: { select: { id_jabatan: true, nama_jabatan: true } },
        },
      }),
    ]);

    return NextResponse.json({
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err) {
    console.error('GET /users error:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
