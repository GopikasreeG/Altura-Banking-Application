/**
 * Creates accounts using the SHARED schema (field names/types preserved).
 * Does not alter existing account documents or ledger semantics.
 */
import bank from '../bank-config';
import { getDb, metaCollection, metaRef, serverTimestamp, tsToIso, BANK_ID } from '../firebase';
import { writeAudit } from './audit';
import { notifyUser } from './notifications';

export function money(minor, currency = 'INR') {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format((minor || 0) / 100);
}

export function mapAccount(doc) {
  const d = typeof doc.data === 'function' ? doc.data() : doc;
  const id = doc.id || d.accountId;
  const posted = Number(d.postedBalanceMinor || 0);
  const held = Number(d.heldMinor || 0);
  return {
    accountId: d.accountId || id,
    accountNumber: d.accountNumber,
    customerUid: d.customerUid,
    currency: d.currency || 'INR',
    heldMinor: held,
    postedBalanceMinor: posted,
    availableMinor: posted - held,
    status: d.status || 'ACTIVE',
    isSynthetic: Boolean(d.isSynthetic),
    createdAt: tsToIso(d.createdAt),
    updatedAt: tsToIso(d.updatedAt),
  };
}

async function nextCounters() {
  const ref = metaRef('counters', 'accounts');
  const result = await getDb().runTransaction(async tx => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : { seq: 0, numberSeq: 0 };
    const seq = (data.seq || 0) + 1;
    const numberSeq = (data.numberSeq || 0) + 1;
    tx.set(ref, { seq, numberSeq, updatedAt: serverTimestamp() }, { merge: true });
    return { seq, numberSeq };
  });
  const accountId = `${BANK_ID}-${String(result.seq).padStart(3, '0')}`;
  const accountNumber = `${BANK_ID}${String(result.numberSeq).padStart(8, '0')}`;
  return { accountId, accountNumber };
}

/**
 * Writes a shared-compatible account + optional DEMO_SEED ledger CREDIT.
 */
export async function createCustomerAccount({
  customerUid, email, fullName, phone, address,
  openingBalanceMinor = 0, adminUid, adminEmail,
}) {
  const existing = await getDb().collection('accounts')
    .where('customerUid', '==', customerUid)
    .limit(1)
    .get();
  if (!existing.empty) {
    return mapAccount(existing.docs[0]);
  }

  const { accountId, accountNumber } = await nextCounters();
  const opening = Math.max(0, Math.floor(Number(openingBalanceMinor) || 0));
  const now = serverTimestamp();

  const accountDoc = {
    accountId,
    accountNumber,
    customerUid,
    currency: 'INR',
    heldMinor: 0,
    postedBalanceMinor: opening,
    status: 'ACTIVE',
    isSynthetic: true,
    createdAt: now,
    updatedAt: now,
  };

  const batch = getDb().batch();
  batch.set(getDb().collection('accounts').doc(accountId), accountDoc);

  if (opening > 0) {
    const transferId = `${BANK_ID}-CF-SEED-${accountId}`;
    const entryId = `${transferId}_CREDIT`;
    batch.set(getDb().collection('ledgerEntries').doc(entryId), {
      accountId,
      amountMinor: opening,
      currency: 'INR',
      direction: 'CREDIT',
      entryId,
      entryType: 'DEMO_SEED',
      postedAt: now,
      transferId,
    });
  }

  batch.set(metaCollection('customers').doc(customerUid), {
    customerUid,
    email,
    fullName,
    phone: phone || '',
    address: address || null,
    accountId,
    accountNumber,
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  }, { merge: true });

  await batch.commit();

  await writeAudit({
    actorUid: adminUid,
    actorEmail: adminEmail,
    action: 'ACCOUNT_CREATED',
    entityType: 'account',
    entityId: accountId,
    details: { customerUid, accountNumber, openingBalanceMinor: opening },
  });

  await notifyUser(customerUid, {
    title: 'Banking account ready',
    body: `Your account ${accountNumber} is active at ${bank.name}.`,
    type: 'SUCCESS',
    meta: { accountId, accountNumber },
  });

  return mapAccount({ id: accountId, data: () => accountDoc });
}

export async function getAccountsForCustomer(customerUid) {
  const snap = await getDb().collection('accounts')
    .where('customerUid', '==', customerUid)
    .get();
  return snap.docs.map(mapAccount);
}

export async function getAccount(accountId) {
  const snap = await getDb().collection('accounts').doc(accountId).get();
  if (!snap.exists) return null;
  return mapAccount(snap);
}

export async function listAllAccounts() {
  const snap = await getDb().collection('accounts').get();
  return snap.docs
    .map(mapAccount)
    .filter(a => String(a.accountId || '').startsWith(BANK_ID));
}

export async function setAccountStatus({ accountId, status, adminUid, adminEmail }) {
  if (!['ACTIVE', 'FROZEN', 'CLOSED'].includes(status)) throw new Error('Invalid account status.');
  const ref = getDb().collection('accounts').doc(accountId);
  await ref.update({ status, updatedAt: serverTimestamp() });
  await writeAudit({
    actorUid: adminUid,
    actorEmail: adminEmail,
    action: 'ACCOUNT_STATUS',
    entityType: 'account',
    entityId: accountId,
    details: { status },
  });
}

export async function listLedgerForAccount(accountId, limit = 100) {
  let snap;
  try {
    snap = await getDb().collection('ledgerEntries')
      .where('accountId', '==', accountId)
      .orderBy('postedAt', 'desc')
      .limit(limit)
      .get();
  } catch {
    snap = await getDb().collection('ledgerEntries')
      .where('accountId', '==', accountId)
      .limit(limit)
      .get();
  }
  return snap.docs.map(doc => {
    const d = doc.data();
    return { ...d, postedAt: tsToIso(d.postedAt) };
  }).sort((a, b) => String(b.postedAt || '').localeCompare(String(a.postedAt || '')));
}

