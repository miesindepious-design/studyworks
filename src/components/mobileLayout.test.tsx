/**
 * Mobile layout guard.
 *
 * Several pages used to hard-code their two-column layouts in inline styles
 * (`gridTemplateColumns: '280px 1fr'`), which no media query can override —
 * the AI Tutor overflowed a 390px phone by ~190px. The fix was to move every
 * fixed layout onto a CSS class that the mobile stylesheet can collapse.
 *
 * These tests render the real components and assert that no inline
 * `grid-template-columns` survives, so the layouts stay collapsible.
 */

import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';

import TutorView from './TutorView';
import MultiplayerQuiz from './MultiplayerQuiz';
import ContactsView from './ContactsView';
import FlashcardsView from './FlashcardsView';

const noop = () => {};

function renderTutor() {
  return renderToString(
    createElement(TutorView, {
      tier: 'pro',
      setCurrentView: noop,
      addToast: noop,
      notes: [],
      onSaveNote: noop,
    }),
  );
}

function renderQuiz() {
  return renderToString(
    createElement(MultiplayerQuiz, {
      db: { xp: 0, setXp: noop } as never,
      userId: 'u1',
      userName: 'Alex',
      tier: 'pro',
      setCurrentView: noop,
      addToast: noop,
    }),
  );
}

function renderContacts() {
  return renderToString(
    createElement(ContactsView, {
      contacts: [],
      setContacts: noop,
      tier: 'pro',
      setCurrentView: noop,
      addToast: noop,
      totalItems: 0,
      folders: [],
      setFolders: noop,
    }),
  );
}

function renderFlashcards() {
  return renderToString(
    createElement(FlashcardsView, {
      flashcards: [],
      setFlashcards: noop,
      practiceQuestions: [],
      setPracticeQuestions: noop,
      tier: 'pro',
      setCurrentView: noop,
      addToast: noop,
      totalItems: 0,
      folders: [],
      setFolders: noop,
    }),
  );
}

describe('Mobile layouts stay collapsible', () => {
  it('the AI Tutor uses a class-based, collapsible layout', () => {
    const html = renderTutor();
    expect(html).toContain('sw-tutor-layout');
    expect(html).not.toMatch(/grid-template-columns:\s*280px/);
  });

  it('Quiz Battle uses a class-based, collapsible layout', () => {
    const html = renderQuiz();
    // The lobby/leaderboard split uses .sw-quiz-layout; the create-join
    // screen uses the shared two-column helper. Neither may hard-code a
    // fixed-width inline grid.
    expect(html).toContain('sw-two-col');
    expect(html).not.toMatch(/grid-template-columns:\s*1fr 280px/);
  });

  it('no page hard-codes a two-column grid inline', () => {
    const pages = [renderTutor(), renderQuiz(), renderContacts(), renderFlashcards()];
    for (const html of pages) {
      expect(html).not.toMatch(/grid-template-columns:\s*1fr 1fr/);
    }
  });
});
