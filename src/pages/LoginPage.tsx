import { useState } from 'react';
import type { FormEvent } from 'react';
import { signInWithMagicLink, signInWithPassword } from '../lib/auth';
import { supabaseConfigured } from '../lib/supabase';
import '../components/sales.css';

type Props = {
  forbiddenMessage?: string | null;
};

export function LoginPage({ forbiddenMessage }: Props) {
  const [email, setEmail] = useState('josh@tagevc.com');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'password' | 'magic'>('password');
  const [error, setError] = useState<string | null>(forbiddenMessage ?? null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (!supabaseConfigured) {
        throw new Error('Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local');
      }
      if (mode === 'password') {
        const { error: err } = await signInWithPassword(email, password);
        if (err) throw err;
      } else {
        const { error: err } = await signInWithMagicLink(email);
        if (err) throw err;
        setInfo('Check your email for the magic link.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="sales-mark lg">T</div>
          <h1>Tage VC</h1>
          <p>Deal sourcing for Launch, Partner, and Exit theses.</p>
        </div>
        {error ? <div className="banner error">{error}</div> : null}
        {info ? <div className="banner ok">{info}</div> : null}
        <form className="login-form" onSubmit={(e) => void onSubmit(e)}>
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          {mode === 'password' ? (
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
          ) : null}
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Working…' : mode === 'password' ? 'Sign in' : 'Send magic link'}
          </button>
        </form>
        <button
          type="button"
          className="btn link"
          onClick={() => setMode(mode === 'password' ? 'magic' : 'password')}
        >
          {mode === 'password' ? 'Use magic link instead' : 'Use password instead'}
        </button>
      </div>
    </div>
  );
}