/**
 * Admin-only atomic credit/debit against shared account + ledger schema.
 */
export async function adminPostLedger({
  accountId, amountMinor, direction, entryType = 'ADMIN_ADJUST',
  adminUid, adminEmail, note = '',
}) {
  const amount = Math.floor(Number(amountMinor));
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Amount must be a positive integer (paise).');
  if (!['CREDIT', 'DEBIT'].includes(direction)) throw new Error('direction must be CREDIT or DEBIT.');

  const transferId = `${BANK_ID}-ADJ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const entryId = `${transferId}_${direction}`;
  const accountRef = getDb().collection('accounts').doc(accountId);
  const entryRef = getDb().collection('ledgerEntries').doc(entryId);

  await getDb().runTransaction(async tx => {
    const snap = await tx.get(accountRef);
    if (!snap.exists) throw new Error('Account not found.');
    const account = snap.data();
    if (account.status !== 'ACTIVE') throw new Error('Account is not active.');
    const posted = Number(account.postedBalanceMinor || 0);
    const held = Number(account.heldMinor || 0);
    const next = direction === 'CREDIT' ? posted + amount : posted - amount;
    if (next < held) throw new Error('Insufficient available balance.');
    tx.update(accountRef, {
      postedBalanceMinor: next,
      updatedAt: serverTimestamp(),
    });
    tx.set(entryRef, {
      accountId,
      amountMinor: amount,
      currency: account.currency || 'INR',
      direction,
      entryId,
      entryType,
      postedAt: serverTimestamp(),
      transferId,
      note: note || null,
    });
  });

  await writeAudit({
    actorUid: adminUid,
    actorEmail: adminEmail,
    action: 'LEDGER_POST',
    entityType: 'ledger',
    entityId: entryId,
    details: { accountId, amountMinor: amount, direction, entryType, note },
  });

  return { entryId, transferId };
}

export async function processCashRequest({
  requestId, approve, adminUid, adminEmail, note = '',
}) {
  const reqRef = metaCollection('cashRequests').doc(requestId);
  await getDb().runTransaction(async tx => {
    const snap = await tx.get(reqRef);
    if (!snap.exists) throw new Error('Request not found.');
    const req = snap.data();
    if (req.status !== 'PENDING') throw new Error('Request already processed.');
    if (!approve) {
      tx.update(reqRef, {
        status: 'REJECTED',
        reviewNote: note,
        reviewedBy: adminUid,
        reviewedAt: serverTimestamp(),
      });
      return;
    }
    // Mark approved first; ledger post happens after txn to reuse helper safely
    tx.update(reqRef, {
      status: 'APPROVED',
      reviewNote: note,
      reviewedBy: adminUid,
      reviewedAt: serverTimestamp(),
    });
  });

  const after = await reqRef.get();
  const req = after.data();
  if (req.status === 'APPROVED') {
    const direction = req.type === 'DEPOSIT' ? 'CREDIT' : 'DEBIT';
    await adminPostLedger({
      accountId: req.accountId,
      amountMinor: req.amountMinor,
      direction,
      entryType: req.type === 'DEPOSIT' ? 'CASH_DEPOSIT' : 'CASH_WITHDRAWAL',
      adminUid,
      adminEmail,
      note: note || req.note || '',
    });
  }

  await notifyUser(req.customerUid, {
    title: req.status === 'APPROVED' ? `${req.type} approved` : `${req.type} rejected`,
    body: note || `Your ${req.type.toLowerCase()} request was ${req.status.toLowerCase()}.`,
    type: req.status === 'APPROVED' ? 'SUCCESS' : 'ALERT',
    meta: { requestId, status: req.status },
  });

  return req.status;
}

export async function submitCashRequest({
  customerUid, accountId, type, amountMinor, note = '',
}) {
  if (!['DEPOSIT', 'WITHDRAWAL'].includes(type)) throw new Error('Invalid cash request type.');
  const amount = Math.floor(Number(amountMinor));
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Enter a valid amount.');

  const account = await getAccount(accountId);
  if (!account || account.customerUid !== customerUid) throw new Error('Account not found.');
  if (account.status !== 'ACTIVE') throw new Error('Account is not active.');
  if (type === 'WITHDRAWAL' && account.availableMinor < amount) {
    throw new Error('Insufficient available balance.');
  }

  const ref = metaCollection('cashRequests').doc();
  await ref.set({
    requestId: ref.id,
    customerUid,
    accountId,
    type,
    amountMinor: amount,
    currency: 'INR',
    note: note.trim(),
    status: 'PENDING',
    createdAt: serverTimestamp(),
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: '',
  });

  await writeAudit({
    actorUid: customerUid,
    action: 'CASH_REQUEST',
    entityType: 'cashRequest',
    entityId: ref.id,
    details: { type, amountMinor: amount, accountId },
  });

  return ref.id;
}

export async function listCashRequests(status = 'PENDING') {
  let snap;
  try {
    snap = await metaCollection('cashRequests').orderBy('createdAt', 'desc').limit(100).get();
  } catch {
    snap = await metaCollection('cashRequests').limit(100).get();
  }
  return snap.docs
    .map(doc => {
      const d = doc.data();
      return { ...d, id: doc.id, createdAt: tsToIso(d.createdAt), reviewedAt: tsToIso(d.reviewedAt) };
    })
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .filter(r => status === 'ALL' || r.status === status);
}
