import { FormEvent, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Page, PageHeader } from '../components/Page';
import { Lock } from '../components/Icons';
import { authMessage, useAuth } from '../lib/auth';

type Mode = 'signin' | 'signup';

export default function Login() {
  const { status, signIn, signUp, signInWithGoogle, resetPassword } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/scan';

  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (status === 'in') return <Navigate to={from} replace />;

  const run = async (work: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await work();
    } catch (e) {
      setError(authMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return setError('Enter your email address.');
    if (password.length < 6) return setError('Use a password with at least 6 characters.');
    if (mode === 'signup' && !name.trim()) return setError('Enter your name.');
    run(() => (mode === 'signin' ? signIn(email, password) : signUp(name, email, password)));
  };

  const forgot = () => {
    if (!email.trim()) return setError('Enter your email above, then tap Forgot password.');
    run(async () => {
      await resetPassword(email);
      setNotice(`If an account exists for ${email.trim()}, a reset link is on its way.`);
    });
  };

  const field = 'mt-1 w-full h-12 px-4 rounded-xl border border-ink/15 bg-white focus:outline-none focus:border-leaf';

  return (
    <Page>
      <PageHeader
        kicker="Your kitchen account"
        icon={<Lock />}
        title={mode === 'signin' ? 'Welcome back.' : 'Create your account.'}
        lead="Sign in to keep your pantry, shopping list, family details and health log under your own account on this device."
      />

      <div className="max-w-md">
        {status === 'off' ? (
          <div className="card p-6">
            <h2 className="font-display text-xl">Login is not set up yet</h2>
            <p className="mt-2 text-[0.92rem] text-muted">
              Add your Firebase keys to <code>.env.local</code> (see <code>.env.example</code>) and restart the site. Until then AHAAR runs without accounts and keeps everything in this browser.
            </p>
            <Link to="/scan" className="btn-primary mt-5 inline-flex">Continue without an account</Link>
          </div>
        ) : (
          <div className="card p-5 md:p-6">
            <div role="tablist" aria-label="Sign in or create an account" className="relative grid grid-cols-2 p-1 rounded-full bg-surface">
              {(['signin', 'signup'] as Mode[]).map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => { setMode(m); setError(null); setNotice(null); }}
                  className={`relative z-10 h-11 rounded-full text-[0.92rem] font-medium transition-colors ${mode === m ? 'text-bg' : 'text-muted hover:text-ink'}`}
                >
                  {mode === m && (
                    <motion.span layoutId="login-tab" className="absolute inset-0 -z-10 rounded-full bg-ink" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />
                  )}
                  {m === 'signin' ? 'Sign in' : 'Create account'}
                </button>
              ))}
            </div>

            <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
              {mode === 'signup' && (
                <label className="block text-[0.85rem] font-medium text-muted">
                  Your name
                  <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={field} />
                </label>
              )}
              <label className="block text-[0.85rem] font-medium text-muted">
                Email
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" className={field} />
              </label>
              <label className="block text-[0.85rem] font-medium text-muted">
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  className={field}
                />
                {mode === 'signup' && <span className="mt-1 block text-[0.78rem] font-normal">At least 6 characters.</span>}
              </label>

              {error && <p role="alert" className="text-[0.88rem] text-chilli">{error}</p>}
              {notice && <p role="status" className="text-[0.88rem] text-leaf">{notice}</p>}

              <button type="submit" className="btn-primary w-full" disabled={busy || status === 'loading'}>
                {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            </form>

            {mode === 'signin' && (
              <button className="mt-3 text-[0.88rem] text-leaf underline underline-offset-2" onClick={forgot} disabled={busy}>
                Forgot password?
              </button>
            )}

            <div className="my-5 flex items-center gap-3 text-[0.8rem] text-muted">
              <span className="h-px flex-1 bg-ink/10" /> or <span className="h-px flex-1 bg-ink/10" />
            </div>

            <button className="btn-ghost w-full" onClick={() => run(signInWithGoogle)} disabled={busy}>
              Continue with Google
            </button>
          </div>
        )}
      </div>
    </Page>
  );
}
