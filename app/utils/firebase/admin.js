import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

const hasCredentials = Boolean(projectId && clientEmail && privateKey);

export const adminApp = (() => {
  if (getApps().length) {
    return getApp();
  }

  if (!hasCredentials) {
    return null;
  }

  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
})();

export const isAdminConfigured = hasCredentials;
