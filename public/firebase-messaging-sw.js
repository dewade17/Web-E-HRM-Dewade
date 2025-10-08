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
const firebaseConfig = self.__FIREBASE_CONFIG__ || {
  apiKey: 'AIzaSyBHaHOsrtZghC2JAeP53-rtg9gUKUmmMcM',
  authDomain: 'e-hrm-2d3fe.firebaseapp.com',
  projectId: 'e-hrm-2d3fe',
  storageBucket: 'e-hrm-2d3fe.firebasestorage.app',
  messagingSenderId: '584929841793',
  appId: '1:584929841793:web:1a1cff15646de867067380',
  measurementId: 'G-K58K7RVTHS',
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
