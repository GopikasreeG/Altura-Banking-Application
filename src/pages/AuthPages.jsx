import { useState } from 'react';
import bank from '../bank-config';
import { Alert, BrandMark, Field } from '../components/ui';
import { isFirebaseConfigured } from '../firebase-config';
import { ensureFirebase } from '../firebase';
import { registerCustomer } from '../services/applications';
import { ensureAdminAccess, logLogin, resolveCustomerAccess, signInEmailPassword } from '../services/auth';

function LoginForm({ portal, onSuccess, onNeedRegister }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setInfo('');
    try {
      ensureFirebase();
      const user = await signInEmailPassword(email, password);
      sessionStorage.setItem('altura-portal', portal === 'admin' ? 'admin' : 'customer');
      if (portal === 'admin') {
        const admin = await ensureAdminAccess(user);
        if (!admin) {
          await user.getIdToken(true);
          throw new Error('This account is not authorised for the admin portal. Seed bankMeta/P665/settings/config.adminEmails in Firestore.');
        }
        await logLogin(user, 'admin');
        onSuccess({ user, role: 'admin', admin });
        return;
      }
      const access = await resolveCustomerAccess(user);
      await logLogin(user, 'customer');
      if (access.state === 'NO_APPLICATION') {
        setInfo('No KYC application found for this user. Please register.');
        return;
      }
      onSuccess({ user, role: 'customer', access });
    } catch (err) {
      setError(err.message || 'Sign-in failed.');
    } finally {
      setBusy(false);
      setPassword('');
    }
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      {error && <Alert kind="error">{error}</Alert>}
      {info && <Alert kind="info">{info}</Alert>}
      <Field label="Email">
        <input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} />
      </Field>
      <Field label="Password">
        <input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
      </Field>
      <button className="btn btn-primary btn-block" disabled={busy} type="submit">
        {busy ? 'Signing in…' : portal === 'admin' ? 'Admin sign in' : 'Customer sign in'}
      </button>
      {portal === 'customer' && (
        <p className="tiny muted" style={{ textAlign: 'center' }}>
          New to {bank.name}?{' '}
          <button type="button" className="linkish" onClick={onNeedRegister}>Create an account</button>
        </p>
      )}
    </form>
  );
}

function RegisterForm({ onDone, onBack }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [form, setForm] = useState({
    fullName: '', email: '', password: '', phone: '', dateOfBirth: '',
    addressLine: '', city: '', state: '', pincode: '',
  });
  const [files, setFiles] = useState({ idProofFile: null, addressProofFile: null, photoFile: null });

  function set(key, value) { setForm(prev => ({ ...prev, [key]: value })); }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setOk('');
    try {
      ensureFirebase();
      await registerCustomer({ ...form, ...files });
      setOk('Application submitted. Status is PENDING until an admin approves your KYC.');
      setTimeout(onDone, 1200);
    } catch (err) {
      setError(err.message || 'Registration failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      {error && <Alert kind="error">{error}</Alert>}
      {ok && <Alert kind="ok">{ok}</Alert>}
      <div className="form-grid two">
        <Field label="Full legal name"><input required value={form.fullName} onChange={e => set('fullName', e.target.value)} /></Field>
        <Field label="Mobile"><input required value={form.phone} onChange={e => set('phone', e.target.value)} /></Field>
        <Field label="Email"><input type="email" required value={form.email} onChange={e => set('email', e.target.value)} /></Field>
        <Field label="Password (min 8)"><input type="password" required minLength={8} value={form.password} onChange={e => set('password', e.target.value)} /></Field>
        <Field label="Date of birth"><input type="date" value={form.dateOfBirth} onChange={e => set('dateOfBirth', e.target.value)} /></Field>
        <Field label="PIN code"><input required value={form.pincode} onChange={e => set('pincode', e.target.value)} /></Field>
      </div>
      <Field label="Address"><textarea required value={form.addressLine} onChange={e => set('addressLine', e.target.value)} /></Field>
      <div className="form-grid two">
        <Field label="City"><input required value={form.city} onChange={e => set('city', e.target.value)} /></Field>
        <Field label="State"><input required value={form.state} onChange={e => set('state', e.target.value)} /></Field>
      </div>
      <div className="form-grid two">
        <Field label="ID proof (Aadhaar / PAN / Passport)">
          <input type="file" accept="image/*,application/pdf" required onChange={e => setFiles(f => ({ ...f, idProofFile: e.target.files?.[0] || null }))} />
        </Field>
        <Field label="Address proof">
          <input type="file" accept="image/*,application/pdf" required onChange={e => setFiles(f => ({ ...f, addressProofFile: e.target.files?.[0] || null }))} />
        </Field>
        <Field label="Photograph">
          <input type="file" accept="image/*" required onChange={e => setFiles(f => ({ ...f, photoFile: e.target.files?.[0] || null }))} />
        </Field>
      </div>
      <p className="tiny muted">Documents are stored in Firebase Storage. Your application starts as PENDING and banking access stays locked until approval.</p>
      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" className="btn btn-ghost" onClick={onBack}>Back</button>
        <button type="submit" className="btn btn-primary" disabled={busy} style={{ flex: 1 }}>
          {busy ? 'Submitting…' : 'Submit KYC application'}
        </button>
      </div>
    </form>
  );
}

export default function AuthPages({ onAuthenticated }) {
  const configured = isFirebaseConfigured();
  const [portal, setPortal] = useState('customer');
  const [mode, setMode] = useState('login');

  return (
    <div className="auth-screen app-shell">
      <aside className="auth-visual">
        <BrandMark light />
        <div className="auth-copy">
          <h1>Banking that feels considered.</h1>
          <p>Open an account with verified KYC, move money on the shared ledger network, and manage loans from one calm workspace.</p>
        </div>
        <div className="auth-meta">
          <span>IFSC {bank.ifsc}</span>
          <span>Bank {bank.id}</span>
          <span>INR ledger</span>
        </div>
      </aside>
      <div className="auth-panel">
        {(
          <div className={`auth-card ${mode === 'register' ? 'wide' : ''}`}>
            {mode === 'login' ? (
              <>
                <h2>Welcome back</h2>
                <p className="sub">Sign in to the customer or admin portal.</p>
                {!configured && (
                  <Alert kind="error">
                    Firebase settings were not found in this build. Make sure <code>.env</code> is in the project root (next to package.json) with all <code>VITE_FIREBASE_*</code> values, then restart <code>npm run dev</code>.
                  </Alert>
                )}
                <div className="portal-tabs">
                  <button type="button" className={portal === 'customer' ? 'active' : ''} onClick={() => setPortal('customer')}>Customer</button>
                  <button type="button" className={portal === 'admin' ? 'active' : ''} onClick={() => setPortal('admin')}>Admin</button>
                </div>
                <LoginForm
                  portal={portal}
                  onNeedRegister={() => setMode('register')}
                  onSuccess={onAuthenticated}
                />
              </>
            ) : (
              <>
                <h2>Open an account</h2>
                <p className="sub">Tell us who you are and upload KYC documents. Approval is required before banking features unlock.</p>
                <RegisterForm onBack={() => setMode('login')} onDone={() => setMode('login')} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
