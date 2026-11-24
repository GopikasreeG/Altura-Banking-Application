import { metaCollection, serverTimestamp } from '../firebase';

export async function writeAudit({ actorUid, actorEmail, action, entityType, entityId, details = {} }) {
  const ref = metaCollection('auditLogs').doc();
  await ref.set({
    auditId: ref.id,
    actorUid: actorUid || null,
    actorEmail: actorEmail || null,
    action,
    entityType,
    entityId: entityId || null,
    details,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}
