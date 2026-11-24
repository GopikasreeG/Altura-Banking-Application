import { getAuth, metaCollection, metaRef, serverTimestamp, tsToIso } from '../firebase';
import { adminEmailAllowlist } from '../firebase-config';
import { getApplication } from './applications';
import { writeAudit } from './audit';

export async function signInEmailPassword(email, password) {
  const auth = getAuth();
  const cred = await auth.signInWithEmailAndPassword(email.trim(), password);
  return cred.user;
}

export async function signOutUser() {
  await getAuth().signOut();
}

export function onAuth(callback) {
  return getAuth().onAuthStateChanged(callback);
}

export async function getAdminProfile(uid) {
  const snap = await metaCollection('admins').doc(uid).get();
  if (!snap.exists) return null;
  const d = snap.data();
  return { ...d, createdAt: tsToIso(d.createdAt) };
}

/**
 * Admin access: Firestore admin doc OR allowlisted email (first login creates doc if allowlisted).
 * Passwords are never hardcoded — only email allowlist via env.
 */
export async function ensureAdminAccess(user) {
  if (!user) return null;
  let profile = await getAdminProfile(user.uid);
  if (profile?.status === 'ACTIVE' && profile.role === 'ADMIN') return profile;

  const allow = adminEmailAllowlist();
  const email = (user.email || '').toLowerCase();
  if (allow.includes(email)) {
    const ref = metaCollection('admins').doc(user.uid);
    // Admin docs are rules-locked for client writes; try merge then fall back to allowlist session.
    try {
      await ref.set({
        uid: user.uid,
        email,
        role: 'ADMIN',
        status: 'ACTIVE',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      profile = await getAdminProfile(user.uid);
      if (profile) return profile;
    } catch {
      // Rules may block create — treat allowlisted email as admin for this session.
    }
    return {
      uid: user.uid,
      email,
      role: 'ADMIN',
      status: 'ACTIVE',
      ephemeral: true,
    };
  }
  return null;
}

export async function resolveCustomerAccess(user) {
  if (!user) return { state: 'NONE' };
  const application = await getApplication(user.uid);
  if (!application) {
    return { state: 'NO_APPLICATION', application: null };
  }
  if (application.status === 'APPROVED') {
    return { state: 'APPROVED', application };
  }
  return { state: application.status, application };
}

export async function bootstrapAdminDocFromConsoleHint() {
  return metaRef('admins', '_readme');
}

export async function logLogin(user, portal) {
  await writeAudit({
    actorUid: user.uid,
    actorEmail: user.email,
    action: 'LOGIN',
    entityType: 'session',
    entityId: user.uid,
    details: { portal },
  });
}
