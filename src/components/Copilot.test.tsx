/**
 * Copilot — the in-app guide.
 *
 * The Copilot is the answer to "where do I find X?" and "how do I do X?".
 * Two things therefore have to hold:
 *
 *   1. The matcher has to find the right article for a wide spread of
 *      phrasings — including the ones nobody wrote down ("back up my data",
 *      "pomodoro", "complaint").
 *   2. Every article must point somewhere real. An article with a `view`
 *      that isn't in the nav model would send the user to a dead end, so the
 *      knowledge base is validated against the nav model here.
 *
 * Rendering uses `react-dom/server`, so no testing-library and no effects.
 */
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';

import Copilot from './Copilot';
import {
  COPILOT_ARTICLES,
  COPILOT_ACTION_IDS,
  COPILOT_SUGGESTIONS,
  COPILOT_TASKS,
  matchCopilot,
  scoreArticle,
  type CopilotActionId,
} from '../config/copilot';
import { NAV_ITEMS } from '../config/nav';

const noop = () => {};

function renderCopilot(open: boolean) {
  return renderToString(
    createElement(Copilot, {
      open,
      onOpen: noop,
      onClose: noop,
      currentView: 'dashboard',
      onNavigate: noop,
      onAction: noop as (a: CopilotActionId) => void,
    }),
  );
}

/** The id of the best-scoring article for a query, or null. */
function bestId(query: string): string | null {
  return matchCopilot(query)[0]?.article.id ?? null;
}

describe('Copilot — matcher', () => {
  it('finds features by their plain name', () => {
    expect(bestId('flashcards')).toBe('create-flashcards');
    expect(bestId('timer')).toBe('start-timer');
    expect(bestId('notifications')).toBe('notifications');
    expect(bestId('support')).toBe('contact-support');
  });

  it('finds features by the words people actually use', () => {
    expect(bestId('back up my data')).toBe('export-data');
    expect(bestId('restore a backup')).toBe('import-data');
    expect(bestId('complaint')).toBe('contact-support');
    expect(bestId('pomodoro')).toBe('start-timer');
    expect(bestId('web page')).toBe('save-from-url');
  });

  it('prefers the article that answers the whole question', () => {
    // "save a note from a web page" should land on Save-from-URL, not on the
    // generic "create a note" article that also matches "note" and "save".
    expect(bestId('how do I save a note from a web page')).toBe('save-from-url');
  });

  it('does not pad the results with unrelated articles', () => {
    // Question words and two-letter words used to match as substrings, so
    // "where do I find flashcards" came back with half the library.
    const ids = matchCopilot('where do I find flashcards').map(m => m.article.id);
    expect(ids).toContain('create-flashcards');
    expect(ids).not.toContain('export-data');
    expect(ids).not.toContain('search-notes');
    expect(ids.every(id => id.includes('flashcard') || id === 'due-flashcards' || id === 'review-flashcards')).toBe(true);
  });

  it('still finds an article through a single precise synonym', () => {
    // "pomodoro" only matches one keyword — the threshold has to let that
    // through on its own.
    expect(bestId('pomodoro')).toBe('start-timer');
    expect(bestId('qa')).toBe('ai-qa');
  });

  it('returns nothing for a question it cannot answer', () => {
    expect(matchCopilot('asdfghjkl')).toHaveLength(0);
    expect(matchCopilot('')).toHaveLength(0);
    expect(matchCopilot('   ')).toHaveLength(0);
  });

  it('ranks a whole-phrase match above a scattered one', () => {
    const exact = scoreArticle(
      COPILOT_ARTICLES.find(a => a.id === 'contact-support')!,
      'contact support',
    );
    const scattered = scoreArticle(
      COPILOT_ARTICLES.find(a => a.id === 'contact-support')!,
      'contact something supportish',
    );
    expect(exact).toBeGreaterThan(scattered);
  });

  it('is case- and punctuation-insensitive', () => {
    expect(bestId('  FLASH CARDS?  ')).toBe('create-flashcards');
  });
});

describe('Copilot — knowledge base integrity', () => {
  it('gives every article a unique id', () => {
    const ids = COPILOT_ARTICLES.map(a => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('points every article at a real page or a runnable task', () => {
    const views = new Set(NAV_ITEMS.map(i => i.view));
    for (const article of COPILOT_ARTICLES) {
      expect(
        article.view !== undefined || article.action !== undefined,
        `article "${article.id}" points nowhere`,
      ).toBe(true);
      if (article.view) {
        expect(views.has(article.view), `article "${article.id}" → unknown view "${article.view}"`).toBe(true);
      }
    }
  });

  it('only uses actions the Copilot knows how to run', () => {
    const known = new Set<string>(COPILOT_ACTION_IDS);
    for (const article of COPILOT_ARTICLES) {
      if (article.action) {
        expect(known.has(article.action), `article "${article.id}" → unknown action "${article.action}"`).toBe(true);
      }
    }
  });

  it('offers every action as a quick task or a deep link', () => {
    // An action that appears on no article and in no quick-task chip would be
    // unreachable — the Copilot could never offer it.
    const offered = new Set<string>(COPILOT_TASKS.map(t => t.id));
    for (const article of COPILOT_ARTICLES) {
      if (article.action) offered.add(article.action);
    }
    for (const action of COPILOT_ACTION_IDS) {
      expect(offered.has(action), `action "${action}" is never offered`).toBe(true);
    }
  });

  it('gives every article a summary and enough keywords to be findable', () => {
    for (const article of COPILOT_ARTICLES) {
      expect(article.summary.length, `article "${article.id}" has no summary`).toBeGreaterThan(20);
      expect(article.keywords.length, `article "${article.id}" has no keywords`).toBeGreaterThan(0);
      expect(article.title.length).toBeGreaterThan(5);
    }
  });

  it('only suggests questions the Copilot can actually answer', () => {
    for (const question of COPILOT_SUGGESTIONS) {
      expect(matchCopilot(question).length, `"${question}" matches nothing`).toBeGreaterThan(0);
    }
  });
});

describe('Copilot — component', () => {
  it('shows only the launcher when closed', () => {
    const html = renderCopilot(false);
    expect(html).toContain('sw-copilot-fab');
    expect(html).not.toContain('sw-copilot-panel');
  });

  it('offers quick tasks and popular questions when opened', () => {
    const html = renderCopilot(true);
    expect(html).toContain('sw-copilot-panel');
    expect(html).toContain('Quick tasks');
    expect(html).toContain('Popular questions');
    for (const task of COPILOT_TASKS) {
      expect(html).toContain(task.label);
    }
  });

  it('renders a search box and a close control', () => {
    const html = renderCopilot(true);
    expect(html).toContain('sw-copilot-search');
    expect(html).toContain('Where do I find');
    expect(html).toContain('Close Copilot');
  });
});
