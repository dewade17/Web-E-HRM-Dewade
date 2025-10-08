//app/api/admin/auth/[...nextauth]/option.js

import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import db from '@/lib/prisma';

export const authOptions = {
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET,

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

        const user = await db.user.findUnique({ where: { email } });
        if (!user) return null;

        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) return null;

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
