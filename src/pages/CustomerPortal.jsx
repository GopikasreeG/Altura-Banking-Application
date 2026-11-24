import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight, Bell, Building2, CreditCard, FileText, Landmark,
  LayoutDashboard, LogOut, PiggyBank, RefreshCw, Send, UserRound, Users,
} from 'lucide-react';
import bank from '../bank-config';
import { Alert, Badge, BrandMark, Field, Panel, downloadCsv, formatTime, money } from '../components/ui';
import { getAccountsForCustomer, listLedgerForAccount, submitCashRequest } from '../services/accounts';
import { addBeneficiary, listBeneficiaries, removeBeneficiary } from '../services/beneficiaries';
import {
  getWorkerBase, parseAmountToPaise, saveWorkerBase, workerDashboard,
  workerDirectory, workerSignIn, workerTransfer,
} from '../services/banking';
import { applyForLoan, listLoansForCustomer, requestLoanRepayment } from '../services/loans';
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '../services/notifications';
import { signOutUser } from '../services/auth';

const NAV = [
  ['overview', 'Overview', LayoutDashboard],
  ['transfer', 'Transfer', Send],
  ['cash', 'Deposit / Withdraw', PiggyBank],
  ['loans', 'Loans', CreditCard],
  ['beneficiaries', 'Beneficiaries', Users],
  ['statements', 'Statements', FileText],
  ['profile', 'Profile & KYC', UserRound],
  ['alerts', 'Notifications', Bell],
];

function PendingGate({ application, onSignOut }) {
  return (
    <div className="auth-screen app-shell">
      <aside className="auth-visual">
        <BrandMark light />
        <div className="auth-copy">
          <h1>Application under review</h1>
          <p>Banking features unlock after KYC approval. You can sign out and return anytime.</p>
        </div>
      </aside>
      <div className="auth-panel">
        <div className="auth-card">
          <h2>Status: {application?.status || 'PENDING'}</h2>
          <p className="sub">We received your documents{application?.fullName ? ` for ${application.fullName}` : ''}.</p>
          <Alert kind="info">
            {application?.reviewNote || 'An administrator will approve, reject, or place your application on hold.'}
          </Alert>
          <button type="button" className="btn btn-primary btn-block" onClick={onSignOut}>Sign out</button>
        </div>
      </div>
    </div>
  );
}

