/**
 * Tests for the smart-folder filter DSL.
 *
 * Syntax:
 *   tag:lecture          — note must have tag "lecture"
 *   -tag:exam            — note must NOT have tag "exam"  (negation)
 *   type:article         — note.type must be "article"
 *   has:summary          — note must have an AI summary
 *   has:reminder         — note must have a nextReminder set
 *   has:highlights       — note must have at least one highlight
 *   has:attachments      — note must have at least one file
 *   starred              — note is starred
 *
 * Rules are comma-separated and ALL must match (AND).
 * Within a single rule, `|` separates alternatives that need only one to
 * match (OR): "tag:exam|tag:midterm" matches notes tagged exam OR midterm.
 */
import { describe, it, expect } from 'vitest';
import { matchesSmartFilter, previewSmartFilter } from './smartFolders';
import type { Note } from '../types';

const note = (over: Partial<Note> = {}): Note =>
  ({
    id: 'n1',
    title: 'Note',
    content: '',
    tags: [],
    type: 'note',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }) as Note;

describe('matchesSmartFilter — existing AND semantics', () => {
  it('matches everything for an empty filter', () => {
    expect(matchesSmartFilter(note(), '')).toBe(true);
  });

  it('requires every comma-separated rule to match', () => {
    const n = note({ tags: ['lecture'], type: 'article' });
    expect(matchesSmartFilter(n, 'tag:lecture,type:article')).toBe(true);
    expect(matchesSmartFilter(n, 'tag:lecture,type:note')).toBe(false);
  });

  it('ignores unknown rules instead of blocking the note', () => {
    expect(matchesSmartFilter(note(), 'bogus:thing')).toBe(true);
  });
});

describe('matchesSmartFilter — negation', () => {
  it('excludes notes that have the negated tag', () => {
    const n = note({ tags: ['lecture', 'exam'] });
    expect(matchesSmartFilter(n, '-tag:exam')).toBe(false);
  });

  it('keeps notes that lack the negated tag', () => {
    const n = note({ tags: ['lecture'] });
    expect(matchesSmartFilter(n, '-tag:exam')).toBe(true);
  });

  it('negation is case-insensitive', () => {
    const n = note({ tags: ['Exam'] });
    expect(matchesSmartFilter(n, '-tag:exam')).toBe(false);
  });

  it('negation combines with positive rules via AND', () => {
    const n = note({ tags: ['lecture', 'exam'] });
    expect(matchesSmartFilter(n, 'tag:lecture,-tag:exam')).toBe(false);
    expect(matchesSmartFilter(n, 'tag:lecture,-tag:homework')).toBe(true);
  });

  it('negated type rule excludes the matching type', () => {
    expect(matchesSmartFilter(note({ type: 'article' }), '-type:article')).toBe(false);
    expect(matchesSmartFilter(note({ type: 'note' }), '-type:article')).toBe(true);
  });
});

describe('matchesSmartFilter — OR within a rule', () => {
  it('matches when any alternative matches', () => {
    const n = note({ tags: ['midterm'] });
    expect(matchesSmartFilter(n, 'tag:exam|tag:midterm')).toBe(true);
  });

  it('does not match when no alternative matches', () => {
    const n = note({ tags: ['lecture'] });
    expect(matchesSmartFilter(n, 'tag:exam|tag:midterm')).toBe(false);
  });

  it('supports more than two alternatives', () => {
    const n = note({ tags: ['final'] });
    expect(matchesSmartFilter(n, 'tag:exam|tag:midterm|tag:final')).toBe(true);
  });

  it('OR groups bind tighter than the comma-separated AND', () => {
    const n = note({ tags: ['midterm'], type: 'article' });
    expect(matchesSmartFilter(n, 'tag:exam|tag:midterm,type:article')).toBe(true);
    expect(matchesSmartFilter(n, 'tag:exam|tag:midterm,type:note')).toBe(false);
  });

  it('supports OR across different rule kinds', () => {
    const n = note({ tags: [], type: 'article' });
    expect(matchesSmartFilter(n, 'tag:exam|type:article')).toBe(true);
  });

  it('supports a negated alternative inside an OR group', () => {
    const n = note({ tags: ['lecture'] });
    expect(matchesSmartFilter(n, 'tag:exam|-tag:lecture')).toBe(false);
    expect(matchesSmartFilter(n, 'tag:exam|-tag:homework')).toBe(true);
  });
});

describe('matchesSmartFilter — has: rules', () => {
  it('matches notes with a summary', () => {
    expect(matchesSmartFilter(note({ summary: 'hello' }), 'has:summary')).toBe(true);
    expect(matchesSmartFilter(note({}), 'has:summary')).toBe(false);
  });

  it('matches notes with attachments', () => {
    const n = note({
      files: [
        { id: 'f1', name: 'a.pdf', type: 'pdf', size: 10, url: 'x', uploadedAt: new Date() },
      ],
    });
    expect(matchesSmartFilter(n, 'has:attachments')).toBe(true);
  });
});

describe('previewSmartFilter', () => {
  it('renders a negated tag rule', () => {
    expect(previewSmartFilter('-tag:exam')).toContain('not');
    expect(previewSmartFilter('-tag:exam')).toContain('exam');
  });

  it('renders an OR group', () => {
    const p = previewSmartFilter('tag:exam|tag:midterm');
    expect(p).toContain('exam');
    expect(p).toContain('midterm');
    expect(p).toContain('or');
  });

  it('renders plain rules', () => {
    expect(previewSmartFilter('has:summary')).toBe('has AI summary');
  });
});
