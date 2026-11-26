/**
 * The tutor's conversation history.
 *
 * Two things matter here:
 *
 *   1. The shape. The tutor used to send only the assistant answers, so the
 *      model never saw what the student asked and Gemini received
 *      `model, model, …, user` — no context and an invalid role order.
 *
 *   2. The size. A single SVG diagram is several hundred tokens of markup.
 *      Replaying it on every follow-up is pure waste, so the source is
 *      replaced with a marker.
 */

import { describe, it, expect } from 'vitest';

import { buildChatHistory } from './TutorView';

const SVG_BLOCK = '```svg\n<svg viewBox="0 0 680 300"><rect width="10" height="10"/></svg>\n```';

const turn = (over: Partial<Parameters<typeof buildChatHistory>[0][number]> = {}) => ({
  id: 't1',
  mode: 'lesson' as const,
  topic: 'photosynthesis',
  response: 'A lesson.',
  at: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

describe('buildChatHistory', () => {
  it('is empty for a fresh conversation', () => {
    expect(buildChatHistory([])).toEqual([]);
  });

  it('alternates user and assistant turns', () => {
    const history = buildChatHistory([
      turn({ id: 'a' }),
      turn({ id: 'b', response: 'Second answer.' }),
    ]);
    expect(history.map(h => h.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  });

  it('shows the model what the student asked for', () => {
    const history = buildChatHistory([turn()]);
    expect(history[0].role).toBe('user');
    expect(history[0].content).toContain('photosynthesis');
  });

  it('replays the follow-up instruction so the model has the context', () => {
    const history = buildChatHistory([
      turn({ instruction: 'The student explicitly asked for a diagram.' }),
    ]);
    expect(history[0].content).toContain('asked for a diagram');
  });

  it('replays a quiz answer as the student turn', () => {
    const history = buildChatHistory([
      turn({ mode: 'quiz', question: '6CO2', response: 'Correct!' }),
    ]);
    expect(history[0].content).toContain('6CO2');
  });

  it('drops SVG markup from a replayed answer', () => {
    const history = buildChatHistory([
      turn({ response: `Here it is.\n\n${SVG_BLOCK}\n\nThat is the flow.` }),
    ]);
    const answer = history[1].content;
    expect(answer).not.toContain('<svg');
    expect(answer).not.toContain('```svg');
    expect(answer).toContain('Here it is.');
    expect(answer).toContain('That is the flow.');
    expect(answer).toContain('a diagram was drawn here');
  });

  it('keeps a line diagram in the replayed answer', () => {
    // A plain-text diagram is cheap and the model may want to refer to it.
    const history = buildChatHistory([
      turn({ response: '```diagram\n  A ──▶ B\n```' }),
    ]);
    expect(history[1].content).toContain('──▶');
  });

  it('replays a Socratic answer as the student turn', () => {
    const history = buildChatHistory([
      turn({ mode: 'socratic', question: 'sunlight, water and CO2', response: 'Good. Where is that energy captured?' }),
    ]);
    expect(history[0].role).toBe('user');
    expect(history[0].content).toContain('sunlight, water and CO2');
    expect(history[1].role).toBe('assistant');
    expect(history[1].content).toContain('Where is that energy captured');
  });

  it('keeps the topic in view on every Socratic turn', () => {
    // Without the topic the model loses what it is leading the student to,
    // and the second question of a session drifts off the subject.
    const history = buildChatHistory([
      turn({ mode: 'socratic', response: 'First question?' }),
      turn({ mode: 'socratic', question: 'My first answer', response: 'Second question?' }),
    ]);
    expect(history[0].content).toContain('photosynthesis');
    expect(history[2].content).toContain('photosynthesis');
    expect(history[2].content).toContain('My first answer');
  });
});
