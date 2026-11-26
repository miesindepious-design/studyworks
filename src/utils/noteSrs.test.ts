/**
 * Tests for note-level spaced repetition.
 *
 * The behaviours that matter:
 *
 *   - the cue never gives away the answer;
 *   - long notes are rated more gently, because recalling them is harder;
 *   - the rating drives the same SM-2 curve the cards use;
 *   - a note that keeps slipping is recognised as a leech.
 */
import { describe, it, expect } from 'vitest';
import {
  buildCue,
  notePlainText,
  cueLeaksAnswer,
  adjustQualityForLength,
  scheduleNote,
  isNoteLeech,
  noteDifficultyReason,
  NOTE_LEECH_THRESHOLD,
} from './noteSrs';
import type { Note } from '../types';

const NOW = new Date(2026, 0, 15, 12, 0, 0);

function note(over: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    title: 'Working memory',
    content: 'Working memory holds roughly four chunks at any one moment.',
    tags: [],
    type: 'note',
    createdAt: new Date(2025, 11, 1),
    updatedAt: new Date(2025, 11, 1),
    ...over,
  } as Note;
}

describe('notePlainText', () => {
  it('strips HTML from the rich-text editor', () => {
    const text = notePlainText(note({ content: '<p>Hello <b>world</b></p>' }));
    expect(text).toBe('Hello world');
  });

  it('collapses whitespace', () => {
    expect(notePlainText(note({ content: 'a\n\n   b' }))).toBe('a b');
  });
});

describe('buildCue', () => {
  it('prefers the summary', () => {
    const cue = buildCue(note({
      summary: 'The chunking hypothesis.',
      content: 'A much longer body that would give everything away.',
    }));
    expect(cue).toBe('The chunking hypothesis.');
  });

  it('falls back to the first sentence', () => {
    const cue = buildCue(note({
      content: 'First sentence here. Second sentence follows it.',
    }));
    expect(cue).toBe('First sentence here.');
  });

  it('cuts a long sentence at a word boundary', () => {
    const long = 'word '.repeat(60);
    const cue = buildCue(note({ content: long }));
    expect(cue.length).toBeLessThanOrEqual(141);
    expect(cue.endsWith('…')).toBe(true);
    expect(cue).not.toContain('  ');
  });

  it('returns nothing when there is no body', () => {
    expect(buildCue(note({ content: '' }))).toBe('');
  });
});

describe('cueLeaksAnswer', () => {
  it('says yes when the cue is essentially the whole note', () => {
    const short = 'A tiny note.';
    expect(cueLeaksAnswer(note({ content: short }))).toBe(true);
  });

  it('says no when the note has much more than the cue', () => {
    const n = note({
      content: 'Working memory holds roughly four chunks. It is a limited-capacity system for temporary storage. The capacity was famously described as seven plus or minus two in early work.',
    });
    expect(cueLeaksAnswer(n)).toBe(false);
  });
});

describe('adjustQualityForLength', () => {
  it('leaves a short note alone', () => {
    expect(adjustQualityForLength(note(), 3)).toBe(3);
    expect(adjustQualityForLength(note(), 0)).toBe(0);
  });

  it('softens "easy" to "good" for a long note', () => {
    const long = note({ content: 'sentence. '.repeat(100) });
    expect(adjustQualityForLength(long, 3)).toBe(2);
  });

  it('does not soften "again" for a long note', () => {
    const long = note({ content: 'sentence. '.repeat(100) });
    expect(adjustQualityForLength(long, 0)).toBe(0);
  });
});

describe('scheduleNote', () => {
  it('schedules a good recall a day out for a fresh note', () => {
    const result = scheduleNote(note(), 2, NOW);
    expect(result.repetitions).toBe(1);
    expect(result.interval).toBe(1);
    expect(result.nextReview!.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('resets the repetition count when the note is forgotten', () => {
    const result = scheduleNote(note({ repetitions: 4, interval: 20 }), 0, NOW);
    expect(result.repetitions).toBe(0);
    expect(result.interval).toBe(1);
  });

  it('counts a failure towards the leech counter', () => {
    expect(scheduleNote(note(), 0, NOW).leechCount).toBe(1);
  });

  it('does not count a success towards the leech counter', () => {
    expect(scheduleNote(note({ leechCount: 1 }), 2, NOW).leechCount).toBe(1);
  });

  it('records the rating in the review trail', () => {
    const result = scheduleNote(note(), 2, NOW);
    expect(result.reviewHistory).toHaveLength(1);
    expect(result.reviewHistory![0].quality).toBe(2);
    expect(result.reviewHistory![0].date).toBe('2026-01-15');
  });

  it('keeps the earlier trail and appends to it', () => {
    const result = scheduleNote(
      note({ reviewHistory: [{ date: '2026-01-10', quality: 2 }] }),
      2, NOW,
    );
    expect(result.reviewHistory).toHaveLength(2);
    expect(result.reviewHistory![0].date).toBe('2026-01-10');
  });

  it('records that the note was revisited', () => {
    expect(scheduleNote(note(), 2, NOW).lastRevisited).toEqual(NOW);
  });

  it('grows the interval as the note is recalled well', () => {
    let n = note();
    let last = 0;
    for (let i = 0; i < 4; i++) {
      const result = scheduleNote(n, 2, NOW);
      last = result.interval ?? 0;
      n = { ...n, ...result };
    }
    expect(last).toBeGreaterThan(1);
  });

  it('softens the rating for a long note, so the interval grows less', () => {
    const short = scheduleNote(note(), 3, NOW);
    const long = scheduleNote(note({ content: 'sentence. '.repeat(100) }), 3, NOW);
    // "Easy" is capped at "Good" for a long note, so its interval is shorter.
    expect(long.interval ?? 0).toBeLessThan(short.interval ?? 0);
  });
});

describe('isNoteLeech', () => {
  it('is false for a note that has never slipped', () => {
    expect(isNoteLeech(note())).toBe(false);
  });

  it('is true once the note has slipped enough times', () => {
    expect(isNoteLeech(note({ leechCount: NOTE_LEECH_THRESHOLD }))).toBe(true);
  });
});

describe('noteDifficultyReason', () => {
  it('says nothing about a healthy note', () => {
    expect(noteDifficultyReason(note())).toBeNull();
  });

  it('explains a note that keeps slipping', () => {
    expect(noteDifficultyReason(note({ leechCount: 3 }))).toContain('splitting');
  });

  it('mentions long notes get gentler scheduling', () => {
    expect(noteDifficultyReason(note({ content: 'sentence. '.repeat(200) }))).toContain('long');
  });
});
