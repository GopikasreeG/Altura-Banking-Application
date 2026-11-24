import { metaCollection, serverTimestamp, tsToIso } from '../firebase';
import { writeAudit } from './audit';
import { notifyUser } from './notifications';
import { adminPostLedger } from './accounts';

export function mapLoan(doc) {
  const d = doc.data();
  return {
    id: doc.id,
    ...d,
    createdAt: tsToIso(d.createdAt),
    updatedAt: tsToIso(d.updatedAt),
    decidedAt: tsToIso(d.decidedAt),
  };
}

export async function applyForLoan({
  customerUid, accountId, amountMinor, tenureMonths, purpose, interestRate = 12,
}) {
  const principal = Math.floor(Number(amountMinor));
  const tenure = Math.floor(Number(tenureMonths));
  if (!Number.isSafeInteger(principal) || principal < 100000) {
    throw new Error('Minimum loan amount is ₹1,000.');
  }
  if (!Number.isSafeInteger(tenure) || tenure < 3 || tenure > 60) {
    throw new Error('Tenure must be between 3 and 60 months.');
  }
  if (!purpose?.trim()) throw new Error('Describe the loan purpose.');

  const monthlyRate = interestRate / 12 / 100;
  const emi = Math.ceil(
    (principal * monthlyRate * Math.pow(1 + monthlyRate, tenure))
    / (Math.pow(1 + monthlyRate, tenure) - 1),
  );

  const ref = metaCollection('loans').doc();
  await ref.set({
    loanId: ref.id,
    customerUid,
    accountId,
    principalMinor: principal,
    tenureMonths: tenure,
    interestRate,
    emiMinor: emi,
    purpose: purpose.trim(),
    status: 'PENDING',
    outstandingMinor: principal,
    repaidMinor: 0,
    repayments: [],
    decidedBy: null,
    decidedAt: null,
    decisionNote: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await writeAudit({
    actorUid: customerUid,
    action: 'LOAN_APPLIED',
    entityType: 'loan',
    entityId: ref.id,
    details: { principalMinor: principal, tenureMonths: tenure },
  });

  return ref.id;
}

export async function listLoansForCustomer(customerUid) {
  const snap = await metaCollection('loans')
    .where('customerUid', '==', customerUid)
    .get();
  return snap.docs.map(mapLoan).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export async function listAllLoans() {
  let snap;
  try {
    snap = await metaCollection('loans').orderBy('createdAt', 'desc').limit(200).get();
  } catch {
    snap = await metaCollection('loans').limit(200).get();
  }
  return snap.docs.map(mapLoan)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export async function decideLoan({
  loanId, status, adminUid, adminEmail, note = '',
}) {
  if (!['APPROVED', 'REJECTED'].includes(status)) throw new Error('Invalid loan decision.');
  const ref = metaCollection('loans').doc(loanId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Loan not found.');
  const loan = snap.data();
  if (loan.status !== 'PENDING') throw new Error('Loan already decided.');

  await ref.update({
    status,
    decisionNote: note,
    decidedBy: adminUid,
    decidedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    outstandingMinor: status === 'APPROVED' ? loan.principalMinor : 0,
  });

  if (status === 'APPROVED') {
    await adminPostLedger({
      accountId: loan.accountId,
      amountMinor: loan.principalMinor,
      direction: 'CREDIT',
      entryType: 'LOAN_DISBURSEMENT',
      adminUid,
      adminEmail,
      note: `Loan ${loanId} disbursement`,
    });
  }

  await writeAudit({
    actorUid: adminUid,
    actorEmail: adminEmail,
    action: `LOAN_${status}`,
    entityType: 'loan',
    entityId: loanId,
    details: { note },
  });

  await notifyUser(loan.customerUid, {
    title: status === 'APPROVED' ? 'Loan approved' : 'Loan rejected',
    body: note || `Your loan application was ${status.toLowerCase()}.`,
    type: status === 'APPROVED' ? 'SUCCESS' : 'ALERT',
    meta: { loanId, status },
  });
}

export async function requestLoanRepayment({ loanId, amountMinor, customerUid, note = '' }) {
  const amount = Math.floor(Number(amountMinor));
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Enter a valid repayment amount.');
  const ref = metaCollection('loans').doc(loanId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Loan not found.');
  const loan = snap.data();
  if (loan.customerUid !== customerUid) throw new Error('Not your loan.');
  if (loan.status !== 'APPROVED') throw new Error('Loan is not repayable.');
  if (amount > loan.outstandingMinor) throw new Error('Amount exceeds outstanding balance.');

  const pending = [...(loan.pendingRepayments || []), {
    amountMinor: amount,
    note: note.trim(),
    requestedAt: new Date().toISOString(),
    status: 'PENDING',
  }];
  await ref.update({ pendingRepayments: pending, updatedAt: serverTimestamp() });
  await writeAudit({
    actorUid: customerUid,
    action: 'LOAN_REPAYMENT_REQUEST',
    entityType: 'loan',
    entityId: loanId,
    details: { amountMinor: amount },
  });
  await notifyUser(customerUid, {
    title: 'Repayment submitted',
    body: 'Your loan repayment request is awaiting admin confirmation.',
    type: 'INFO',
    meta: { loanId },
  });
}

export async function recordLoanRepayment({
  loanId, amountMinor, adminUid, adminEmail,
}) {
  const amount = Math.floor(Number(amountMinor));
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Enter a valid repayment amount.');

  const ref = metaCollection('loans').doc(loanId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Loan not found.');
  const loan = snap.data();
  if (loan.status !== 'APPROVED' && loan.status !== 'ACTIVE') {
    throw new Error('Loan is not repayable.');
  }
  if (amount > loan.outstandingMinor) throw new Error('Amount exceeds outstanding balance.');

  await adminPostLedger({
    accountId: loan.accountId,
    amountMinor: amount,
    direction: 'DEBIT',
    entryType: 'LOAN_REPAYMENT',
    adminUid,
    adminEmail,
    note: `Loan repayment ${loanId}`,
  });

  const outstanding = loan.outstandingMinor - amount;
  const repaid = (loan.repaidMinor || 0) + amount;
  const repayments = [...(loan.repayments || []), {
    amountMinor: amount,
    at: new Date().toISOString(),
    by: adminUid,
  }];

  await ref.update({
    outstandingMinor: outstanding,
    repaidMinor: repaid,
    repayments,
    pendingRepayments: [],
    status: outstanding === 0 ? 'CLOSED' : 'APPROVED',
    updatedAt: serverTimestamp(),
  });

  await writeAudit({
    actorUid: adminUid,
    actorEmail: adminEmail,
    action: 'LOAN_REPAYMENT',
    entityType: 'loan',
    entityId: loanId,
    details: { amountMinor: amount, outstandingMinor: outstanding },
  });

  await notifyUser(loan.customerUid, {
    title: 'Loan repayment recorded',
    body: `₹${(amount / 100).toFixed(2)} was applied to your loan.`,
    type: 'SUCCESS',
    meta: { loanId, outstandingMinor: outstanding },
  });
}
