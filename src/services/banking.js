/**
 * SharedBank Worker bridge — uses existing live-api.js without modification.
 * All inter/intra-bank transfers and live balances go through the Worker
 * so shared ledger semantics stay intact.
 */
import bank from '../bank-config';
import { configuredEndpoint, liveApi, parseEndpoint, readStorage, saveStorage } from '../live-api';
import { toPaise } from '../amount';

const URL_KEY = 'x42-cloudflare-worker-url';
const pending = new Map();

export function getWorkerBase() {
  return configuredEndpoint || readStorage(localStorage, URL_KEY, '') || '';
}

export function saveWorkerBase(input) {
  const endpoint = parseEndpoint(input);
  saveStorage(localStorage, URL_KEY, endpoint);
  return endpoint;
}

export async function workerSignIn(base, email, password) {
  return liveApi(base, `/banks/${bank.id}/sign-in`, {
    data: { email: email.trim(), password },
  });
}

export async function workerDashboard(base, token) {
  return liveApi(base, `/banks/${bank.id}/dashboard`, { token });
}

export async function workerDirectory(base) {
  const value = await liveApi(base, '/directory/banks');
  return value.banks || [];
}

export async function workerTransfer(base, token, sessionUid, transfer) {
  const raw = JSON.stringify([bank.id, base, sessionUid, transfer]);
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)));
  const hash = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  const keyName = 'x42-pending-' + hash;
  const key = pending.get(keyName) || readStorage(sessionStorage, keyName, null) || crypto.randomUUID();
  pending.set(keyName, key);
  saveStorage(sessionStorage, keyName, key);
  try {
    const row = await liveApi(base, `/banks/${bank.id}/transfers`, { token, data: transfer, key });
    pending.delete(keyName);
    saveStorage(sessionStorage, keyName, null);
    return row;
  } catch (error) {
    // Keep idempotency key on failure so retries stay safe
    throw error;
  }
}

export function parseAmountToPaise(input) {
  return toPaise(input);
}

export { bank };