export default function CustomerPortal({ session, onSignOut }) {
  const { user, access } = session;
  const application = access?.application;
  const [tab, setTab] = useState('overview');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [loans, setLoans] = useState([]);
  const [beneficiaries, setBeneficiaries] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [workerBase, setWorkerBase] = useState(() => getWorkerBase());
  const [workerSession, setWorkerSession] = useState(null);
  const [workerData, setWorkerData] = useState({ accounts: [], transfers: [] });
  const [directory, setDirectory] = useState([]);
  const [busy, setBusy] = useState(false);

  const approved = access?.state === 'APPROVED';

  const refreshLocal = useCallback(async () => {
    if (!approved) return;
    const [accs, loanRows, bens, notes] = await Promise.all([
      getAccountsForCustomer(user.uid),
      listLoansForCustomer(user.uid),
      listBeneficiaries(user.uid),
      listNotifications(user.uid),
    ]);
    setAccounts(accs);
    setLoans(loanRows);
    setBeneficiaries(bens);
    setNotifications(notes);
    if (accs[0]) setLedger(await listLedgerForAccount(accs[0].accountId));
  }, [approved, user.uid]);

  const connectWorker = useCallback(async (password) => {
    if (!workerBase) return null;
    const signed = await workerSignIn(workerBase, user.email, password);
    setWorkerSession(signed);
    const [dash, banks] = await Promise.all([
      workerDashboard(workerBase, signed.token),
      workerDirectory(workerBase).catch(() => []),
    ]);
    setWorkerData(dash);
    setDirectory(banks);
    return signed;
  }, [workerBase, user.email]);

  useEffect(() => {
    if (!approved) return undefined;
    refreshLocal().catch(err => setError(err.message));
  }, [approved, refreshLocal]);

  const primary = accounts[0] || workerData.accounts?.[0];
  const displayAccounts = accounts.length ? accounts : (workerData.accounts || []);

  async function handleSignOut() {
    await signOutUser();
    onSignOut();
  }

  if (!approved) {
    return <PendingGate application={application} onSignOut={handleSignOut} />;
  }

  async function refreshAll(password) {
    setBusy(true);
    setError('');
    try {
      await refreshLocal();
      if (workerBase) {
        if (workerSession) {
          const dash = await workerDashboard(workerBase, workerSession.token);
          setWorkerData(dash);
        } else if (password) {
          await connectWorker(password);
        }
      }
      setNote('Balances refreshed.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="portal app-shell">
      <aside className="side">
        <BrandMark light />
        <nav>
          {NAV.map(([id, label, Icon]) => (
            <button key={id} type="button" className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              <Icon size={17} /> {label}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <button type="button" className="btn btn-ghost" style={{ color: '#dff2ec', borderColor: '#ffffff22' }} onClick={() => refreshAll()}>
            <RefreshCw size={16} /> Refresh
          </button>
          <button type="button" className="btn btn-ghost" style={{ color: '#dff2ec', borderColor: '#ffffff22' }} onClick={handleSignOut}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>

      <div className="main-col">
        <div className="mobile-bar">
          {NAV.map(([id, label]) => (
            <button key={id} type="button" className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
        <header className="topbar">
          <div>
            <h1>{bank.name} · Customer</h1>
            <p className="tiny muted">{user.email}</p>
          </div>
          <Badge status={application?.status || 'APPROVED'} />
        </header>
        <main className="content">
          {error && <Alert kind="error" onClose={() => setError('')}>{error}</Alert>}
          {note && <Alert kind="ok" onClose={() => setNote('')}>{note}</Alert>}

          {tab === 'overview' && (
            <>
              <div className="account-hero">
                <div className="row">
                  <div>
                    <div className="label">Available balance</div>
                    <div className="balance">{money(primary?.availableMinor ?? primary?.postedBalanceMinor - (primary?.heldMinor || 0) ?? 0)}</div>
                  </div>
                  <Landmark size={28} />
                </div>
                <div className="meta">
                  <span className="pill">A/C {primary?.accountNumber || '—'}</span>
                  <span className="pill">ID {primary?.accountId || application?.accountId || '—'}</span>
                  <span className="pill">{primary?.currency || 'INR'}</span>
                  <span className="pill">{primary?.status || 'ACTIVE'}</span>
                </div>
              </div>
              <div className="stat-grid">
                <div className="stat-card"><span>Posted</span><strong>{money(primary?.postedBalanceMinor)}</strong></div>
                <div className="stat-card"><span>Held</span><strong>{money(primary?.heldMinor)}</strong></div>
                <div className="stat-card"><span>Loans</span><strong>{loans.filter(l => l.status === 'APPROVED').length}</strong></div>
                <div className="stat-card"><span>Alerts</span><strong>{notifications.filter(n => !n.read).length}</strong></div>
              </div>
              <Panel title="Recent ledger" subtitle="Shared ledger entries for your account">
                {ledger.length ? (
                  <div className="table-wrap"><table className="data">
                    <thead><tr><th>Entry</th><th>Type</th><th>Amount</th><th>When</th></tr></thead>
                    <tbody>
                      {ledger.slice(0, 8).map(row => (
                        <tr key={row.entryId}>
                          <td><strong>{row.entryId}</strong><small>{row.transferId}</small></td>
                          <td>{row.entryType} · {row.direction}</td>
                          <td>{money(row.amountMinor)}</td>
                          <td>{formatTime(row.postedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                ) : <div className="empty">No ledger activity yet.</div>}
              </Panel>
              <WorkerConnect
                base={workerBase}
                setBase={setWorkerBase}
                connected={Boolean(workerSession)}
                onConnect={async (password, url) => {
                  try {
                    const endpoint = saveWorkerBase(url || workerBase);
                    setWorkerBase(endpoint);
                    await connectWorker(password);
                    setNote('Connected to SharedBank Worker for live transfers.');
                  } catch (err) { setError(err.message); }
                }}
              />
            </>
          )}

          {tab === 'transfer' && (
            <TransferPanel
              bank={bank}
              accounts={displayAccounts}
              directory={directory}
              beneficiaries={beneficiaries}
              workerSession={workerSession}
              workerBase={workerBase}
              onNeedWorker={() => setError('Connect the SharedBank Worker from Overview (email password) before transferring.')}
              onDone={async (msg) => {
                setNote(msg);
                if (workerSession) {
                  setWorkerData(await workerDashboard(workerBase, workerSession.token));
                }
                await refreshLocal();
              }}
              onError={setError}
            />
          )}

          {tab === 'cash' && (
            <CashPanel
              account={primary}
              uid={user.uid}
              onDone={async (msg) => { setNote(msg); await refreshLocal(); }}
              onError={setError}
            />
          )}

          {tab === 'loans' && (
            <LoansPanel
              loans={loans}
              account={primary}
              uid={user.uid}
              onDone={async (msg) => { setNote(msg); await refreshLocal(); }}
              onError={setError}
            />
          )}

          {tab === 'beneficiaries' && (
            <BeneficiariesPanel
              rows={beneficiaries}
              uid={user.uid}
              onChange={async () => { setBeneficiaries(await listBeneficiaries(user.uid)); }}
              onError={setError}
            />
          )}

          {tab === 'statements' && (
            <Panel title="Statements" subtitle="Download ledger as CSV" action={
              <button type="button" className="btn btn-soft" disabled={!ledger.length} onClick={() => {
                downloadCsv(`altura-${primary?.accountNumber || 'account'}-statement.csv`, [
                  ['entryId', 'transferId', 'direction', 'entryType', 'amountMinor', 'currency', 'postedAt'],
                  ...ledger.map(r => [r.entryId, r.transferId, r.direction, r.entryType, r.amountMinor, r.currency, r.postedAt]),
                ]);
              }}>Download CSV</button>
            }>
              {ledger.length ? (
                <div className="table-wrap"><table className="data">
                  <thead><tr><th>Entry</th><th>Direction</th><th>Amount</th><th>Posted</th></tr></thead>
                  <tbody>{ledger.map(r => (
                    <tr key={r.entryId}>
                      <td><strong>{r.entryType}</strong><small>{r.entryId}</small></td>
                      <td>{r.direction}</td>
                      <td>{money(r.amountMinor)}</td>
                      <td>{formatTime(r.postedAt)}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              ) : <div className="empty">No transactions to export.</div>}
            </Panel>
          )}

          {tab === 'profile' && (
            <Panel title="Profile & KYC" subtitle="Details from your approved application">
              <div className="form-grid two">
                <div><span className="tiny muted">Name</span><strong>{application?.fullName}</strong></div>
                <div><span className="tiny muted">Email</span><strong>{application?.email}</strong></div>
                <div><span className="tiny muted">Phone</span><strong>{application?.phone}</strong></div>
                <div><span className="tiny muted">Account</span><strong>{application?.accountNumber || primary?.accountNumber}</strong></div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <span className="tiny muted">Address</span>
                  <strong>
                    {[application?.address?.line, application?.address?.city, application?.address?.state, application?.address?.pincode].filter(Boolean).join(', ')}
                  </strong>
                </div>
              </div>
              <div className="kyc-grid" style={{ marginTop: 16 }}>
                {['idProof', 'addressProof', 'photo'].map(key => {
                  const doc = application?.kyc?.[key];
                  return (
                    <div className="kyc-card" key={key}>
                      <strong>{key}</strong>
                      {doc?.contentType?.startsWith('image/') && doc.url
                        ? <img src={doc.url} alt={key} />
                        : <div className="empty" style={{ minHeight: 100 }}>Document on file</div>}
                      {doc?.url && <a href={doc.url} target="_blank" rel="noreferrer">Open</a>}
                    </div>
                  );
                })}
              </div>
            </Panel>
          )}

          {tab === 'alerts' && (
            <Panel title="Notifications" action={
              <button type="button" className="btn btn-ghost" onClick={async () => {
                await markAllNotificationsRead(user.uid);
                setNotifications(await listNotifications(user.uid));
              }}>Mark all read</button>
            }>
              {notifications.length ? notifications.map(n => (
                <div key={n.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
                  <div>
                    <strong>{n.title}</strong>
                    <p className="tiny muted">{n.body}</p>
                    <p className="tiny muted">{formatTime(n.createdAt)}</p>
                  </div>
                  {!n.read && (
                    <button type="button" className="btn btn-soft" onClick={async () => {
                      await markNotificationRead(n.id);
                      setNotifications(await listNotifications(user.uid));
                    }}>Read</button>
                  )}
                </div>
              )) : <div className="empty">No notifications.</div>}
            </Panel>
          )}
        </main>
      </div>
    </div>
  );
}

function WorkerConnect({ base, setBase, connected, onConnect }) {
  const [url, setUrl] = useState(base || '');
  const [password, setPassword] = useState('');
  return (
    <Panel title="SharedBank Worker" subtitle="Live transfers use the existing Worker + shared ledger. Sign in with the same password to obtain a Worker session.">
      <div className="form-grid two">
        <Field label="Worker URL"><input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://….workers.dev" /></Field>
        <Field label="Confirm password for Worker session">
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} />
        </Field>
      </div>
      <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
        <button type="button" className="btn btn-primary" onClick={() => onConnect(password, url)}>
          <Building2 size={16} /> {connected ? 'Reconnect' : 'Connect Worker'}
        </button>
        <span className="tiny muted">{connected ? 'Connected' : 'Not connected'} · base saved locally</span>
        <button type="button" className="linkish" onClick={() => setBase(url)}>Keep URL</button>
      </div>
    </Panel>
  );
}

function TransferPanel({ bank, accounts, directory, beneficiaries, workerSession, workerBase, onNeedWorker, onDone, onError }) {
  const sources = accounts.filter(a => a.status === 'ACTIVE');
  const [type, setType] = useState('internal');
  const [from, setFrom] = useState(sources[0]?.accountId || '');
  const [destIfsc, setDestIfsc] = useState('');
  const [number, setNumber] = useState('');
  const [amount, setAmount] = useState('100');
  const [busy, setBusy] = useState(false);
  const routes = useMemo(() => directory.filter(d => d.bankId !== bank.id && d.status === 'ACTIVE'), [directory, bank.id]);
  const fromId = sources.some(s => s.accountId === from) ? from : (sources[0]?.accountId || '');
  const targetIfsc = type === 'internal' ? bank.ifsc : (destIfsc || routes[0]?.ifsc || '');

  async function submit(e) {
    e.preventDefault();
    if (!workerSession || !workerBase) return onNeedWorker();
    const amountMinor = parseAmountToPaise(amount);
    if (!fromId || !targetIfsc || !number.trim() || amountMinor == null) {
      onError('Choose source, destination and a valid amount.');
      return;
    }
    setBusy(true);
    try {
      const row = await workerTransfer(workerBase, workerSession.token, workerSession.uid, {
        fromAccountId: fromId,
        destinationIfsc: targetIfsc,
        destinationAccountNumber: number.trim(),
        amountMinor,
        currency: 'INR',
      });
      onDone(`${row.status} · ${row.transferId}`);
      setNumber('');
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="split">
      <Panel title="Send money" subtitle="Internal and interbank transfers via SharedBank Worker (idempotent ledger updates).">
        <form className="form-grid" onSubmit={submit}>
          <div className="chip-row">
            <button type="button" className={type === 'internal' ? 'active' : ''} onClick={() => setType('internal')}>Same bank</button>
            <button type="button" className={type === 'interbank' ? 'active' : ''} onClick={() => setType('interbank')}>Interbank</button>
          </div>
          <Field label="From account">
            <select value={fromId} onChange={e => setFrom(e.target.value)} required>
              {sources.map(a => <option key={a.accountId} value={a.accountId}>{a.accountNumber} · {money(a.availableMinor ?? a.postedBalanceMinor)}</option>)}
            </select>
          </Field>
          {type === 'interbank' && (
            <Field label="Destination bank">
              <select value={targetIfsc} onChange={e => setDestIfsc(e.target.value)} required>
                {routes.map(r => <option key={r.ifsc} value={r.ifsc}>{r.bankName} · {r.ifsc}</option>)}
              </select>
            </Field>
          )}
          <Field label="Destination account number">
            <input required value={number} onChange={e => setNumber(e.target.value)} list="beneficiaries" />
            <datalist id="beneficiaries">
              {beneficiaries.map(b => <option key={b.id} value={b.accountNumber}>{b.nickname}</option>)}
            </datalist>
          </Field>
          <Field label="Amount (INR)"><input required value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" /></Field>
          <button className="btn btn-primary" disabled={busy || !sources.length} type="submit">
            <ArrowLeftRight size={16} /> {busy ? 'Submitting…' : 'Submit transfer'}
          </button>
        </form>
      </Panel>
      <Panel title="Tips">
        <p className="muted" style={{ lineHeight: 1.5, fontSize: 14 }}>
          Transfers never let the browser write balances directly. The Worker posts CREDIT/DEBIT ledger entries and updates postedBalanceMinor atomically.
        </p>
      </Panel>
    </div>
  );
}

function CashPanel({ account, uid, onDone, onError }) {
  const [type, setType] = useState('DEPOSIT');
  const [amount, setAmount] = useState('500');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!account?.accountId) return onError('No account available.');
    const amountMinor = parseAmountToPaise(amount);
    if (amountMinor == null) return onError('Enter a valid amount.');
    setBusy(true);
    try {
      await submitCashRequest({
        customerUid: uid,
        accountId: account.accountId,
        type,
        amountMinor,
        note,
      });
      onDone(`${type} request submitted for admin processing.`);
      setNote('');
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Cash deposit / withdrawal" subtitle="Requests are reviewed by an admin before ledger posting.">
      <form className="form-grid" onSubmit={submit} style={{ maxWidth: 480 }}>
        <div className="chip-row">
          <button type="button" className={type === 'DEPOSIT' ? 'active' : ''} onClick={() => setType('DEPOSIT')}>Deposit</button>
          <button type="button" className={type === 'WITHDRAWAL' ? 'active' : ''} onClick={() => setType('WITHDRAWAL')}>Withdrawal</button>
        </div>
        <Field label="Amount (INR)"><input value={amount} onChange={e => setAmount(e.target.value)} required /></Field>
        <Field label="Note"><input value={note} onChange={e => setNote(e.target.value)} /></Field>
        <button className="btn btn-primary" disabled={busy} type="submit">{busy ? 'Sending…' : 'Submit request'}</button>
      </form>
    </Panel>
  );
}

function LoansPanel({ loans, account, uid, onDone, onError }) {
  const [amount, setAmount] = useState('50000');
  const [tenure, setTenure] = useState('12');
  const [purpose, setPurpose] = useState('');
  const [repay, setRepay] = useState({});
  const [busy, setBusy] = useState(false);

  async function apply(e) {
    e.preventDefault();
    if (!account?.accountId) return onError('Account required.');
    const amountMinor = parseAmountToPaise(amount);
    if (amountMinor == null) return onError('Invalid amount.');
    setBusy(true);
    try {
      await applyForLoan({
        customerUid: uid,
        accountId: account.accountId,
        amountMinor,
        tenureMonths: tenure,
        purpose,
      });
      onDone('Loan application submitted.');
      setPurpose('');
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="split">
      <Panel title="Apply for a loan">
        <form className="form-grid" onSubmit={apply}>
          <Field label="Amount (INR)"><input value={amount} onChange={e => setAmount(e.target.value)} required /></Field>
          <Field label="Tenure (months)"><input type="number" min={3} max={60} value={tenure} onChange={e => setTenure(e.target.value)} required /></Field>
          <Field label="Purpose"><textarea value={purpose} onChange={e => setPurpose(e.target.value)} required /></Field>
          <button className="btn btn-primary" disabled={busy} type="submit">Apply</button>
        </form>
      </Panel>
      <Panel title="Your loans">
        {loans.length ? loans.map(loan => (
          <div key={loan.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong>{money(loan.principalMinor)}</strong>
              <Badge status={loan.status} />
            </div>
            <p className="tiny muted">EMI {money(loan.emiMinor)} · Outstanding {money(loan.outstandingMinor)} · {loan.tenureMonths} mo</p>
            {loan.status === 'APPROVED' && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input style={{ flex: 1 }} placeholder="Repay amount" value={repay[loan.id] || ''} onChange={e => setRepay(r => ({ ...r, [loan.id]: e.target.value }))} />
                <button type="button" className="btn btn-soft" onClick={async () => {
                  try {
                    const amountMinor = parseAmountToPaise(repay[loan.id] || '');
                    if (amountMinor == null) throw new Error('Invalid repayment amount.');
                    await requestLoanRepayment({ loanId: loan.id, amountMinor, customerUid: uid });
                    onDone('Repayment request submitted.');
                  } catch (err) { onError(err.message); }
                }}>Request repay</button>
              </div>
            )}
          </div>
        )) : <div className="empty">No loans yet.</div>}
      </Panel>
    </div>
  );
}

function BeneficiariesPanel({ rows, uid, onChange, onError }) {
  const [form, setForm] = useState({ nickname: '', accountNumber: '', ifsc: bank.ifsc, bankName: bank.name });
  const [busy, setBusy] = useState(false);

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await addBeneficiary({ customerUid: uid, ...form });
      setForm({ nickname: '', accountNumber: '', ifsc: bank.ifsc, bankName: bank.name });
      await onChange();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="split">
      <Panel title="Add beneficiary">
        <form className="form-grid" onSubmit={add}>
          <Field label="Nickname"><input required value={form.nickname} onChange={e => setForm({ ...form, nickname: e.target.value })} /></Field>
          <Field label="Account number"><input required value={form.accountNumber} onChange={e => setForm({ ...form, accountNumber: e.target.value })} /></Field>
          <Field label="IFSC"><input required value={form.ifsc} onChange={e => setForm({ ...form, ifsc: e.target.value })} /></Field>
          <Field label="Bank name"><input value={form.bankName} onChange={e => setForm({ ...form, bankName: e.target.value })} /></Field>
          <button className="btn btn-primary" disabled={busy} type="submit">Save</button>
        </form>
      </Panel>
      <Panel title="Saved payees">
        {rows.length ? rows.map(b => (
          <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
            <div>
              <strong>{b.nickname}</strong>
              <p className="tiny muted">{b.accountNumber} · {b.ifsc}</p>
            </div>
            <button type="button" className="btn btn-danger" onClick={async () => {
              try { await removeBeneficiary(b.id, uid); await onChange(); }
              catch (err) { onError(err.message); }
            }}>Remove</button>
          </div>
        )) : <div className="empty">No beneficiaries yet.</div>}
      </Panel>
    </div>
  );
}
