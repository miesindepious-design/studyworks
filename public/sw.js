/**
 * StudyWorks Service Worker
 * Handles:
 *   - Background reminder checks via periodic sync (where supported)
 *   - Push notification display
 *   - Notification click routing back to the app
 *   - Basic offline caching of the app shell
 */

const CACHE_NAME    = 'studyworks-v1';
const APP_SHELL     = ['/', '/index.html'];

// ── Install: cache app shell ─────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// ── Activate: clean up old caches ────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: serve from cache, fall back to network ────────────────────────────
self.addEventListener('fetch', event => {
  // Only handle GET requests for same-origin navigation
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});

// ── Push notifications ────────────────────────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  let payload = { title: 'StudyWorks', body: 'You have a reminder!', tag: 'reminder', data: {} };
  try { payload = { ...payload, ...event.data.json() }; } catch {}

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body:  payload.body,
      icon:  '/icon-192.svg',
      badge: '/icon-192.svg',
      tag:   payload.tag,
      data:  payload.data,
      actions: [
        { action: 'open',    title: 'Open'    },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    })
  );
});

// ── Periodic background sync (fires reminders even when app is closed) ────────
self.addEventListener('periodicsync', event => {
  if (event.tag === 'studyworks-reminder-check') {
    event.waitUntil(checkReminders());
  }
});

async function checkReminders() {
  // Open IDB and check for due reminders
  const db = await openStudyWorksDB();
  if (!db) return;

  const now = new Date();
  const [notes, contacts] = await Promise.all([
    getAllFromStore(db, 'notes'),
    getAllFromStore(db, 'contacts'),
  ]);

  const notifications = [];

  for (const note of notes) {
    if (!note.nextReminder) continue;
    const due = new Date(note.nextReminder);
    if (due <= now) {
      notifications.push(
        self.registration.showNotification(`📝 Revisit: ${note.title}`, {
          body:  `You set a reminder to revisit this ${note.type}.`,
          icon:  '/icon-192.svg',
          badge: '/icon-192.svg',
          tag:   `note-${note.id}-${due.getTime()}`,
          data:  { type: 'note', id: note.id },
          actions: [
            { action: 'open',    title: 'Open'    },
            { action: 'dismiss', title: 'Dismiss' },
          ],
        })
      );
    }
  }

  for (const contact of contacts) {
    if (!contact.nextReminder) continue;
    const due = new Date(contact.nextReminder);
    if (due <= now) {
      notifications.push(
        self.registration.showNotification(`👥 Follow up: ${contact.name}`, {
          body:  `Reminder to reach out to ${contact.name} (${contact.role}).`,
          icon:  '/icon-192.svg',
          badge: '/icon-192.svg',
          tag:   `contact-${contact.id}-${due.getTime()}`,
          data:  { type: 'contact', id: contact.id },
          actions: [
            { action: 'open',    title: 'Open'    },
            { action: 'dismiss', title: 'Dismiss' },
          ],
        })
      );
    }
  }

  await Promise.all(notifications);
}

// ── Notification click handler ────────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  const data = event.notification.data || {};
  const targetUrl = data.type === 'contact'
    ? '/?view=contacts'
    : data.type === 'note'
    ? '/?view=notes'
    : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // Focus existing window if open
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.postMessage({ type: 'REMINDER_CLICK', data });
          return;
        }
      }
      // Open new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

// ── IDB helpers (minimal, no idb library in SW) ───────────────────────────────
function openStudyWorksDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('studyworks-db', 1);
    req.onerror   = () => resolve(null);
    req.onsuccess = () => resolve(req.result);
  });
}

function getAllFromStore(db, storeName) {
  return new Promise((resolve) => {
    try {
      const tx  = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}
