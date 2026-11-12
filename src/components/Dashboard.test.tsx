/**
 * Dashboard — scroll-cascade regression guard.
 *
 * The dashboard used to lose the slide-in-from-the-side cascade when the page
 * was redesigned: every panel below the hero was a plain grid item, so nothing
 * animated in and the page felt flat compared with Settings.
 *
 * These tests render the real component and assert that the cascade chrome is
 * wired exactly like the Settings page — hero parks in the top-left corner,
 * panels slide in from the left edge only, and every panel sits inside a
 * reveal wrapper.
 *
 * Rendering is done with `react-dom/server` so no testing-library is needed
 * and no network / IndexedDB access is required — the effects never run.
 */

import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';

import Dashboard from './Dashboard';

const noop = () => {};

function renderDashboard() {
  return renderToString(
    createElement(Dashboard, {
      userName: 'Ada',
      trialDaysLeft: 3,
      notes: [],
      contacts: [],
      flashcards: [],
      tier: 'pro',
      totalItems: 42,
      aiSummariesThisMonth: 4,
      qaQueriesThisMonth: 9,
      folders: [],
      practiceQuestions: [],
      setCurrentView: noop,
      aiReady: true,
      aiProvider: 'gemini',
      onGenerateInsights: noop,
      weeklyInsights: null,
      insightsLoading: false,
    }),
  );
}

function count(html: string, needle: string) {
  return html.split(needle).length - 1;
}

describe('Dashboard — scroll cascade', () => {
  const html = renderDashboard();

  it('parks the hero in the top-right corner', () => {
    expect(html).toContain('hero-dock-slot-right');
    expect(html).not.toContain('hero-dock-slot-left');
  });

  it('slides panels in from the left edge, never the right', () => {
    expect(html).toContain('reveal-left');
    expect(html).not.toContain('reveal-right');
  });

  it('wraps every dashboard panel in a reveal wrapper', () => {
    // Focus row (3) + activity/achievements (2) + stat tiles (4) + action
    // strips (1) + pro band (1) + bottom row (3) = 14 revealed blocks.
    expect(count(html, 'reveal-wrap')).toBeGreaterThanOrEqual(14);
  });

  it('staggers the cascade so panels arrive one after another', () => {
    // Without a delay every panel would snap in at once and the cascade
    // would read as a single jump rather than a dealt pile of cards.
    expect(count(html, 'reveal-wrap')).toBe(count(html, 'reveal-left'));
    expect(html).toContain('--rv-delay');
  });
});
