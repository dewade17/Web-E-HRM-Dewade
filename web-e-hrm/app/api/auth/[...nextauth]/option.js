// app/api/auth/[...nextauth]/option.js
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import db from '@/lib/prisma';

export const authOptions = {
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET,
  pages: { signIn: '/login' },

  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = String(credentials?.email || '').toLowerCase().trim();
        const password = String(credentials?.password || '');

        if (!email || !password) {
          throw new Error('Email dan Password harus diisi');
        }

        // Ambil user + relasi sesuai skema Prisma yang kamu kirim
        const user = await db.user.findUnique({
          where: { email },
          select: {
            id_user: true,
            nama_pengguna: true,
            email: true,
            role: true,
            id_departement: true,
            id_location: true,
            id_jabatan: true,
            foto_profil_user: true,
            password_hash: true,
            divisi: true, // fallback bila departement null
            departement: { select: { nama_departement: true } },
            jabatan: { select: { nama_jabatan: true } },
          },
        });

        if (!user) throw new Error('Email atau Password salah');

        const ok = await bcrypt.compare(password, user.password_hash || '');
        if (!ok) throw new Error('Email atau Password salah');

        // Nama-nama pasti sesuai schema
        const departemenName =
          user.departement?.nama_departement || user.divisi || null; // prefer relasi, fallback ke kolom string
        const jabatanName =
          user.jabatan?.nama_jabatan || null; // kalau kosong, biarkan null; UI boleh fallback ke role

        // Siapkan payload ke token
        return {
          id: user.id_user,
          name: user.nama_pengguna,
          email: user.email,
          role: user.role,
          id_departement: user.id_departement,
          id_location: user.id_location,
          id_jabatan: user.id_jabatan,
          imageUrl: user.foto_profil_user ?? null,
          departemen_name: departemenName,
          jabatan_name: jabatanName,
        };
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.id_departement = user.id_departement ?? null;
        token.id_location = user.id_location ?? null;
        token.id_jabatan = user.id_jabatan ?? null;
        token.imageUrl = user.imageUrl ?? null;

        // kirim nama yang sudah pasti dari DB
        token.departement_name = user.departemen_name ?? null;
        token.jabatan_name = user.jabatan_name ?? null;
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.id_departement = token.id_departement ?? null;
        session.user.id_location = token.id_location ?? null;
        session.user.id_jabatan = token.id_jabatan ?? null;

        // foto
        session.user.image = token.imageUrl ?? null;
        session.user.foto_profil_user = token.imageUrl ?? null;

        // nama pasti untuk header
        session.user.departement_name = token.departement_name ?? null;
        session.user.jabatan_name = token.jabatan_name ?? null;
      }
      return session;
    },
  },
};
