# Altura Bank

Full customer + admin banking portal for bank **P665**, built on the SharedBank Worker ledger and Firebase (Auth, Firestore, Storage).

## Untouched shared database clients

These files remain the SharedBank integration surface and were **not** rewritten for ledger semantics:

- `src/live-api.js` — Worker HTTP client (sign-in, dashboard, transfers, idempotency)
- `src/cloudflare-config.js` — Worker origin
- `src/amount.js` — INR → paise parsing

Shared Firestore **account** and **ledgerEntries** field names/types stay compatible with the existing network (`accountId`, `accountNumber`, `customerUid`, `postedBalanceMinor`, `heldMinor`, `direction`, `entryType`, etc.).

## Features

- Attractive login + KYC registration (PENDING until admin approval)
- Separate admin portal (allowlisted emails / admin docs)
- Customer dashboard, statements CSV, beneficiaries, loans, notifications
- Internal / interbank transfers via SharedBank Worker (atomic shared ledger)
- Deposit / withdrawal requests processed by admin ledger posts
- Audit log for important actions
- Premium redesigned UI (customer + admin)

## Setup (no new npm packages required)

Firebase is loaded from the official CDN in `index.html` (no `firebase` npm install).

1. Copy `.env.example` → `.env` and fill `VITE_FIREBASE_*` (or paste config on first launch).
2. Optional: `VITE_ADMIN_EMAILS=you@bank.com` for UI allowlisting.
3. In Firestore Console create:

```
bankMeta/P665/settings/config
{
  "adminEmails": ["you@bank.com"]
}
```

4. Deploy `firestore.rules` and `storage.rules` (or paste into Console).
5. Enable Email/Password in Firebase Authentication.
6. `npm ci` / `npm run dev` with your existing dependencies (already in the project).

## Admin bootstrap

1. Create the Firebase Auth user for the admin email.
2. Ensure that email is in `bankMeta/P665/settings/config.adminEmails`.
3. Sign in via the **Admin** tab.

Passwords are never hardcoded.

## Money movement

- **Transfers:** SharedBank Worker (`live-api.js`) — customers never write balances.
- **Approval opening balance / cash / loan disbursement:** admin-only Firestore transactions that append compatible `ledgerEntries` and update `postedBalanceMinor`.
