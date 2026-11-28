/**
 * CORS for the desktop app.
 *
 * The Tauri desktop build serves the frontend from its own local protocol, so
 * every API call it makes is cross-origin. The origin it sends depends on the
 * platform:
 *
 *   - macOS / Linux: tauri://localhost
 *   - Windows (WebView2): http://tauri.localhost  (https:// when the app
 *     enables `app.security.useHttpsScheme`)
 *
 * If the origin is missing from the allowlist, the preflight comes back
 * without an `Access-Control-Allow-Origin` header and the browser rejects
 * every request with "Failed to fetch" — which is exactly how the desktop
 * app's sign-in broke: both Google and password sign-in post to the API
 * first, so both died at the same wall.
 *
 * These tests pin the desktop origins to the allowlist so a future edit to
 * the CORS block cannot silently break the desktop app again.
 */
import { describe, it, expect } from 'vitest';
import { buildTestApp } from './helpers.js';

/** Preflight a request the way the browser does before a cross-origin POST. */
async function preflight(origin: string) {
  const { request } = await buildTestApp();
  const res = await request('/api/health', {
    method: 'OPTIONS',
    headers: {
      'Origin': origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  return res;
}

describe('CORS', () => {
  it('allows the Tauri desktop origins', async () => {
    for (const origin of [
      'tauri://localhost',
      'http://tauri.localhost',
      'https://tauri.localhost',
    ]) {
      const res = await preflight(origin);
      expect(res.headers.get('access-control-allow-origin')).toBe(origin);
    }
  });

  it('allows the web app origins', async () => {
    for (const origin of [
      'http://localhost:5173',
      'https://studyworks-seven.vercel.app',
    ]) {
      const res = await preflight(origin);
      expect(res.headers.get('access-control-allow-origin')).toBe(origin);
    }
  });

  it('allows credentials, so the session cookie survives the cross-origin call', async () => {
    const res = await preflight('http://tauri.localhost');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('does not allow an unknown origin', async () => {
    const res = await preflight('https://evil.example.com');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
