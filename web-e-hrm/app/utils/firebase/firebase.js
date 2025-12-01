// File: app/utils/firebase.js

import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';

// TODO: Ganti dengan konfigurasi Firebase proyek Anda
const firebaseConfig = {
  apiKey: 'AIzaSyAwMUqqmY_IhBRgHzUVD01wc9HQP7S7CGM',
  authDomain: 'e-hrm-1e3e0.firebaseapp.com',
  projectId: 'e-hrm-1e3e0',
  storageBucket: 'e-hrm-1e3e0.firebasestorage.app',
  messagingSenderId: '653765384227',
  appId: '1:653765384227:web:2a01c32629d019d634b996',
  measurementId: 'G-67QZCTNKBW',
};

// Inisialisasi Firebase
const app = initializeApp(firebaseConfig);

// Cek apakah kode berjalan di browser sebelum menginisialisasi messaging
const messaging = typeof window !== 'undefined' ? getMessaging(app) : null;

/**
 * Meminta izin notifikasi dan mendapatkan token FCM.
 */
export const requestPermissionAndGetToken = async () => {
  // Pastikan messaging sudah diinisialisasi
  if (!messaging) {
    console.log('Firebase Messaging not supported in this environment.');
    return;
  }

  // console.log('Requesting user permission for notifications...');

  try {
    // 1. Minta izin dari pengguna
    const permission = await Notification.requestPermission();

    if (permission === 'granted') {
      console.log('Notification permission granted.');

      // 2. Dapatkan token FCM
      const currentToken = await getToken(messaging, {
        // TODO: Ganti dengan VAPID key dari Firebase Console Anda
        vapidKey: 'BCg1_Slv4qHtjNk-Op4ZNUn6HeYMQR0d_LzN1xTvmv96d3Ra2OgwC_S4eXt9zEbMYuJPNVVVgksAe3Xfmb3C-YA',
      });

      if (currentToken) {
        // console.log('FCM Token received:', currentToken);
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
    // Pastikan messaging sudah diinisialisasi
    if (messaging) {
      onMessage(messaging, (payload) => {
        console.log('Foreground message received. ', payload);
        // Di sini Anda bisa menampilkan toast atau notifikasi kustom
        resolve(payload);
      });
    }
  });
