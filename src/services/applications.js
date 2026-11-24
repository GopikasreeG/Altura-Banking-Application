import { getAuth, getStorage, metaCollection, serverTimestamp, tsToIso, BANK_ID } from '../firebase';
import { writeAudit } from './audit';
import { notifyUser } from './notifications';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_BYTES = 8 * 1024 * 1024;

function validateFile(file, label) {
  if (!file) throw new Error(`${label} is required.`);
  if (!ALLOWED_TYPES.includes(file.type)) throw new Error(`${label} must be JPG, PNG, WEBP, or PDF.`);
  if (file.size > MAX_BYTES) throw new Error(`${label} must be under 8 MB.`);
}

async function uploadKyc(uid, kind, file) {
  validateFile(file, kind);
  const ext = file.name.split('.').pop() || 'bin';
  const path = `kyc/${BANK_ID}/${uid}/${kind}-${Date.now()}.${ext}`;
  const ref = getStorage().ref().child(path);
  await ref.put(file, { contentType: file.type, customMetadata: { kind, uid } });
  const url = await ref.getDownloadURL();
  return { path, url, contentType: file.type, fileName: file.name, size: file.size };
}

export function mapApplication(doc) {
  const d = doc.data();
  return {
    id: doc.id,
    ...d,
    createdAt: tsToIso(d.createdAt),
    updatedAt: tsToIso(d.updatedAt),
    reviewedAt: tsToIso(d.reviewedAt),
  };
}

export async function registerCustomer({
  email, password, fullName, phone, dateOfBirth, addressLine, city, state, pincode,
  idProofFile, addressProofFile, photoFile,
}) {
  if (!fullName?.trim() || !phone?.trim() || !addressLine?.trim()) {
    throw new Error('Please complete all personal details.');
  }
  if (!/^\S+@\S+\.\S+$/.test(email.trim())) throw new Error('Enter a valid email address.');
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');

  const auth = getAuth();
  const cred = await auth.createUserWithEmailAndPassword(email.trim(), password);
  const uid = cred.user.uid;
  await cred.user.updateProfile({ displayName: fullName.trim() });

  try {
    const [idProof, addressProof, photo] = await Promise.all([
      uploadKyc(uid, 'idProof', idProofFile),
      uploadKyc(uid, 'addressProof', addressProofFile),
      uploadKyc(uid, 'photo', photoFile),
    ]);

    const payload = {
      customerUid: uid,
      email: email.trim().toLowerCase(),
      fullName: fullName.trim(),
      phone: phone.trim(),
      dateOfBirth: dateOfBirth || null,
      address: {
        line: addressLine.trim(),
        city: city.trim(),
        state: state.trim(),
        pincode: pincode.trim(),
      },
      kyc: { idProof, addressProof, photo },
      status: 'PENDING',
      reviewNote: '',
      reviewedBy: null,
      reviewedAt: null,
      accountId: null,
      accountNumber: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await metaCollection('applications').doc(uid).set(payload);
    await writeAudit({
      actorUid: uid,
      actorEmail: email.trim().toLowerCase(),
      action: 'APPLICATION_SUBMITTED',
      entityType: 'application',
      entityId: uid,
      details: { status: 'PENDING' },
    });
    return { uid, status: 'PENDING' };
  } catch (error) {
    try { await cred.user.delete(); } catch { /* ignore */ }
    throw error;
  }
}

export async function getApplication(uid) {
  const snap = await metaCollection('applications').doc(uid).get();
  if (!snap.exists) return null;
  return mapApplication(snap);
}

export async function listApplications(statusFilter = 'ALL') {
  let snap;
  try {
    snap = await metaCollection('applications').orderBy('createdAt', 'desc').get();
  } catch {
    snap = await metaCollection('applications').get();
  }
  let rows = snap.docs.map(mapApplication)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  if (statusFilter && statusFilter !== 'ALL') {
    rows = rows.filter(r => r.status === statusFilter);
  }
  return rows;
}

export async function setApplicationStatus({
  applicationId, status, note, adminUid, adminEmail, openingBalanceMinor = 0,
}) {
  if (!['APPROVED', 'REJECTED', 'ON_HOLD', 'PENDING'].includes(status)) {
    throw new Error('Invalid application status.');
  }

  const appRef = metaCollection('applications').doc(applicationId);
  const snap = await appRef.get();
  if (!snap.exists) throw new Error('Application not found.');
  const app = snap.data();

  let accountInfo = null;
  if (status === 'APPROVED') {
    const { createCustomerAccount } = await import('./accounts.js');
    accountInfo = await createCustomerAccount({
      customerUid: app.customerUid,
      email: app.email,
      fullName: app.fullName,
      phone: app.phone,
      address: app.address,
      openingBalanceMinor,
      adminUid,
      adminEmail,
    });
  }

  await appRef.update({
    status,
    reviewNote: note || '',
    reviewedBy: adminUid,
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...(accountInfo ? {
      accountId: accountInfo.accountId,
      accountNumber: accountInfo.accountNumber,
    } : {}),
  });

  await writeAudit({
    actorUid: adminUid,
    actorEmail: adminEmail,
    action: `APPLICATION_${status}`,
    entityType: 'application',
    entityId: applicationId,
    details: { note, accountId: accountInfo?.accountId || null },
  });

  await notifyUser(app.customerUid, {
    title: status === 'APPROVED' ? 'Account approved'
      : status === 'REJECTED' ? 'Application rejected'
        : status === 'ON_HOLD' ? 'Application on hold'
          : 'Application updated',
    body: note || `Your Altura Bank application is now ${status}.`,
    type: status === 'APPROVED' ? 'SUCCESS' : status === 'REJECTED' ? 'ALERT' : 'INFO',
    meta: { applicationId, status, accountId: accountInfo?.accountId || null },
  });

  return { ...mapApplication(await appRef.get()), accountInfo };
}
