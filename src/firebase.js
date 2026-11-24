import bank from './bank-config';
import { getFirebaseConfig, isFirebaseConfigured } from './firebase-config';

const BANK_ID = bank.id;

let app = null;
let auth = null;
let db = null;
let storage = null;
let ready = false;

function sdk() {
  const f = window.firebase;
  if (!f) throw new Error('Firebase SDK failed to load. Check your network connection.');
  return f;
}

export function ensureFirebase() {
  if (ready) return { app, auth, db, storage };
  const config = getFirebaseConfig();
  if (!isFirebaseConfigured(config)) {
    throw new Error('Firebase is not configured. Add the VITE_FIREBASE_* values to your .env file and restart the dev server.');
  }
  const firebase = sdk();
  app = firebase.apps?.length ? firebase.app() : firebase.initializeApp(config);
  auth = firebase.auth();
  db = firebase.firestore();
  storage = firebase.storage();
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch { /* already started */ }
  ready = true;
  return { app, auth, db, storage };
}

export function getAuth() { return ensureFirebase().auth; }
export function getDb() { return ensureFirebase().db; }
export function getStorage() { return ensureFirebase().storage; }

export function bankPath(...parts) {
  return ['bankMeta', BANK_ID, ...parts].join('/');
}

export function metaRef(...parts) {
  return getDb().doc(bankPath(...parts));
}

export function metaCollection(name) {
  return getDb().collection('bankMeta').doc(BANK_ID).collection(name);
}

export function serverTimestamp() {
  return sdk().firestore.FieldValue.serverTimestamp();
}

export function increment(n) {
  return sdk().firestore.FieldValue.increment(n);
}

export function tsToIso(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
}

export { BANK_ID };
