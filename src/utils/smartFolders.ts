/**
 * Smart folder filter parser.
 *
 * smartFilter syntax (comma-separated rules, ALL must match):
 *   tag:lecture          — note must have tag "lecture"
 *   type:article         — note.type must be "article"
 *   has:summary          — note must have an AI summary
 *   has:reminder         — note must have a nextReminder set
 *   has:highlights       — note must have at least one highlight
 *   starred              — (future) note is starred
 *
 * Examples:
 *   "tag:exam"                    → all notes tagged "exam"
 *   "type:article,tag:research"   → articles tagged "research"
 */

import type { Note } from '../types';

function parseRule(rule: string, note: Note): boolean {
  const trimmed = rule.trim().toLowerCase();

  if (trimmed.startsWith('tag:')) {
    const tagValue = trimmed.slice(4);
    return note.tags.some(t => t.toLowerCase() === tagValue);
  }
  if (trimmed.startsWith('type:')) {
    return note.type === trimmed.slice(5);
  }
  if (trimmed === 'has:summary') {
    return !!note.summary;
  }
  if (trimmed === 'has:reminder') {
    return !!note.nextReminder;
  }
  if (trimmed === 'has:highlights') {
    return (note.highlights?.length ?? 0) > 0;
  }
  if (trimmed === 'has:attachments') {
    return (note.files?.length ?? 0) > 0;
  }
  // Unknown rule — skip (don't block the note)
  return true;
}

export function matchesSmartFilter(note: Note, smartFilter: string): boolean {
  if (!smartFilter) return true;
  const rules = smartFilter.split(',').filter(Boolean);
  return rules.every(rule => parseRule(rule, note));
}

export function previewSmartFilter(filter: string): string {
  const rules = filter.split(',').filter(Boolean);
  return rules.map(r => {
    const t = r.trim();
    if (t.startsWith('tag:'))  return `tagged "${t.slice(4)}"`;
    if (t.startsWith('type:')) return `type = ${t.slice(5)}`;
    if (t === 'has:summary')       return 'has AI summary';
    if (t === 'has:reminder')      return 'has reminder';
    if (t === 'has:highlights')    return 'has highlights';
    if (t === 'has:attachments')   return 'has attachments';
    return t;
  }).join(' + ');
}
