// app/api/auth/[...nextauth]/option.js
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import db from '@/lib/prisma'; // pastikan alias @/ sudah di jsconfig/tsconfig

export const authOptions = {
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,
  pages: { signIn: '/auth/login' }, // sesuaikan dgn halaman login kamu

  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = String(credentials?.email || '')
          .toLowerCase()
          .trim();
        const password = String(credentials?.password || '');

        const user = await db.user.findUnique({
          where: { email },
          select: {
            id_user: true,
            nama_pengguna: true,
            email: true,
            role: true,
            id_departement: true,
            id_location: true,
            password_hash: true,
            deleted_at: true, // kalau pakai soft delete
          },
        });

        if (!user || user.deleted_at) return null;

        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) return null;

        // minimal identity utk JWT
        return {
          id: user.id_user,
          name: user.nama_pengguna,
          email: user.email,
          role: user.role,
          id_departement: user.id_departement,
          id_location: user.id_location,
        };
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.id_departement = user.id_departement;
        token.id_location = user.id_location;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.id_departement = token.id_departement;
        session.user.id_location = token.id_location;
      }
      return session;
    },
  },
};
