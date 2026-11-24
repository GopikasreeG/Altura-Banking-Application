import { getDb, metaCollection, serverTimestamp, tsToIso } from '../firebase';

export async function notifyUser(userUid, { title, body, type = 'INFO', meta = {} }) {
  const ref = metaCollection('notifications').doc();
  await ref.set({
    notificationId: ref.id,
    userUid,
    title,
    body,
    type,
    meta,
    read: false,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export function mapNotification(doc) {
  const d = doc.data();
  return { id: doc.id, ...d, createdAt: tsToIso(d.createdAt) };
}

export async function listNotifications(userUid, limit = 40) {
  try {
    const snap = await metaCollection('notifications')
      .where('userUid', '==', userUid)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map(mapNotification);
  } catch {
    const snap = await metaCollection('notifications')
      .where('userUid', '==', userUid)
      .limit(limit)
      .get();
    return snap.docs.map(mapNotification)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }
}

export async function markNotificationRead(id) {
  await metaCollection('notifications').doc(id).update({ read: true });
}

export async function markAllNotificationsRead(userUid) {
  const snap = await metaCollection('notifications')
    .where('userUid', '==', userUid)
    .where('read', '==', false)
    .limit(50)
    .get();
  if (snap.empty) return;
  const batch = getDb().batch();
  snap.docs.forEach(doc => batch.update(doc.ref, { read: true }));
  await batch.commit();
}
