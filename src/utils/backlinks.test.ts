/**
 * Tests for the backlink + related-note scoring utilities.
 */
import { describe, it, expect } from 'vitest';
import { extractWikiLinks, findBacklinks, findRelated, relatedScore, buildTitleIndex } from './backlinks';
import type { Note } from '../types';

function makeNote(over: Partial<Note> = {}): Note {
  return {
    id:        over.id        ?? 'n-' + Math.random().toString(36).slice(2, 8),
    title:     over.title     ?? 'Untitled',
    content:   over.content   ?? '',
    tags:      over.tags      ?? [],
    type:      over.type      ?? 'note',
    createdAt: over.createdAt ?? new Date('2025-01-01'),
    updatedAt: over.updatedAt ?? new Date('2025-01-01'),
    folderId:  over.folderId,
    ...over,
  };
}

describe('extractWikiLinks', () => {
  it('finds [[Title]] patterns in content', () => {
    const n = makeNote({ content: 'See [[Biology 101]] and [[Chemistry Lab]]' });
    expect(extractWikiLinks(n).sort()).toEqual(['biology 101', 'chemistry lab']);
  });

  it('deduplicates', () => {
    const n = makeNote({ content: '[[Bio]] and [[Bio]] again' });
    expect(extractWikiLinks(n)).toEqual(['bio']);
  });

  it('returns [] for content with no links', () => {
    expect(extractWikiLinks(makeNote({ content: 'no links here' }))).toEqual([]);
  });
});

describe('findBacklinks', () => {
  it('returns notes that link TO the target', () => {
    const target = makeNote({ id: 'a', title: 'Biology 101' });
    const other  = makeNote({ id: 'b', content: 'See [[Biology 101]]' });
    expect(findBacklinks(target, [target, other])).toEqual([other]);
  });

  it('is case-insensitive', () => {
    const target = makeNote({ id: 'a', title: 'Biology 101' });
    const other  = makeNote({ id: 'b', content: 'see [[biology 101]]' });
    expect(findBacklinks(target, [other])).toEqual([other]);
  });

  it('excludes the target itself', () => {
    const target = makeNote({ id: 'a', title: 'A', content: 'self [[A]]' });
    expect(findBacklinks(target, [target])).toEqual([]);
  });
});

describe('relatedScore', () => {
  it('returns 0 for the same note', () => {
    const n = makeNote();
    expect(relatedScore(n, n)).toBe(0);
  });

  it('awards 10 for a wikilink either direction', () => {
    const a = makeNote({ id: 'a', title: 'A', content: 'see [[B]]' });
    const b = makeNote({ id: 'b', title: 'B' });
    expect(relatedScore(a, b)).toBeGreaterThanOrEqual(10);
    expect(relatedScore(b, a)).toBeGreaterThanOrEqual(10);
  });

  it('Jaccard tag overlap scales the score', () => {
    const a = makeNote({ id: 'a', title: 'A', tags: ['x', 'y', 'z'] });
    const b = makeNote({ id: 'b', title: 'B', tags: ['x', 'y'] });
    // intersection 2, union 3, score = 5 * 2/3 = 3.33
    expect(relatedScore(a, b)).toBeCloseTo(3.33, 1);
  });

  it('same folder gives +1', () => {
    const a = makeNote({ id: 'a', title: 'A', folderId: 'f1' });
    const b = makeNote({ id: 'b', title: 'B', folderId: 'f1' });
    expect(relatedScore(a, b)).toBe(1);
  });
});

describe('findRelated', () => {
  it('returns top-N by score, excluding score-0', () => {
    const target = makeNote({ id: 't', title: 'Target' });
    const a      = makeNote({ id: 'a', title: 'A', content: '[[Target]]' });            // wikilink → 10
    const b      = makeNote({ id: 'b', title: 'B', content: '[[Target]]', tags: ['x', 'y'] }); // wikilink + Jaccard → ~10
    const c      = makeNote({ id: 'c', title: 'C' });                                   // score 0
    const r = findRelated(target, [target, a, b, c], 5);
    expect(r.map(n => n.id).sort()).toEqual(['a', 'b']);
  });

  it('orders by score desc (wikilink beats tag-only)', () => {
    const target = makeNote({ id: 't', title: 'Target', tags: ['x', 'y', 'z'] });
    const wikilinked = makeNote({ id: 'w', title: 'W', content: '[[Target]]' });     // 10
    const tagOnly    = makeNote({ id: 'g', title: 'G', tags: ['x', 'y'] });          // Jaccard = 2/3 * 5 ≈ 3.3
    const r = findRelated(target, [target, wikilinked, tagOnly], 5);
    expect(r[0].id).toBe('w');
    expect(r[1].id).toBe('g');
  });

  it('caps at N results', () => {
    const target = makeNote({ id: 't', title: 'Target' });
    const all    = Array.from({ length: 10 }, (_, i) =>
      makeNote({ id: 'n' + i, title: 'N' + i, content: `[[Target]]` })
    );
    expect(findRelated(target, [target, ...all], 3)).toHaveLength(3);
  });
});

describe('buildTitleIndex', () => {
  it('returns the most recent note on title collision', () => {
    const older = makeNote({ id: '1', title: 'Dup', updatedAt: new Date('2024-01-01') });
    const newer = makeNote({ id: '2', title: 'Dup', updatedAt: new Date('2025-01-01') });
    const idx   = buildTitleIndex([older, newer]);
    expect(idx.get('dup')?.id).toBe('2');
  });
});
