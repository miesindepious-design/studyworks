/**
 * desktopAuth.ts — Google sign-in for the Tauri desktop app.
 *
 * Problem: Google OAuth needs a real https:// redirect URI. Inside Tauri's
 * webview the page origin is tauri://localhost, which Google rejects.
 *
 * Solution:
 *   1. We tell Google to redirect to:
 *        https://studyworks-seven.vercel.app/auth/callback/google?desktop=1
 *   2. That page sets the session cookie (normal Better Auth flow).
 *   3. It then redirects to our custom scheme:
 *        studyworks://auth/callback?token=<session_token>
 *   4. Tauri intercepts that URL, fires a deep-link event.
 *   5. We catch it here, store the token, and reload.
 *
 * For now (simpler approach while we don't have the deep-link server-side
 * piece built): open the full Vercel app in the system browser for sign-in,
 * then the user copies a one-time token back — OR we use the email/password
 * path which works fine in the webview.
 *
 * The simplest working approach: redirect the Google button to open the
 * Vercel sign-in page in the system browser. After they sign in there, the
 * session cookie lives on the Vercel domain. API calls from the desktop app
 * go to that same domain, so the cookie IS sent — it's a first-party cookie
 * on the Vercel origin, not on tauri://localhost.
 */

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

/** True when running inside the Tauri desktop shell. */
export const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

/**
 * Start Google sign-in.
 *
 * - Browser build: normal Better Auth social sign-in (redirect in-page).
 * - Desktop build: open the Google auth flow in the system browser.
 *   The user completes sign-in there; the session cookie is set on the
 *   Vercel domain which is the same origin all API calls go to.
 */
export async function signInWithGoogle(): Promise<void> {
  if (!isTauri) {
    // Normal web flow — Better Auth handles everything in-page.
    const { signIn } = await import('../api/auth');
    await signIn.social({ provider: 'google', callbackURL: '/' });
    return;
  }

  // Desktop: get the Google auth URL from the server then open it in the
  // system browser.  The user logs in through Chrome/Edge/Firefox, the
  // session cookie is set on the Vercel domain, and all subsequent API
  // calls from the desktop app (which go to that same domain via
  // VITE_API_URL) will carry that cookie automatically.
  const authUrl = `${API_BASE}/auth/signin/google?callbackURL=${encodeURIComponent(API_BASE + '/?desktop=1')}`;

  // @ts-ignore — Tauri's invoke is injected at runtime
  await window.__TAURI__.core.invoke('open_in_browser', { url: authUrl });

  // Show a prompt telling the user to come back after signing in.
  // The app will pick up the session on the next API call.
  window.dispatchEvent(new CustomEvent('sw:desktop-auth-opened'));
}
