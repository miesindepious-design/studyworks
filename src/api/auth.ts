/**
 * Auth API — wraps Better Auth client calls.
 * Better Auth exposes its own client SDK but we use raw fetch
 * to keep it simple and framework-agnostic.
 */

import { apiFetch } from './client';

export interface AuthUser {
  id:            string;
  email:         string;
  name:          string | null;
  emailVerified: boolean;
  tier:          'FREE' | 'PRO';
  image?:        string | null;
  createdAt:     string;
}

export interface AuthSession {
  user:    AuthUser;
  session: { id: string; expiresAt: string };
}

// ── Sign up ───────────────────────────────────────────────────────────────────
export async function signUp(email: string, password: string, name: string): Promise<AuthSession> {
  return apiFetch<AuthSession>('/auth/sign-up/email', {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
  });
}

// ── Sign in ───────────────────────────────────────────────────────────────────
export async function signIn(email: string, password: string): Promise<AuthSession> {
  return apiFetch<AuthSession>('/auth/sign-in/email', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

// ── Sign in with Google ───────────────────────────────────────────────────────
// Better Auth social flow: request a Google authorization URL, then redirect
// the whole window there. Google sends the user back to the server callback
// (/auth/callback/google), which sets the session cookie and redirects to
// `callbackURL`. On errors Better Auth appends ?error=... to the callback.
export async function signInWithGoogle(): Promise<void> {
  const { url } = await apiFetch<{ url: string; redirect: boolean }>('/auth/sign-in/social', {
    method: 'POST',
    body: JSON.stringify({
      provider: 'google',
      callbackURL: window.location.origin,          // back to the app on success
      errorCallbackURL: `${window.location.origin}?authError=google`, // and on failure
    }),
  });
  window.location.href = url; // hand the browser to Google
}

// ── Sign out ──────────────────────────────────────────────────────────────────
export async function signOut(): Promise<void> {
  // Better Auth's /auth/sign-out requires a JSON body; an empty body yields
  // 415 Unsupported Media Type, which would make the call throw and leave the
  // session stranded on the client. Send a minimal JSON body so it succeeds.
  await apiFetch('/auth/sign-out', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// ── Get current session ───────────────────────────────────────────────────────
export async function getSession(): Promise<AuthSession | null> {
  try {
    return await apiFetch<AuthSession>('/auth/get-session');
  } catch {
    return null;
  }
}

// ── Forgot password ───────────────────────────────────────────────────────────
export async function forgotPassword(email: string): Promise<void> {
  await apiFetch('/auth/forget-password', {
    method: 'POST',
    body: JSON.stringify({ email, redirectTo: `${window.location.origin}/reset-password` }),
  });
}

// ── Reset password ────────────────────────────────────────────────────────────
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await apiFetch('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  });
}

// ── Update profile ────────────────────────────────────────────────────────────
export async function updateProfile(name: string): Promise<AuthUser> {
  return apiFetch<AuthUser>('/auth/update-user', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}
