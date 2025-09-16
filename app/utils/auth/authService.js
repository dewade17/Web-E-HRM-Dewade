'use client';

import { useSession } from 'next-auth/react';

export const useAuth = () => {
  const { data: session, status } = useSession();
  const user = session?.user ?? null;
  return {
    isLoading: status === 'loading',
    isLoggedIn: !!user,
    userId: user?.id ?? null,
    email: user?.email ?? null,
    role: user?.role ?? null,
    user,
  };
};
