/**
 * The grades card on the dashboard.
 *
 * The card exists because a grade tracker that lives only on its own page is
 * a page nobody opens. So it has to answer the two questions the student
 * actually has, at a glance:
 *
 *   - am I on track?
 *   - what is due next?
 *
 * These tests check that the card says those things honestly — including
 * when the answer is "an A is out of reach", which is exactly the answer a
 * card like this must not soften.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import GradesCard from './GradesCard';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  localStorage.clear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function assignment(over: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    title: 'Midterm essay',
    course: 'Biology',
    category: 'Exam',
    weight: 40,
    score: 32,
    maxScore: 40,
    dueDate: null,
    notes: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...over,
  };
}

async function render(items: unknown[], authenticated = false) {
  localStorage.setItem('sw-assignments', JSON.stringify(items));
  await act(async () => {
    root.render(<GradesCard authenticated={authenticated} onOpenGrades={() => {}} />);
  });
  await act(async () => { await Promise.resolve(); });
  return container.textContent ?? '';
}

describe('the grades card', () => {
  it('says when there is nothing to track yet', async () => {
    const text = await render([]);
    expect(text).toContain('Grades');
    expect(text).toContain('Track your assignments');
  });

  it('shows the current weighted grade and its letter', async () => {
    const text = await render([assignment({ score: 36, maxScore: 40 })]);
    expect(text).toContain('90.0%');
    expect(text).toContain('A');
  });

  it('says how much has been marked and how much has not', async () => {
    const text = await render([
      assignment({ id: 'a1', score: 36, maxScore: 40 }),
      assignment({ id: 'a2', title: 'Final', weight: 60, score: null }),
    ]);
    expect(text).toContain('1');
    expect(text).toContain('2 assignments');
  });

  it('says what the remaining work has to average to reach an A', async () => {
    const text = await render([
      assignment({ id: 'a1', weight: 50, score: 40, maxScore: 50 }),
      assignment({ id: 'a2', title: 'Final', weight: 50, score: null }),
    ]);
    // 80% so far over half the course; 90% overall needs 100% on the rest.
    expect(text).toContain('100.0%');
  });

  it('says an A is out of reach rather than softening it', async () => {
    const text = await render([
      assignment({ id: 'a1', weight: 90, score: 18, maxScore: 90 }),
      assignment({ id: 'a2', title: 'Final', weight: 10, score: null }),
    ]);
    expect(text).toContain('out of reach');
  });

  it('lists the deadlines that are still ahead', async () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 3);
    const later = new Date();
    later.setDate(later.getDate() + 20);

    const text = await render([
      assignment({ id: 'a1', title: 'Lab report', dueDate: soon.toISOString() }),
      assignment({ id: 'a2', title: 'Final paper', dueDate: later.toISOString() }),
    ]);
    expect(text).toContain('Lab report');
    expect(text).toContain('Due in 3 days');
    expect(text).toContain('Final paper');
  });

  it('leaves out deadlines that have already passed', async () => {
    const past = new Date();
    past.setDate(past.getDate() - 5);
    const text = await render([
      assignment({ id: 'a1', title: 'Old quiz', dueDate: past.toISOString() }),
    ]);
    expect(text).not.toContain('Old quiz');
  });
});
