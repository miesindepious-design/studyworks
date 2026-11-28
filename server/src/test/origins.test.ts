/**
 * The trusted-origin list.
 *
 * One list, shared by the CORS middleware and Better Auth's `trustedOrigins`.
 * When they were two separate lists they drifted, and the desktop app's
 * sign-in broke in two different ways depending on which gate rejected the
 * request first: "Failed to fetch" from the browser (no
 * `Access-Control-Allow-Origin` on the preflight), then "Invalid origin"
 * from Better Auth (403 INVALID_ORIGIN).
 *
 * These tests pin the list so a new platform origin — or a typo — cannot
 * silently break one client while the other keeps working.
 */
import { describe, it, expect } from 'vitest';
import { DESKTOP_ORIGINS, TRUSTED_ORIGINS, WEB_ORIGINS } from '../lib/origins.js';

describe('trusted origins', () => {
  it('trusts every Tauri desktop origin', () => {
    // macOS/Linux, Windows by default, Windows with useHttpsScheme.
    expect(TRUSTED_ORIGINS).toContain('tauri://localhost');
    expect(TRUSTED_ORIGINS).toContain('http://tauri.localhost');
    expect(TRUSTED_ORIGINS).toContain('https://tauri.localhost');
  });

  it('trusts the web app origins', () => {
    expect(TRUSTED_ORIGINS).toContain('https://studyworks-seven.vercel.app');
    expect(TRUSTED_ORIGINS).toContain('http://localhost:5173');
  });

  it('lists the desktop origins in one place', () => {
    expect(DESKTOP_ORIGINS).toEqual([
      'tauri://localhost',
      'http://tauri.localhost',
      'https://tauri.localhost',
    ]);
  });

  it('has no duplicates', () => {
    expect(new Set(TRUSTED_ORIGINS).size).toBe(TRUSTED_ORIGINS.length);
  });

  it('combines the web and desktop origins', () => {
    expect(TRUSTED_ORIGINS).toEqual([...new Set([...WEB_ORIGINS, ...DESKTOP_ORIGINS])]);
  });

  it('does not trust an unknown origin', () => {
    expect(TRUSTED_ORIGINS).not.toContain('https://evil.example.com');
  });
});
