/**
 * Settings page — duplication guard.
 *
 * The Settings page used to render <Phase2Tools> twice, so Folder Sharing,
 * Save by Email and Contact Support each appeared twice on screen. These tests
 * render the real component and assert that every card and every form control
 * appears exactly once, and that the scroll-cascade chrome is wired correctly.
 *
 * Rendering is done with `react-dom/server` so no testing-library is needed
 * and no network / IndexedDB access is required — the effects never run.
 */

import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';

import SettingsView from './SettingsView';
import type { UseNotificationsResult } from '../hooks/useNotifications';

const notif: UseNotificationsResult = {
  permission: 'default',
  request: async () => 'granted',
  notify: () => {},
  supported: true,
};

const noop = () => {};

function renderSettings() {
  return renderToString(
    createElement(SettingsView, {
      notif,
      tier: 'pro',
      onAddToast: noop,
      onShowShortcuts: noop,
      folders: [{ id: 'default', name: 'Default', createdAt: new Date() }],
      theme: 'dark',
      onThemeChange: noop,
      accent: 'indigo',
      onAccentChange: noop,
      displayName: 'Ada',
      data: {
        notes: [],
        contacts: [],
        flashcards: [],
        practiceQuestions: [],
        savedSearches: [],
      },
    }),
  );
}

/** Count non-overlapping occurrences of a literal in the rendered markup. */
function count(haystack: string, needle: string): number {
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    n += 1;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

/** Every card heading on the page, in render order. */
function cardTitles(html: string): string[] {
  return [...html.matchAll(/class="card-title">([^<]*)</g)].map(m => m[1]);
}

describe('Settings page — no feature repeats itself', () => {
  const html = renderSettings();
  const titles = cardTitles(html);

  it('renders exactly the expected set of cards', () => {
    // The order follows the page's bento layout: profile / timer / daily
    // goal across the top row, then the daily limits, notifications and the
    // weekly digest on the second, appearance / install + shortcuts on the
    // third, then the full-width AI card, the sharing trio, and the data
    // band.
    expect(titles).toEqual([
      '🎓 Student Profile',
      '⏱️ Study Timer',
      '🎯 Daily goal',
      '🧱 Daily Limits',
      '🔔 Notifications &amp; Reminders',
      '📬 Weekly digest',
      '🎨 Appearance',
      '📱 Install App',
      '⌨️ Keyboard Shortcuts',
      '🤖 AI Features',
      '🔗 Folder Sharing',
      '📧 Save by Email',
      '💬 Contact Support',
      '💾 Data &amp; Storage',
    ]);
  });

  it('renders no card heading twice', () => {
    const seen = new Set<string>();
    const dupes = titles.filter(t => (seen.has(t) ? true : (seen.add(t), false)));
    expect(dupes).toEqual([]);
  });

  it('renders Folder Sharing exactly once', () => {
    expect(count(html, 'Folder Sharing')).toBe(1);
  });

  it('renders Save by Email exactly once', () => {
    expect(count(html, 'Save by Email')).toBe(1);
  });

  it('renders Contact Support exactly once', () => {
    expect(count(html, 'Contact Support')).toBe(1);
  });

  it('renders each study-level control exactly once', () => {
    // The AI card used to carry its own level dropdown, duplicating the
    // Student Profile card. Now only the profile card owns these controls.
    expect(count(html, 'Select level…')).toBe(1);
    expect(count(html, 'Select stage…')).toBe(1);
  });

  it('renders the timer settings panel once', () => {
    // The Timer tab and Settings used to each render their own copy of these
    // controls, writing the same localStorage key.
    expect(count(html, 'Focus session duration')).toBe(1);
    expect(count(html, 'Break duration')).toBe(1);
  });
});

describe('Settings page — scroll cascade', () => {
  const html = renderSettings();

  it('parks the hero in the top-right corner', () => {
    expect(html).toContain('hero-dock-slot-right');
    expect(html).not.toContain('hero-dock-slot-left');
  });

  it('renders every card immediately — no reveal animation to miss', () => {
    // The scroll-cascade reveal left cards invisible in full-page captures
    // and slow environments, so the settings board renders plain: every card
    // sits in a grid cell and no reveal wrapper remains.
    expect(html).not.toContain('reveal-wrap');
    expect(count(html, 'sw-settings-cell')).toBeGreaterThanOrEqual(11);
  });

  it('renders the settings hero', () => {
    expect(html).toContain('Your workspace');
    expect(html).toContain('settings-hero');
  });
});
