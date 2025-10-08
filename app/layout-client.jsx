'use client';

import { useEffect } from 'react';
import { SessionProvider } from 'next-auth/react';
import AuthWrapper from './utils/auth/authWrapper';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { requestPermissionAndGetToken } from './utils/firebase/firebase';

export default function LayoutClient({ children }) {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const registerFirebaseMessaging = async () => {
      if (!('serviceWorker' in navigator)) {
        console.warn('[LayoutClient] Service workers are not supported in this browser.');
        return;
      }

      try {
        await navigator.serviceWorker.register('/firebase-messaging-sw.js');
        await requestPermissionAndGetToken();
      } catch (error) {
        console.error('[LayoutClient] Failed to register Firebase messaging service worker.', error);
      }
    };

    registerFirebaseMessaging();
  }, []);

  return (
    <SessionProvider>
      <AuthWrapper>
        <AntdRegistry>{children}</AntdRegistry>
      </AuthWrapper>
    </SessionProvider>
  );
}
