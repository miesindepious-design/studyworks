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
  /** 7-day trial window (server starts it on first login). */
  trialStartsAt?: string | null;
  trialEndsAt?:   string | null;
  /** Student profile captured at signup — drives the AI tutor. */
  schoolStage?:    'primary' | 'secondary' | 'university' | null;
  schoolClass?:    string | null;
  universityYear?: string | null;
  department?:     string | null;
  educationLevel?: string | null;
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
// Browser build: normal Better Auth social flow — redirect in-page.
// Desktop build: open the Google auth URL in the system browser so Google
// gets a real https:// redirect URI (tauri://localhost is rejected by Google).
// After sign-in the session cookie is set on the Vercel domain, which is the
// same origin all API calls go to, so the cookie arrives automatically.
export async function signInWithGoogle(): Promise<void> {
  const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

  // The callbackURL the server redirects to after Google confirms the user.
  // In the desktop app we send them back to the Vercel URL (which sets the
  // cookie there), then they return to the desktop app manually.
  const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
  const callbackURL      = isTauri ? API_BASE + '/?desktop=1'          : window.location.origin;
  const errorCallbackURL = isTauri ? API_BASE + '/?authError=google'   : `${window.location.origin}?authError=google`;

  const { url } = await apiFetch<{ url: string; redirect: boolean }>('/auth/sign-in/social', {
    method: 'POST',
    body: JSON.stringify({ provider: 'google', callbackURL, errorCallbackURL }),
  });

  if (isTauri) {
    // Open in the system browser — user completes sign-in there.
    // @ts-ignore — Tauri's invoke is injected at runtime
    await window.__TAURI__.core.invoke('open_in_browser', { url });
    // Fire an event so AuthPage can show "Return to the app after signing in"
    window.dispatchEvent(new CustomEvent('sw:desktop-auth-opened'));
  } else {
    window.location.href = url;
  }
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
  // In the desktop app window.location.origin is tauri://localhost — not a
  // URL any browser can open from an email link.  Use the Vercel URL instead.
  const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;
  const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
  const origin = isTauri ? API_BASE : window.location.origin;
  await apiFetch('/auth/forget-password', {
    method: 'POST',
    body: JSON.stringify({ email, redirectTo: `${origin}/reset-password` }),
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
// Better Auth's update-user route accepts `name` and `image` (a URL or data
// URL — we send a small resized data URL from the client).
export async function updateProfile(
  name: string,
  image?: string | null,
): Promise<AuthUser> {
  const body: Record<string, unknown> = { name };
  if (image !== undefined) body.image = image; // null clears the picture
  return apiFetch<AuthUser>('/auth/update-user', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
