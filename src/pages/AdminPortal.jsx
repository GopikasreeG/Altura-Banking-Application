import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ClipboardList, CreditCard, Landmark, LayoutDashboard, LogOut,
  RefreshCw, Search, Shield, Users, Wallet,
} from 'lucide-react';
import bank from '../bank-config';
import { Alert, Badge, BrandMark, Field, Panel, formatTime, money } from '../components/ui';
import {
  adminPostLedger, listAllAccounts, listCashRequests, listLedgerForAccount,
  processCashRequest, setAccountStatus,
} from '../services/accounts';
import { listApplications, setApplicationStatus } from '../services/applications';
import { signOutUser } from '../services/auth';
import { decideLoan, listAllLoans, recordLoanRepayment } from '../services/loans';
import { metaCollection, tsToIso } from '../firebase';

const NAV = [
  ['dashboard', 'Dashboard', LayoutDashboard],
  ['applications', 'Applications', ClipboardList],
  ['customers', 'Customers', Users],
  ['accounts', 'Accounts', Wallet],
  ['cash', 'Cash requests', Landmark],
  ['loans', 'Loans', CreditCard],
  ['audit', 'Audit log', Shield],
];

export default function AdminPortal({ session, onSignOut }) {
  const { user, admin } = session;
  const [tab, setTab] = useState('dashboard');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [apps, setApps] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loans, setLoans] = useState([]);
  const [cash, setCash] = useState([]);
  const [audit, setAudit] = useState([]);
  const [filter, setFilter] = useState('PENDING');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [opening, setOpening] = useState('1000');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [a, acc, l, c, logs] = await Promise.all([
      listApplications('ALL'),
      listAllAccounts(),
      listAllLoans(),
      listCashRequests('ALL'),
      metaCollection('auditLogs').orderBy('createdAt', 'desc').limit(100).get()
        .then(snap => snap.docs.map(d => {
          const x = d.data();
          return { id: d.id, ...x, createdAt: tsToIso(x.createdAt) };
        }))
        .catch(() => []),
    ]);
    setApps(a);
    setAccounts(acc);
    setLoans(l);
    setCash(c);
    setAudit(logs);
  }, []);

  useEffect(() => {
    refresh().catch(err => setError(err.message));
  }, [refresh]);

  const filteredApps = useMemo(() => {
    const q = search.trim().toLowerCase();
    return apps.filter(a => {
      if (filter !== 'ALL' && a.status !== filter) return false;
      if (!q) return true;
      return [a.fullName, a.email, a.phone, a.accountNumber, a.id].join(' ').toLowerCase().includes(q);
    });
  }, [apps, filter, search]);

  const customers = useMemo(() => apps.filter(a => a.status === 'APPROVED'), [apps]);

  async function handleSignOut() {
    await signOutUser();
    onSignOut();
  }

  async function review(status) {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      const openingBalanceMinor = status === 'APPROVED'
        ? Math.round(parseFloat(opening || '0') * 100) || 0
        : 0;
      await setApplicationStatus({
        applicationId: selected.id,
        status,
        note: selected._note || '',
        adminUid: user.uid,
        adminEmail: user.email,
        openingBalanceMinor,
      });
      setNote(`Application ${status}.`);
      setSelected(null);
      await refresh();
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
          <button type="button" className="btn btn-ghost" style={{ color: '#dff2ec', borderColor: '#ffffff22' }} onClick={() => refresh()}>
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
            <h1>{bank.name} · Admin</h1>
            <p className="tiny muted">{user.email}{admin?.ephemeral ? ' · allowlist session' : ''}</p>
          </div>
          <Badge status="ADMIN" />
        </header>
        <main className="content">
          {error && <Alert kind="error" onClose={() => setError('')}>{error}</Alert>}
          {note && <Alert kind="ok" onClose={() => setNote('')}>{note}</Alert>}

          {tab === 'dashboard' && (
            <>
              <div className="stat-grid">
                <div className="stat-card"><span>Pending KYC</span><strong>{apps.filter(a => a.status === 'PENDING').length}</strong></div>
                <div className="stat-card"><span>Customers</span><strong>{customers.length}</strong></div>
                <div className="stat-card"><span>Accounts</span><strong>{accounts.length}</strong></div>
                <div className="stat-card"><span>Open loans</span><strong>{loans.filter(l => l.status === 'APPROVED' || l.status === 'PENDING').length}</strong></div>
              </div>
              <Panel title="Operator checklist" subtitle="Shared ledger compatibility">
                <ul className="muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7, fontSize: 14 }}>
                  <li>Approve KYC to create shared-compatible <code>accounts</code> + optional <code>DEMO_SEED</code> ledger CREDIT.</li>
                  <li>Seed <code>bankMeta/P665/settings/config</code> with <code>{'{ adminEmails: ["your@email"] }'}</code> in Firestore Console.</li>
                  <li>Customer transfers continue through the SharedBank Worker — balances are never edited from the customer client.</li>
                </ul>
              </Panel>
            </>
          )}

          {tab === 'applications' && (
            <div className="split">
              <Panel title="Customer applications" subtitle="Search, filter, and review KYC"
                action={<input className="search" placeholder="Search name, email…" value={search} onChange={e => setSearch(e.target.value)} />}
              >
                <div className="chip-row" style={{ marginBottom: 12 }}>
                  {['PENDING', 'ON_HOLD', 'APPROVED', 'REJECTED', 'ALL'].map(s => (
                    <button key={s} type="button" className={filter === s ? 'active' : ''} onClick={() => setFilter(s)}>{s.replace('_', ' ')}</button>
                  ))}
                </div>
                <div className="table-wrap"><table className="data">
                  <thead><tr><th>Applicant</th><th>Status</th><th>Submitted</th></tr></thead>
                  <tbody>
                    {filteredApps.map(app => (
                      <tr key={app.id} style={{ cursor: 'pointer' }} onClick={() => setSelected({ ...app, _note: '' })}>
                        <td><strong>{app.fullName}</strong><small>{app.email}</small></td>
                        <td><Badge status={app.status} /></td>
                        <td>{formatTime(app.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
                {!filteredApps.length && <div className="empty"><Search size={20} /> No matching applications</div>}
              </Panel>

              <Panel title="Review" subtitle={selected ? selected.fullName : 'Select an application'}>
                {!selected ? <div className="empty">Choose a row to inspect KYC.</div> : (
                  <div className="form-grid">
                    <div><span className="tiny muted">Phone</span><strong>{selected.phone}</strong></div>
                    <div><span className="tiny muted">Address</span><strong>{[selected.address?.line, selected.address?.city, selected.address?.state, selected.address?.pincode].filter(Boolean).join(', ')}</strong></div>
                    <div className="kyc-grid" style={{ gridTemplateColumns: '1fr' }}>
                      {['idProof', 'addressProof', 'photo'].map(key => {
                        const doc = selected.kyc?.[key];
                        return (
                          <div className="kyc-card" key={key}>
                            <strong>{key}</strong>
                            {doc?.contentType?.startsWith('image/') && doc.url
                              ? <img src={doc.url} alt={key} />
                              : <span className="tiny muted">{doc?.fileName || 'File'}</span>}
                            {doc?.url && <a href={doc.url} target="_blank" rel="noreferrer">Open document</a>}
                          </div>
                        );
                      })}
                    </div>
                    <Field label="Review note">
                      <textarea value={selected._note || ''} onChange={e => setSelected({ ...selected, _note: e.target.value })} />
                    </Field>
                    {selected.status !== 'APPROVED' && (
                      <Field label="Opening balance (INR) for approval">
                        <input value={opening} onChange={e => setOpening(e.target.value)} />
                      </Field>
                    )}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => review('APPROVED')}>Approve</button>
                      <button type="button" className="btn btn-soft" disabled={busy} onClick={() => review('ON_HOLD')}>Hold</button>
                      <button type="button" className="btn btn-danger" disabled={busy} onClick={() => review('REJECTED')}>Reject</button>
                    </div>
                  </div>
                )}
              </Panel>
            </div>
          )}

          {tab === 'customers' && (
            <Panel title="Approved customers">
              <div className="table-wrap"><table className="data">
                <thead><tr><th>Customer</th><th>Account</th><th>Phone</th><th>Status</th></tr></thead>
                <tbody>
                  {customers.map(c => (
                    <tr key={c.id}>
                      <td><strong>{c.fullName}</strong><small>{c.email}</small></td>
                      <td><strong>{c.accountNumber || '—'}</strong><small>{c.accountId}</small></td>
                      <td>{c.phone}</td>
                      <td><Badge status={c.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </Panel>
          )}

          {tab === 'accounts' && (
            <AccountsAdmin
              accounts={accounts}
              admin={user}
              onError={setError}
              onNote={setNote}
              onRefresh={refresh}
            />
          )}

          {tab === 'cash' && (
            <Panel title="Deposit / withdrawal requests">
              <div className="table-wrap"><table className="data">
                <thead><tr><th>Request</th><th>Type</th><th>Amount</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {cash.map(r => (
                    <tr key={r.id}>
                      <td><strong>{r.accountId}</strong><small>{formatTime(r.createdAt)}</small></td>
                      <td>{r.type}</td>
                      <td>{money(r.amountMinor)}</td>
                      <td><Badge status={r.status} /></td>
                      <td>
                        {r.status === 'PENDING' && (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button type="button" className="btn btn-primary" onClick={async () => {
                              try {
                                await processCashRequest({ requestId: r.id, approve: true, adminUid: user.uid, adminEmail: user.email });
                                setNote('Cash request approved & ledger posted.');
                                await refresh();
                              } catch (err) { setError(err.message); }
                            }}>Approve</button>
                            <button type="button" className="btn btn-danger" onClick={async () => {
                              try {
                                await processCashRequest({ requestId: r.id, approve: false, adminUid: user.uid, adminEmail: user.email, note: 'Rejected by admin' });
                                setNote('Cash request rejected.');
                                await refresh();
                              } catch (err) { setError(err.message); }
                            }}>Reject</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
              {!cash.length && <div className="empty">No cash requests.</div>}
            </Panel>
          )}

          {tab === 'loans' && (
            <LoansAdmin loans={loans} user={user} onError={setError} onNote={setNote} onRefresh={refresh} />
          )}

          {tab === 'audit' && (
            <Panel title="Audit log" subtitle="Application and banking activity">
              <div className="table-wrap"><table className="data">
                <thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Entity</th></tr></thead>
                <tbody>
                  {audit.map(row => (
                    <tr key={row.id}>
                      <td>{formatTime(row.createdAt)}</td>
                      <td><strong>{row.action}</strong></td>
                      <td><small>{row.actorEmail || row.actorUid}</small></td>
                      <td><small>{row.entityType} · {row.entityId}</small></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
              {!audit.length && <div className="empty">No audit events yet.</div>}
            </Panel>
          )}
        </main>
      </div>
    </div>
  );
}

function AccountsAdmin({ accounts, admin, onError, onNote, onRefresh }) {
  const [selected, setSelected] = useState('');
  const [ledger, setLedger] = useState([]);
  const [amount, setAmount] = useState('100');
  const [direction, setDirection] = useState('CREDIT');

  useEffect(() => {
    if (!selected) return;
    listLedgerForAccount(selected).then(setLedger).catch(err => onError(err.message));
  }, [selected, onError]);

  const account = accounts.find(a => a.accountId === selected);

  return (
    <div className="split">
      <Panel title="Accounts">
        <div className="table-wrap"><table className="data">
          <thead><tr><th>Account</th><th>Balance</th><th>Status</th></tr></thead>
          <tbody>
            {accounts.map(a => (
              <tr key={a.accountId} style={{ cursor: 'pointer' }} onClick={() => setSelected(a.accountId)}>
                <td><strong>{a.accountNumber}</strong><small>{a.accountId}</small></td>
                <td>{money(a.postedBalanceMinor)}</td>
                <td><Badge status={a.status} /></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Panel>
      <Panel title="Manage account" subtitle={account?.accountNumber || 'Select an account'}>
        {!account ? <div className="empty">Select an account</div> : (
          <div className="form-grid">
            <div className="chip-row">
              {['ACTIVE', 'FROZEN', 'CLOSED'].map(s => (
                <button key={s} type="button" className={account.status === s ? 'active' : ''} onClick={async () => {
                  try {
                    await setAccountStatus({ accountId: account.accountId, status: s, adminUid: admin.uid, adminEmail: admin.email });
                    onNote(`Account marked ${s}.`);
                    await onRefresh();
                  } catch (err) { onError(err.message); }
                }}>{s}</button>
              ))}
            </div>
            <Field label="Manual ledger amount (INR)"><input value={amount} onChange={e => setAmount(e.target.value)} /></Field>
            <div className="chip-row">
              <button type="button" className={direction === 'CREDIT' ? 'active' : ''} onClick={() => setDirection('CREDIT')}>CREDIT</button>
              <button type="button" className={direction === 'DEBIT' ? 'active' : ''} onClick={() => setDirection('DEBIT')}>DEBIT</button>
            </div>
            <button type="button" className="btn btn-primary" onClick={async () => {
              try {
                const amountMinor = Math.round(parseFloat(amount) * 100);
                await adminPostLedger({
                  accountId: account.accountId,
                  amountMinor,
                  direction,
                  adminUid: admin.uid,
                  adminEmail: admin.email,
                  note: 'Admin adjustment',
                });
                onNote('Ledger entry posted.');
                setLedger(await listLedgerForAccount(account.accountId));
                await onRefresh();
              } catch (err) { onError(err.message); }
            }}>Post ledger entry</button>
            <div className="table-wrap"><table className="data">
              <thead><tr><th>Entry</th><th>Amt</th></tr></thead>
              <tbody>{ledger.slice(0, 12).map(r => (
                <tr key={r.entryId}><td><strong>{r.direction}</strong><small>{r.entryType}</small></td><td>{money(r.amountMinor)}</td></tr>
              ))}</tbody>
            </table></div>
          </div>
        )}
      </Panel>
    </div>
  );
}

function LoansAdmin({ loans, user, onError, onNote, onRefresh }) {
  const [repay, setRepay] = useState({});
  return (
    <Panel title="Loan applications">
      <div className="table-wrap"><table className="data">
        <thead><tr><th>Loan</th><th>Principal</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {loans.map(loan => (
            <tr key={loan.id}>
              <td><strong>{loan.loanId || loan.id}</strong><small>{loan.purpose}</small></td>
              <td>{money(loan.principalMinor)}<small>Out {money(loan.outstandingMinor)}</small></td>
              <td><Badge status={loan.status} /></td>
              <td>
                {loan.status === 'PENDING' && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" className="btn btn-primary" onClick={async () => {
                      try {
                        await decideLoan({ loanId: loan.id, status: 'APPROVED', adminUid: user.uid, adminEmail: user.email });
                        onNote('Loan approved & disbursed.');
                        await onRefresh();
                      } catch (err) { onError(err.message); }
                    }}>Approve</button>
                    <button type="button" className="btn btn-danger" onClick={async () => {
                      try {
                        await decideLoan({ loanId: loan.id, status: 'REJECTED', adminUid: user.uid, adminEmail: user.email });
                        onNote('Loan rejected.');
                        await onRefresh();
                      } catch (err) { onError(err.message); }
                    }}>Reject</button>
                  </div>
                )}
                {loan.status === 'APPROVED' && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input style={{ width: 100 }} placeholder="₹ repay" value={repay[loan.id] || ''} onChange={e => setRepay(r => ({ ...r, [loan.id]: e.target.value }))} />
                    <button type="button" className="btn btn-soft" onClick={async () => {
                      try {
                        const amountMinor = Math.round(parseFloat(repay[loan.id] || '0') * 100);
                        await recordLoanRepayment({ loanId: loan.id, amountMinor, adminUid: user.uid, adminEmail: user.email });
                        onNote('Repayment recorded.');
                        await onRefresh();
                      } catch (err) { onError(err.message); }
                    }}>Record</button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {!loans.length && <div className="empty">No loans.</div>}
    </Panel>
  );
}
