import { metaCollection, serverTimestamp, tsToIso } from '../firebase';

export function mapBeneficiary(doc) {
  const d = doc.data();
  return { id: doc.id, ...d, createdAt: tsToIso(d.createdAt) };
}

export async function listBeneficiaries(customerUid) {
  const snap = await metaCollection('beneficiaries')
    .where('customerUid', '==', customerUid)
    .get();
  return snap.docs.map(mapBeneficiary)
    .sort((a, b) => (a.nickname || '').localeCompare(b.nickname || ''));
}

export async function addBeneficiary({
  customerUid, nickname, accountNumber, ifsc, bankName = '',
}) {
  if (!nickname?.trim() || !accountNumber?.trim() || !ifsc?.trim()) {
    throw new Error('Nickname, account number and IFSC are required.');
  }
  const ref = metaCollection('beneficiaries').doc();
  await ref.set({
    beneficiaryId: ref.id,
    customerUid,
    nickname: nickname.trim(),
    accountNumber: accountNumber.trim(),
    ifsc: ifsc.trim().toUpperCase(),
    bankName: bankName.trim(),
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function removeBeneficiary(id, customerUid) {
  const ref = metaCollection('beneficiaries').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return;
  if (snap.data().customerUid !== customerUid) throw new Error('Not allowed.');
  await ref.delete();
}
