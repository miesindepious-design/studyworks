/**
 * AuthPage — handles Sign In, Sign Up, and Forgot Password.
 * Shown when there is no active session.
 */

import { useState, useEffect } from 'react';
import { signIn, signUp, forgotPassword, signInWithGoogle } from '../api/auth';
import type { AuthUser } from '../api/auth';

type AuthMode = 'signin' | 'signup' | 'forgot';

interface AuthPageProps {
  onAuth: (user: AuthUser) => void;
}

export default function AuthPage({ onAuth }: AuthPageProps) {
  const [mode,  setMode]  = useState<AuthMode>('signin');
  const [name,  setName]  = useState('');
  const [email, setEmail] = useState('');
  const [pass,  setPass]  = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showPass, setShowPass] = useState(false);

  const reset = () => { setError(null); setSuccess(null); };

  // If Google OAuth failed, the server redirects back with ?authError=google.
  // Surface a friendly message and clean the URL so refreshes don't re-show it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('authError') === 'google') {
      setError('Google sign-in was cancelled or failed. Please try again.');
      params.delete('authError');
      const qs = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }
  }, []);

  const handleGoogle = async () => {
    reset();
    setGoogleLoading(true);
    try {
      await signInWithGoogle(); // navigates away on success
    } catch (err: any) {
      // Only reached if the server rejected the request (e.g. Google OAuth
      // not configured). The redirect path never returns here.
      setError(err.message || 'Google sign-in is not available right now.');
      setGoogleLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    reset();
    setLoading(true);

    try {
      if (mode === 'signup') {
        if (pass !== confirmPass) { setError('Passwords do not match.'); setLoading(false); return; }
        if (pass.length < 8) { setError('Password must be at least 8 characters.'); setLoading(false); return; }
        const session = await signUp(email, pass, name);
        onAuth(session.user);

      } else if (mode === 'signin') {
        const session = await signIn(email, pass);
        onAuth(session.user);

      } else {
        await forgotPassword(email);
        setSuccess('Check your email for a password reset link.');
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1.5rem',
    }}>
      <div style={{ width: '100%', maxWidth: '420px' }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>📚</div>
          <h1 style={{
            fontSize: '1.75rem', fontWeight: 900,
            background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}>StudyWorks</h1>
          <p className="text-muted text-sm" style={{ marginTop: '0.375rem' }}>
            {mode === 'signin'  && 'Sign in to your account'}
            {mode === 'signup'  && 'Create your free account'}
            {mode === 'forgot'  && 'Reset your password'}
          </p>
        </div>

        {/* Card */}
        <div className="card elevated" style={{ padding: '2rem' }}>

          {/* Mode tabs */}
          {mode !== 'forgot' && (
            <div className="tabs" style={{ marginBottom: '1.75rem' }}>
              <button className={`tab-btn${mode === 'signin' ? ' active' : ''}`} onClick={() => { setMode('signin'); reset(); }}>Sign In</button>
              <button className={`tab-btn${mode === 'signup' ? ' active' : ''}`} onClick={() => { setMode('signup'); reset(); }}>Sign Up</button>
            </div>
          )}

          {/* Error / Success */}
          {error && (
            <div style={{ background: '#fff1f2', border: '1px solid var(--danger)', borderRadius: 'var(--radius)', padding: '0.75rem 1rem', marginBottom: '1.25rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
              <span>❌</span>
              <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>
            </div>
          )}
          {success && (
            <div style={{ background: '#f0fdf4', border: '1px solid var(--success)', borderRadius: 'var(--radius)', padding: '0.75rem 1rem', marginBottom: '1.25rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
              <span>✅</span>
              <p className="text-sm" style={{ color: 'var(--success)' }}>{success}</p>
            </div>
          )}

          {/* Google sign-in — hidden on forgot-password screen */}
          {mode !== 'forgot' && (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleGoogle}
                disabled={googleLoading || loading}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.625rem', marginBottom: '1.25rem' }}
              >
                {/* Google "G" logo */}
                <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                </svg>
                {googleLoading ? 'Redirecting…' : 'Continue with Google'}
              </button>

              {/* Divider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                <span className="text-xs text-muted">or</span>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Name — signup only */}
            {mode === 'signup' && (
              <div className="form-group">
                <label className="form-label">Full name</label>
                <input
                  type="text" className="input" placeholder="Your name"
                  value={name} onChange={e => setName(e.target.value)} required
                  autoComplete="name"
                />
              </div>
            )}

            {/* Email */}
            <div className="form-group">
              <label className="form-label">Email address</label>
              <input
                type="email" className="input" placeholder="you@example.com"
                value={email} onChange={e => setEmail(e.target.value)} required
                autoComplete={mode === 'signup' ? 'email' : 'username'}
              />
            </div>

            {/* Password */}
            {mode !== 'forgot' && (
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="form-label">Password</label>
                  {mode === 'signin' && (
                    <button type="button" className="btn btn-ghost btn-xs" onClick={() => { setMode('forgot'); reset(); }} style={{ color: 'var(--accent)', padding: 0 }}>
                      Forgot password?
                    </button>
                  )}
                </div>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPass ? 'text' : 'password'} className="input"
                    placeholder={mode === 'signup' ? 'Minimum 8 characters' : 'Your password'}
                    value={pass} onChange={e => setPass(e.target.value)} required
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    minLength={mode === 'signup' ? 8 : undefined}
                    style={{ paddingRight: '2.75rem' }}
                  />
                  <button
                    type="button" onClick={() => setShowPass(v => !v)}
                    aria-label={showPass ? 'Hide password' : 'Show password'}
                    className="pw-toggle"
                  >{showPass ? '🙈' : '👁️'}</button>
                </div>
              </div>
            )}

            {/* Confirm password — signup only */}
            {mode === 'signup' && (
              <div className="form-group">
                <label className="form-label">Confirm password</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPass ? 'text' : 'password'} className="input" placeholder="Repeat your password"
                    value={confirmPass} onChange={e => setConfirmPass(e.target.value)} required
                    autoComplete="new-password"
                    style={{ paddingRight: '2.75rem' }}
                  />
                  <button
                    type="button" onClick={() => setShowPass(v => !v)}
                    aria-label={showPass ? 'Hide password' : 'Show password'}
                    className="pw-toggle"
                  >{showPass ? '🙈' : '👁️'}</button>
                </div>
              </div>
            )}

            <button type="submit" className="btn btn-primary btn-lg" disabled={loading} style={{ width: '100%', marginTop: '0.25rem' }}>
              {loading
                ? 'Please wait…'
                : mode === 'signin' ? 'Sign In'
                : mode === 'signup' ? 'Create Account'
                : 'Send Reset Link'}
            </button>
          </form>

          {/* Forgot → back to sign in */}
          {mode === 'forgot' && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setMode('signin'); reset(); }} style={{ width: '100%', marginTop: '1rem', color: 'var(--text-2)' }}>
              ← Back to Sign In
            </button>
          )}
        </div>

        {/* Free plan note */}
        {mode === 'signup' && (
          <p className="text-xs text-muted" style={{ textAlign: 'center', marginTop: '1.25rem', lineHeight: 1.7 }}>
            Free plan includes 50 items, 20 AI summaries/month, and all core features. No credit card required.
          </p>
        )}
      </div>
    </div>
  );
}
