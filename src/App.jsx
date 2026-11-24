import { useEffect, useState } from 'react';
import { isFirebaseConfigured } from './firebase-config';
import { ensureFirebase } from './firebase';
import { onAuth, ensureAdminAccess, resolveCustomerAccess, signOutUser } from './services/auth';
import AuthPages from './pages/AuthPages';
import CustomerPortal from './pages/CustomerPortal';
import AdminPortal from './pages/AdminPortal';
import './app.css';

export default function App() {
  const [session, setSession] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setBooting(false);
      return undefined;
    }
    try {
      ensureFirebase();
    } catch {
      setBooting(false);
      return undefined;
    }
    const unsub = onAuth(async (user) => {
      if (!user) {
        setSession(null);
        setBooting(false);
        return;
      }
      // Session restored on refresh — keep portal choice in sessionStorage
      const portal = sessionStorage.getItem('altura-portal') || 'customer';
      try {
        if (portal === 'admin') {
          const admin = await ensureAdminAccess(user);
          if (!admin) {
            setSession(null);
          } else {
            setSession({ user, role: 'admin', admin });
          }
        } else {
          const access = await resolveCustomerAccess(user);
          setSession({ user, role: 'customer', access });
        }
      } catch {
        setSession(null);
      } finally {
        setBooting(false);
      }
    });
    return () => unsub();
  }, []);

  function handleAuthenticated(next) {
    sessionStorage.setItem('altura-portal', next.role);
    setSession(next);
  }

  async function handleSignOut() {
    sessionStorage.removeItem('altura-portal');
    try { await signOutUser(); } catch { /* ignore */ }
    setSession(null);
  }

  if (booting) {
    return (
      <div className="auth-panel app-shell" style={{ minHeight: '100vh' }}>
        <div className="auth-card"><h2>Loading Altura…</h2><p className="sub">Preparing your secure session.</p></div>
      </div>
    );
  }

  if (!session) {
    return <AuthPages onAuthenticated={handleAuthenticated} />;
  }

  if (session.role === 'admin') {
    return <AdminPortal session={session} onSignOut={handleSignOut} />;
  }

  return <CustomerPortal session={session} onSignOut={handleSignOut} />;
}
