/**
 * Service Worker registration + Periodic Sync setup.
 * Called once from main.tsx.
 *
 * Update handling (fixes the "white screen on other devices" bug):
 *  - We check for a new SW on every load.
 *  - The new SW installs (skipWaiting) and claims the page; when control
 *    passes from an OLD SW to a NEW one ('controllerchange'), we reload the
 *    page once so it boots with fresh HTML + matching hashed assets.
 *  - The reload only fires when a previous controller existed (an actual
 *    update), never on first visit — that would be a pointless reload loop.
 */

const SW_URL = '/sw.js';

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;

  try {
    const registration = await navigator.serviceWorker.register(SW_URL, {
      scope: '/',
    });

    console.info('[StudyWorks] Service worker registered:', registration.scope);

    // ── Self-healing update flow ──────────────────────────────────────────
    // A previous SW was controlling this page; if a NEW one takes over,
    // reload once so the page isn't running old code against new assets.
    const hadController = !!navigator.serviceWorker.controller;
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || refreshing) return;
      refreshing = true;
      console.info('[StudyWorks] New app version activated — reloading…');
      window.location.reload();
    });

    // Poll for updates on every load and nudge a waiting SW to activate.
    registration.update().catch(() => {});
    if (registration.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      installing?.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          installing.postMessage({ type: 'SKIP_WAITING' });
        }
      });
    });

    // Request periodic background sync if supported
    // This lets the SW fire reminders even when the tab is closed
    if ('periodicSync' in registration) {
      try {
        const status = await navigator.permissions.query({
          name: 'periodic-background-sync' as PermissionName,
        });
        if (status.state === 'granted') {
          await (registration as any).periodicSync.register('studyworks-reminder-check', {
            minInterval: 60 * 60 * 1000, // check at most every hour
          });
          console.info('[StudyWorks] Periodic sync registered (1h interval)');
        }
      } catch {
        // periodicSync not available — foreground polling handles it
      }
    }

    // Listen for messages from SW (e.g. notification click routing)
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'REMINDER_CLICK') {
        // Dispatch a custom event so App.tsx can handle navigation
        window.dispatchEvent(new CustomEvent('sw-reminder-click', { detail: event.data.data }));
      }
    });

    return registration;
  } catch (err) {
    console.warn('[StudyWorks] Service worker registration failed:', err);
    return null;
  }
}
