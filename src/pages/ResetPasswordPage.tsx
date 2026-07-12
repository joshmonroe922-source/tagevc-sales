import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signOut, updatePassword } from '../lib/auth';
import { supabase, supabaseConfigured } from '../lib/supabase';
import '../components/sales.css';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setInvalid(true);
      return;
    }

    let settled = false;
    const markReady = () => {
      if (settled) return;
      settled = true;
      setReady(true);
      setInvalid(false);
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && session) {
        markReady();
        return;
      }
      if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED')) {
        // Recovery links establish a session; allow update once present.
        markReady();
      }
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        markReady();
        return;
      }
      // Give the client a moment to parse hash tokens from the email link.
      window.setTimeout(() => {
        void supabase?.auth.getSession().then(({ data: again }) => {
          if (again.session) {
            markReady();
          } else if (!settled) {
            settled = true;
            setInvalid(true);
          }
        });
      }, 800);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      if (!supabaseConfigured) {
        throw new Error('Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local');
      }
      const { error: err } = await updatePassword(password);
      if (err) throw err;
      setInfo('Password updated. You can sign in with your new password.');
      await signOut();
      window.setTimeout(() => navigate('/sales', { replace: true }), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="sales-mark lg">T</div>
          <h1>Reset password</h1>
          <p>Choose a new password for your Tage VC sales account.</p>
        </div>
        {error ? <div className="banner error">{error}</div> : null}
        {info ? <div className="banner ok">{info}</div> : null}
        {!supabaseConfigured ? (
          <div className="banner error">Supabase env vars missing — see README.</div>
        ) : invalid ? (
          <>
            <div className="banner warn">
              This reset link is invalid or expired. Request a new one from the login page.
            </div>
            <Link className="btn link" to="/sales">
              Back to sign in
            </Link>
          </>
        ) : !ready ? (
          <p className="muted">Verifying reset link…</p>
        ) : (
          <form className="login-form" onSubmit={(e) => void onSubmit(e)}>
            <label>
              New password
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </label>
            <label>
              Confirm password
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
              />
            </label>
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Update password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
