/**
 * backlinks.ts — extract [[wiki-style]] links from note content and
 * compute backlinks (which notes link TO this one).
 *
 * Used by NotesView's "Related" section to promote user-declared relations
 * above tag-only matches, and to render an explicit "Backlinks" list.
 */

import type { Note } from '../types';

const LINK_REGEX = /\[\[([^\]]+)\]\]/g;

/**
 * Extract the set of wiki-link targets from a note's content.
 * The target is the literal text inside [[…]], lowercased and trimmed.
 * Duplicates removed.
 */
export function extractWikiLinks(note: Note): string[] {
  const text = (note.content || '') + ' ' + (note.title || '');
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  LINK_REGEX.lastIndex = 0;
  while ((m = LINK_REGEX.exec(text)) !== null) {
    found.add(m[1].trim().toLowerCase());
  }
  return Array.from(found);
}

/**
 * For a given note, return the notes that link TO it via [[wiki]] syntax.
 * Matches are case-insensitive on title.
 */
export function findBacklinks(target: Note, allNotes: Note[]): Note[] {
  const targetTitle = (target.title || '').toLowerCase();
  if (!targetTitle) return [];
  return allNotes.filter(n => {
    if (n.id === target.id) return false;
    return extractWikiLinks(n).includes(targetTitle);
  });
}

/**
 * Build a complete title → note map for the library.
 * On title collision, the most recently updated note wins.
 */
export function buildTitleIndex(notes: Note[]): Map<string, Note> {
  const map = new Map<string, Note>();
  for (const n of notes) {
    if (!n.title) continue;
    const key = n.title.toLowerCase();
    const existing = map.get(key);
    if (!existing || new Date(n.updatedAt ?? n.createdAt) > new Date(existing.updatedAt ?? existing.createdAt)) {
      map.set(key, n);
    }
  }
  return map;
}

/**
 * Combined "related" score for two notes. Higher = more related.
 *
 *   - Wikilink from A → B is the strongest signal (+10).
 *   - Wikilink from B → A is also strong (+10, symmetric).
 *   - Jaccard tag overlap scales the match (up to +5).
 *   - Same folder: +1.
 *
 * Earlier versions only used tag overlap, which produced noisy results
 * ("every lecture note is related to every other lecture note" because
 * they all share the "lecture" tag). Wikilinks are user-declared so they
 * outweigh tag noise.
 */
export function relatedScore(a: Note, b: Note): number {
  if (a.id === b.id) return 0;
  let score = 0;

  // Wikilinks (either direction)
  const aLinks = new Set(extractWikiLinks(a));
  const bLinks = new Set(extractWikiLinks(b));
  if (aLinks.has((b.title || '').toLowerCase())) score += 10;
  if (bLinks.has((a.title || '').toLowerCase())) score += 10;

  // Tag Jaccard
  const aTags = new Set(a.tags || []);
  const bTags = new Set(b.tags || []);
  if (aTags.size || bTags.size) {
    const intersection = new Set([...aTags].filter(t => bTags.has(t)));
    const union        = new Set([...aTags, ...bTags]);
    if (union.size) score += 5 * (intersection.size / union.size);
  }

  // Same folder
  if (a.folderId && a.folderId === b.folderId) score += 1;

  return score;
}

/**
 * Return the top-N related notes for `target`, sorted by score desc.
 * Notes with score 0 are excluded.
 */
export function findRelated(target: Note, allNotes: Note[], n = 3): Note[] {
  return allNotes
    .filter(other => other.id !== target.id)
    .map(other => ({ other, score: relatedScore(target, other) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map(({ other }) => other);
}
