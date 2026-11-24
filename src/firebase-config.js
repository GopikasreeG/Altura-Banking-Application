/**
 * Firebase web config via Vite env (never commit real secrets).
 * Web API keys are expected in VITE_* vars or localStorage bootstrap for demos.
 */
const fromEnv = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
};

const STORAGE_KEY = 'altura-firebase-web-config';

export function readLocalFirebaseConfig() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

export function saveLocalFirebaseConfig(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function clearLocalFirebaseConfig() {
  localStorage.removeItem(STORAGE_KEY);
}

export function getFirebaseConfig() {
  if (fromEnv.apiKey && fromEnv.projectId) return { ...fromEnv };
  const local = readLocalFirebaseConfig();
  if (local?.apiKey && local?.projectId) return local;
  return { ...fromEnv };
}

export function isFirebaseConfigured(config = getFirebaseConfig()) {
  return Boolean(config?.apiKey && config?.projectId);
}

export function adminEmailAllowlist() {
  const raw = import.meta.env.VITE_ADMIN_EMAILS || '';
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}
