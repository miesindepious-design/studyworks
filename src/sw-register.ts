/**
 * Service Worker registration + Periodic Sync setup.
 * Called once from main.tsx.
 */

const SW_URL = '/sw.js';

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;

  try {
    const registration = await navigator.serviceWorker.register(SW_URL, {
      scope: '/',
    });

    console.info('[StudyWorks] Service worker registered:', registration.scope);

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
