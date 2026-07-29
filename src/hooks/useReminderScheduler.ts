/**
 * useReminderScheduler
 *
 * Polls every 60 seconds. When a note or contact reminder is due (and hasn't
 * been fired yet), it:
 *   1. Shows a browser notification
 *   2. Records the fired time in a Set so it doesn't fire again this session
 *
 * The service worker handles notifications when the tab is closed/hidden.
 * This hook handles them when the tab IS active (foreground fallback).
 */

import { useEffect, useRef } from 'react';
import type { Note, Contact } from '../types';

interface UseReminderSchedulerOptions {
  notes:    Note[];
  contacts: Contact[];
  enabled:  boolean;   // false if permission not granted
  notify:   (title: string, options?: NotificationOptions) => void;
}

const POLL_INTERVAL_MS = 60_000; // 1 minute

export function useReminderScheduler({
  notes, contacts, enabled, notify,
}: UseReminderSchedulerOptions) {
  // Track which reminder IDs we've already fired this session
  const firedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) return;

    const check = () => {
      const now = new Date();

      // ── Note reminders ───────────────────────────────────────────────────
      for (const note of notes) {
        if (!note.nextReminder) continue;
        const due = new Date(note.nextReminder);
        const key = `note-${note.id}-${due.getTime()}`;
        if (due <= now && !firedRef.current.has(key)) {
          firedRef.current.add(key);
          notify(`📝 Revisit: ${note.title}`, {
            body: `You scheduled a reminder to revisit this ${note.type}.`,
            tag:  key,
            data: { type: 'note', id: note.id },
          } as NotificationOptions);
        }
      }

      // ── Contact reminders ────────────────────────────────────────────────
      for (const contact of contacts) {
        if (!contact.nextReminder) continue;
        const due = new Date(contact.nextReminder);
        const key = `contact-${contact.id}-${due.getTime()}`;
        if (due <= now && !firedRef.current.has(key)) {
          firedRef.current.add(key);
          notify(`👥 Follow up: ${contact.name}`, {
            body: `Reminder to get in touch with ${contact.name} (${contact.role}).`,
            tag:  key,
            data: { type: 'contact', id: contact.id },
          } as NotificationOptions);
        }
      }
    };

    // Run immediately then on interval
    check();
    const id = setInterval(check, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [notes, contacts, enabled, notify]);
}
