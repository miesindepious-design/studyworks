/**
 * Study Plan — rendering tests.
 *
 * The plan is only worth having if it is honest about what is due and if a
 * student can act on it. These tests render the real components (no
 * mocking, no testing-library — `react-dom/server` is enough) and assert
 * that:
 *
 *   1. the plan says what is due, in words;
 *   2. the most urgent item is first;
 *   3. the empty state says "caught up" instead of showing a blank list;
 *   4. the forecast and mistakes tabs render real content;
 *   5. every nav item points at a view that exists.
 */
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';

import StudyPlanView from './StudyPlanView';
import StudyPlanSummary from './StudyPlanSummary';
import { NAV_ITEMS, PAGE_TITLES } from '../config/nav';
import type { Flashcard, Note, PracticeQuestion } from '../types';

const noop = () => {};

const NOW = new Date(2026, 0, 15, 12, 0, 0);

function card(over: Partial<Flashcard> = {}): Flashcard {
  return {
    id: 'c-' + Math.random().toString(36).slice(2, 8),
    question: 'What is spaced repetition?',
    answer: 'Reviewing at widening intervals.',
    tags: [],
    createdAt: new Date(2025, 11, 1),
    updatedAt: new Date(2025, 11, 1),
    ...over,
  } as Flashcard;
}

function question(over: Partial<PracticeQuestion> = {}): PracticeQuestion {
  return {
    id: 'q-' + Math.random().toString(36).slice(2, 8),
    question: 'Explain the forgetting curve.',
    answer: 'Memory decays exponentially without review.',
    type: 'open',
    createdAt: new Date(2025, 11, 1),
    updatedAt: new Date(2025, 11, 1),
    ...over,
  } as PracticeQuestion;
}

function note(over: Partial<Note> = {}): Note {
  return {
    id: 'n-' + Math.random().toString(36).slice(2, 8),
    title: 'Cognitive psychology notes',
    content: 'Working memory holds roughly four chunks.',
    tags: [],
    type: 'note',
    createdAt: new Date(2025, 11, 1),
    updatedAt: new Date(2025, 11, 1),
    ...over,
  } as Note;
}

/**
 * React's server renderer puts `<!-- -->` between adjacent text nodes, so
 * "1 card" arrives as "1<!-- --> card". Strip the comments before asserting
 * on text.
 */
function text(html: string): string {
  return html.replace(/<!--.*?-->/g, '');
}

function renderPlan(props: Partial<React.ComponentProps<typeof StudyPlanView>> = {}) {
  return text(renderToString(createElement(StudyPlanView, {
    flashcards: [],
    practiceQuestions: [],
    notes: [],
    setCurrentView: noop,
    ...props,
  })));
}

describe('StudyPlanView', () => {
  it('says there is nothing to do when nothing is due', () => {
    const html = renderPlan();
    expect(html).toContain('caught up');
  });

  it('offers a way in when the student has no material at all', () => {
    const html = renderPlan();
    expect(html).toContain('Nothing to plan yet');
    expect(html).toContain('Open notes');
  });

  it('lists the item that is due', () => {
    const html = renderPlan({
      flashcards: [card({ id: 'c1', nextReview: new Date(2026, 0, 15, 8, 0) })],
    });
    expect(html).toContain('What is spaced repetition?');
    expect(html).toContain('1 card');
  });

  it('puts a tough card before an ordinary due card', () => {
    const html = renderPlan({
      flashcards: [
        card({ id: 'ordinary', question: 'An ordinary card', nextReview: new Date(2026, 0, 15, 8, 0) }),
        card({ id: 'tough', question: 'A troublesome card', leechCount: 3, nextReview: new Date(2026, 0, 15, 8, 0) }),
      ],
    });
    expect(html.indexOf('A troublesome card')).toBeLessThan(html.indexOf('An ordinary card'));
  });

  it('counts cards, questions and notes separately', () => {
    const html = renderPlan({
      flashcards: [card({ nextReview: new Date(2026, 0, 15, 8, 0) })],
      practiceQuestions: [question({ nextReview: new Date(2026, 0, 15, 8, 0) })],
      notes: [note({ nextReminder: new Date(2026, 0, 15, 8, 0) })],
    });
    expect(html).toContain('1 card');
    expect(html).toContain('1 question');
    expect(html).toContain('1 note');
  });

  it('shows a forecast tab and a mistakes tab', () => {
    // With no material at all the page shows its empty state instead — the
    // tabs only appear once there is something to plan.
    const html = renderPlan({
      flashcards: [card({ nextReview: new Date(2026, 0, 15, 8, 0) })],
    });
    expect(html).toContain('Forecast');
    expect(html).toContain('Mistakes');
  });

  it('shows the mistakes a student has made', () => {
    const html = renderPlan({
      practiceQuestions: [question({ id: 'q1', lastAnsweredCorrect: false })],
    });
    // The mistakes tab is not the default tab, but the count is in the tab label.
    expect(html).toContain('Mistakes (1)');
  });

  it('shows no mistakes when there are none', () => {
    // With material but nothing wrong, the mistakes tab carries no count.
    const html = renderPlan({
      flashcards: [card({ nextReview: new Date(2026, 0, 15, 8, 0) })],
    });
    expect(html).toContain('Mistakes');
    expect(html).not.toContain('Mistakes (');
  });
});

describe('StudyPlanSummary', () => {
  it('says the student is caught up when there is nothing due', () => {
    const html = text(renderToString(createElement(StudyPlanSummary, {
      flashcards: [],
      practiceQuestions: [],
      notes: [],
      onOpenPlan: noop,
    })));
    expect(html).toContain('caught up');
  });

  it('counts what is due', () => {
    const html = text(renderToString(createElement(StudyPlanSummary, {
      flashcards: [card({ nextReview: new Date(2026, 0, 15, 8, 0) })],
      practiceQuestions: [],
      notes: [],
      onOpenPlan: noop,
    })));
    expect(html).toContain('1 to review');
  });

  it('links to the full plan', () => {
    const html = text(renderToString(createElement(StudyPlanSummary, {
      flashcards: [card({ nextReview: new Date(2026, 0, 15, 8, 0) })],
      practiceQuestions: [],
      notes: [],
      onOpenPlan: noop,
    })));
    expect(html).toContain('Open plan');
  });
});

describe('navigation', () => {
  it('has the study plan in the sidebar', () => {
    const plan = NAV_ITEMS.find(i => i.view === 'plan');
    expect(plan).toBeDefined();
    expect(plan!.label).toBe('Study Plan');
  });

  it('gives every nav item a page title', () => {
    for (const item of NAV_ITEMS) {
      expect(PAGE_TITLES[item.view]).toBeTruthy();
    }
  });
});
