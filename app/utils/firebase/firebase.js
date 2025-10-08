// File: app/utils/firebase.js

import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';

// TODO: Ganti dengan konfigurasi Firebase proyek Anda
const firebaseConfig = {
  apiKey: 'AIzaSyBHaHOsrtZghC2JAeP53-rtg9gUKUmmMcM',
  authDomain: 'e-hrm-2d3fe.firebaseapp.com',
  projectId: 'e-hrm-2d3fe',
  storageBucket: 'e-hrm-2d3fe.firebasestorage.app',
  messagingSenderId: '584929841793',
  appId: '1:584929841793:web:1a1cff15646de867067380',
  measurementId: 'G-K58K7RVTHS',
};

// Inisialisasi Firebase
const app = initializeApp(firebaseConfig);
const messaging = getMessaging(app);

/**
 * Meminta izin notifikasi dan mendapatkan token FCM.
 */
export const requestPermissionAndGetToken = async () => {
  console.log('Requesting user permission for notifications...');

  try {
    // 1. Minta izin dari pengguna
    const permission = await Notification.requestPermission();

    if (permission === 'granted') {
      console.log('Notification permission granted.');

      // 2. Dapatkan token FCM
      const currentToken = await getToken(messaging, {
        // TODO: Ganti dengan VAPID key dari Firebase Console Anda
        vapidKey: 'YOUR_VAPID_KEY_FROM_FIREBASE_CONSOLE',
      });

      if (currentToken) {
        console.log('FCM Token received:', currentToken);
        // 3. Kirim token ke backend untuk disimpan
        await sendTokenToServer(currentToken);
      } else {
        console.log('No registration token available. Request permission to generate one.');
      }
    } else {
      console.log('Unable to get permission to notify.');
    }
  } catch (error) {
    console.error('An error occurred while retrieving token. ', error);
  }
};

/**
 * Mengirim token ke server backend.
 * @param {string} token - FCM token.
 */
const sendTokenToServer = async (token) => {
  try {
    const response = await fetch('/api/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token }),
    });

    if (response.ok) {
      console.log('Token sent to server successfully.');
    } else {
      console.error('Failed to send token to server.');
    }
  } catch (error) {
    console.error('Error sending token to server:', error);
  }
};

/**
 * Menangani notifikasi yang masuk saat website sedang dibuka (foreground).
 */
export const onMessageListener = () =>
  new Promise((resolve) => {
    onMessage(messaging, (payload) => {
      console.log('Foreground message received. ', payload);
      // Di sini Anda bisa menampilkan toast atau notifikasi kustom
      resolve(payload);
    });
  });
