/**
 * AuthPage — handles Sign In, Sign Up, and Forgot Password.
 * Shown when there is no active session.
 */

import { useState, useEffect } from 'react';
import { signIn, signUp, forgotPassword, signInWithGoogle } from '../api/auth';
import type { AuthUser } from '../api/auth';

type AuthMode = 'signin' | 'signup' | 'forgot';

function passwordStrength(pw: string): { score: number; label: string; color: string } {
  if (!pw) return { score: 0, label: '', color: 'transparent' };
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { score, label: 'Weak',       color: 'var(--danger)' };
  if (score <= 3) return { score, label: 'Fair',       color: 'var(--warning)' };
  if (score === 4) return { score, label: 'Good',       color: 'rgb(56 189 248)' };
  return { score, label: 'Strong', color: 'var(--success)' };
}

interface AuthPageProps {
  onAuth: (user: AuthUser) => void;
}

export default function AuthPage({ onAuth }: AuthPageProps) {
  const [mode,  setMode]  = useState<AuthMode>('signin');
  const isSignin = mode === 'signin';
  const isSignup = mode === 'signup';
  const isForgot = mode === 'forgot';
  const [name,  setName]  = useState('');
  const [email, setEmail] = useState('');
  const [pass,  setPass]  = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [rememberMe, setRememberMe] = useState(() => {
    try { return localStorage.getItem('studyworks:rememberMe') === '1'; } catch { return false; }
  });
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showPass, setShowPass] = useState(false);
  const [fadeDir, setFadeDir] = useState<'in' | 'out'>('in');
  const strength = passwordStrength(pass);

  const reset = () => { setError(null); setSuccess(null); };

  // Persist remember me preference
  useEffect(() => {
    try { localStorage.setItem('studyworks:rememberMe', rememberMe ? '1' : '0'); } catch {}
  }, [rememberMe]);

  // Smooth fade between auth modes
  const switchMode = (newMode: AuthMode) => {
    setFadeDir('out');
    setTimeout(() => { setMode(newMode); setFadeDir('in'); reset(); }, 200);
  };

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
        if (pass !== confirmPass) {
          setError('Passwords do not match. Please re-type your password carefully.');
          setLoading(false); return;
        }
        const strength = passwordStrength(pass);
        if (strength.score <= 2) {
          setError(`Password is too ${strength.label.toLowerCase()}. Use at least 8 characters with a mix of uppercase, lowercase, and numbers.`);
          setLoading(false); return;
        }
        const session = await signUp(email, pass, name);
        onAuth(session.user);

      } else if (mode === 'signin') {
        const session = await signIn(email, pass);
        onAuth(session.user);

      } else {
        if (!email) {
          setError('Please enter your email address to receive a reset link.');
          setLoading(false); return;
        }
        await forgotPassword(email);
        setSuccess('Check your email for a password reset link. It should arrive within a few minutes.');
      }
    } catch (err: any) {
      const msg = err.message || 'Something went wrong. Please try again.';
      if (msg.toLowerCase().includes('email') && msg.toLowerCase().includes('exist')) {
        setError('An account with this email already exists. Try signing in instead, or use a different email.');
      } else if (msg.toLowerCase().includes('invalid') && msg.toLowerCase().includes('credential')) {
        setError('Invalid email or password. Please double-check and try again.');
      } else if (msg.toLowerCase().includes('too many') || msg.toLowerCase().includes('rate')) {
        setError('Too many attempts. Please wait a moment and try again.');
      } else {
        setError(msg);
      }
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
          <img src="/logo.svg" alt="StudyWorks" style={{ width: 56, height: 56, marginBottom: '0.75rem' }} />
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
        <div className="card elevated" style={{
          padding: '2rem',
          animation: fadeDir === 'in' ? 'slideUp 0.3s ease both' : 'none',
          opacity: fadeDir === 'in' ? 1 : 0,
          transition: 'opacity 0.2s ease',
        }}>

          {/* Error / Success */}
          {error && (
            <div className="card" style={{ marginBottom: '1.25rem', background: 'var(--danger-soft)', border: '1px solid var(--danger)', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
              <span style={{ flexShrink: 0 }}>❌</span>
              <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>
            </div>
          )}
          {success && (
            <div className="card" style={{ marginBottom: '1.25rem', background: 'var(--success-soft)', border: '1px solid var(--success)', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
              <span style={{ flexShrink: 0 }}>✅</span>
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
            {!isForgot && (
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="form-label">Password</label>
                  {isSignin && (
                    <button type="button" className="btn btn-ghost btn-xs" onClick={() => switchMode('forgot')} style={{ color: 'var(--accent)', padding: 0 }}>
                      Forgot password?
                    </button>
                  )}
                </div>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPass ? 'text' : 'password'} className="input"
                    placeholder={isSignup ? 'Minimum 8 characters' : 'Your password'}
                    value={pass} onChange={e => setPass(e.target.value)} required
                    autoComplete={isSignup ? 'new-password' : 'current-password'}
                    minLength={isSignup ? 8 : undefined}
                    style={{ paddingRight: '2.75rem' }}
                  />
                  <button
                    type="button" onClick={() => setShowPass(v => !v)}
                    aria-label={showPass ? 'Hide password' : 'Show password'}
                    className="pw-toggle"
                  >{showPass ? '🙈' : '👁️'}</button>
                </div>

                {/* Password strength indicator — signup only */}
                {isSignup && pass && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.25rem' }}>
                      {[1, 2, 3, 4, 5].map(i => (
                        <div key={i} style={{
                          flex: 1, height: '4px', borderRadius: 'var(--r-full)',
                          background: i <= strength.score ? strength.color : 'var(--surface-3)',
                          transition: 'background 0.3s ease',
                        }} />
                      ))}
                    </div>
                    {strength.label && (
                      <p className="text-xs" style={{ color: strength.color, fontWeight: 600 }}>
                        {strength.label}
                        {strength.score < 4 && ' — add uppercase, numbers, or symbols for a stronger password'}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Confirm password — signup only */}
            {isSignup && (
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
                {confirmPass && pass !== confirmPass && (
                  <p className="text-xs" style={{ color: 'var(--danger)', marginTop: '0.25rem' }}>Passwords do not match.</p>
                )}
                {confirmPass && pass === confirmPass && pass.length >= 8 && (
                  <p className="text-xs" style={{ color: 'var(--success)', marginTop: '0.25rem' }}>✓ Passwords match</p>
                )}
              </div>
            )}

            {/* Remember me — signin only */}
            {isSignin && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setRememberMe(v => !v)}
                  style={{
                    width: '18px', height: '18px', borderRadius: 'var(--radius-sm)',
                    border: `2px solid ${rememberMe ? 'var(--accent)' : 'var(--border-strong)'}`,
                    background: rememberMe ? 'var(--accent)' : 'transparent',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, padding: 0,
                  }}
                  role="checkbox" aria-checked={rememberMe}
                >
                  {rememberMe && <span style={{ color: 'var(--accent-ink)', fontSize: '0.7rem', fontWeight: 700 }}>✓</span>}
                </button>
                <span className="text-sm" style={{ color: 'var(--text-2)' }}>Remember me on this device</span>
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
          {isForgot && (
            <button className="btn btn-ghost btn-sm" onClick={() => switchMode('signin')} style={{ width: '100%', marginTop: '1rem', color: 'var(--text-2)' }}>
              ← Back to Sign In
            </button>
          )}

          {/* Social proof / trust indicators */}
          {!isForgot && (
            <div className="card" style={{
              marginTop: '1.5rem', padding: '0.875rem 1rem',
              background: 'var(--surface-2)', border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', gap: '0.75rem',
            }}>
              <div style={{ fontSize: '1.25rem', flexShrink: 0 }}>🔒</div>
              <div>
                <p className="text-xs" style={{ fontWeight: 600, color: 'var(--text-2)', marginBottom: '0.125rem' }}>
                  Trusted by students at 200+ universities
                </p>
                <p className="text-xs text-muted" style={{ lineHeight: 1.5 }}>
                  Encrypted in transit · Locally stored · We never share your data.
                </p>
              </div>
            </div>
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
