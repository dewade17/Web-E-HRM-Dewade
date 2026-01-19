//public\firebase-messaging-sw.js
/* eslint-disable no-undef */
// File: public/firebase-messaging-sw.js
/* global importScripts */
// Import skrip Firebase (gunakan versi compat agar API lama tetap berfungsi)
importScripts('https://www.gstatic.com/firebasejs/10.12.3/firebase-app-compat.js');
importScripts('/firebase-config.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.3/firebase-messaging-compat.js');
// Konfigurasi Firebase. Jika tersedia, gunakan yang disuntikkan melalui global
// `self.__FIREBASE_CONFIG__` (misalnya dari file public/firebase-config.js).
// Jika tidak tersedia, fallback ke nilai default berikut—PASTIKAN diganti
// dengan konfigurasi proyek Anda sendiri.
const firebaseConfig = {
  apiKey: 'AIzaSyAwMUqqmY_IhBRgHzUVD01wc9HQP7S7CGM',
  authDomain: 'e-hrm-1e3e0.firebaseapp.com',
  projectId: 'e-hrm-1e3e0',
  storageBucket: 'e-hrm-1e3e0.firebasestorage.app',
  messagingSenderId: '653765384227',
  appId: '1:653765384227:web:2a01c32629d019d634b996',
  measurementId: 'G-67QZCTNKBW',
};
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
if (!firebase.messaging.isSupported()) {
  console.warn('[firebase-messaging-sw.js] Firebase Cloud Messaging tidak didukung di environment ini.');
} else {
  const messaging = firebase.messaging();
  // Handler untuk notifikasi yang diterima saat website di background
  messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Received background message ', payload);
    const notificationPayload = payload.notification || {};
    const dataPayload = payload.data || {};
    const notificationTitle = notificationPayload.title || dataPayload.title || 'Notifikasi';
    const notificationOptions = {
      body: notificationPayload.body || dataPayload.body || 'Anda memiliki notifikasi baru.',
      icon: notificationPayload.icon || dataPayload.icon || '/favicon.ico',
      image: notificationPayload.image || dataPayload.image,
      data: dataPayload,
    };
    self.registration.showNotification(notificationTitle, notificationOptions);
  });
}
