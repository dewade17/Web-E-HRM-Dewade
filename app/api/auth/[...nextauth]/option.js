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

        // Ambil user + foto + hash
        const user = await db.user.findUnique({
          where: { email },
          select: {
            id_user: true,
            nama_pengguna: true,
            email: true,
            role: true,
            id_departement: true,
            id_location: true,
            foto_profil_user: true,
            password_hash: true,
          },
        });

        if (!user) {
          throw new Error('Email atau Password salah');
        }

        const ok = await bcrypt.compare(password, user.password_hash || '');
        if (!ok) {
          throw new Error('Email atau Password salah');
        }

        return {
          id: user.id_user,
          name: user.nama_pengguna,
          email: user.email,
          role: user.role,
          id_departement: user.id_departement,
          id_location: user.id_location,
          imageUrl: user.foto_profil_user ?? null, // <-- foto ke token
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
        token.imageUrl = user.imageUrl ?? null; // <-- simpan foto di token
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.id_departement = token.id_departement;
        session.user.id_location = token.id_location;
        session.user.image = token.imageUrl ?? null;         // konvensi NextAuth
        session.user.foto_profil_user = token.imageUrl ?? null; // alias opsional
      }
      return session;
    },
  },
};
