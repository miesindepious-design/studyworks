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
    expect(titles).toEqual([
      '🎓 Student Profile',
      '🎨 Appearance',
      '🤖 AI Features',
      '⏱️ Study Timer',
      '🔔 Notifications &amp; Reminders',
      '🔗 Folder Sharing',
      '📧 Save by Email',
      '💬 Contact Support',
      '📱 Install App',
      '💾 Data &amp; Storage',
      '⌨️ Keyboard Shortcuts',
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

  it('parks the hero in the top-left corner', () => {
    expect(html).toContain('hero-dock-slot-left');
    expect(html).not.toContain('hero-dock-slot-right');
  });

  it('slides panels in from the left edge', () => {
    expect(html).toContain('reveal-left');
    expect(html).not.toContain('reveal-right');
  });

  it('wraps every settings card in a reveal wrapper', () => {
    // 11 cards; Phase2Tools wraps its own three, the rest are wrapped by
    // SettingsView. Every card must therefore sit inside a reveal.
    expect(count(html, 'reveal-wrap')).toBeGreaterThanOrEqual(11);
  });

  it('renders the settings hero', () => {
    expect(html).toContain('Your workspace');
    expect(html).toContain('settings-hero');
  });
});
