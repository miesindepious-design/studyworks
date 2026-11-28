/**
 * The origins allowed to talk to this API.
 *
 * There used to be two separate lists — one in the CORS middleware and one in
 * Better Auth's `trustedOrigins` — and they drifted apart. The CORS list was
 * missing the Windows desktop origin, and Better Auth's was missing the
 * `http://` variant of it. The result was sign-in that failed only inside the
 * desktop app: the browser rejected the preflight ("Failed to fetch"), and
 * once that was fixed the request came back "Invalid origin".
 *
 * One list, used by both, so the two can never disagree again.
 */

/**
 * The Tauri desktop app serves its frontend from a local protocol, so every
 * API call it makes is cross-origin. The origin it sends depends on the
 * platform and on the app's scheme setting:
 *
 *   - macOS / Linux:                        tauri://localhost
 *   - Windows (WebView2), default scheme:    http://tauri.localhost
 *   - Windows with app.security.useHttpsScheme: https://tauri.localhost
 */
export const DESKTOP_ORIGINS = [
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
];

/** The web app — production, preview deployments, and local development. */
export const WEB_ORIGINS = [
  process.env.FRONTEND_URL || 'http://localhost:5173',
  'https://studyworksfirst-git-master-miesindepious-designs-projects.vercel.app',
  'https://studyworks.vercel.app',
  'https://studyworks-miesindepious-designs-projects.vercel.app',
  'https://studyworks-eight.vercel.app',
  'https://studyworks-seven.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
];

/**
 * Every origin the API answers to. Used by the CORS middleware (which
 * decides whether a browser may read a response) and by Better Auth (which
 * rejects requests from origins it does not trust).
 */
export const TRUSTED_ORIGINS = [...new Set([...WEB_ORIGINS, ...DESKTOP_ORIGINS])];
