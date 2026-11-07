/**
 * Smart folder filter parser.
 *
 * smartFilter syntax:
 *   tag:lecture          — note must have tag "lecture"
 *   -tag:exam            — note must NOT have tag "exam"      (negation)
 *   type:article         — note.type must be "article"
 *   -type:article        — note.type must NOT be "article"
 *   has:summary          — note must have an AI summary
 *   has:reminder         — note must have a nextReminder set
 *   has:highlights       — note must have at least one highlight
 *   has:attachments      — note must have at least one attachment
 *
 * Rules are comma-separated and ALL must match (AND).
 * Within one rule, `|` separates alternatives of which only one needs to
 * match (OR): "tag:exam|tag:midterm" matches notes tagged exam OR midterm.
 * An OR group binds tighter than the comma-separated AND, so
 * "tag:exam|tag:midterm,type:article" means "(exam OR midterm) AND article".
 *
 * Examples:
 *   "tag:exam"                    → all notes tagged "exam"
 *   "type:article,tag:research"   → articles tagged "research"
 *   "-tag:exam"                   → notes without the "exam" tag
 *   "tag:exam|tag:midterm"        → notes tagged "exam" or "midterm"
 */

import type { Note } from '../types';

/**
 * Result of evaluating a single alternative.
 *   true / false — a definite match or miss
 *   null         — the rule is not recognised, so it cannot decide anything
 */
type AltResult = boolean | null;

/**
 * Evaluate one alternative (no `|`, no comma) against a note.
 * Returns null for unknown rules so callers can decide how to treat them.
 */
function evaluateAlternative(rule: string, note: Note): AltResult {
  const trimmed = rule.trim().toLowerCase();
  if (!trimmed) return null;

  const negated = trimmed.startsWith('-');
  const body = negated ? trimmed.slice(1) : trimmed;

  let match: boolean | null = null;

  if (body.startsWith('tag:')) {
    const tagValue = body.slice(4);
    match = note.tags.some(t => t.toLowerCase() === tagValue);
  } else if (body.startsWith('type:')) {
    match = note.type === body.slice(5);
  } else if (body === 'has:summary') {
    match = !!note.summary;
  } else if (body === 'has:reminder') {
    match = !!note.nextReminder;
  } else if (body === 'has:highlights') {
    match = (note.highlights?.length ?? 0) > 0;
  } else if (body === 'has:attachments') {
    match = (note.files?.length ?? 0) > 0;
  }

  // Unknown rule — it cannot constrain anything.
  if (match === null) return null;
  return negated ? !match : match;
}

/**
 * Evaluate one comma-separated clause, which may be an OR group of
 * alternatives separated by `|`.
 */
function evaluateClause(clause: string, note: Note): boolean {
  const alternatives = clause.split('|').map(a => a.trim()).filter(Boolean);
  if (alternatives.length === 0) return true;

  // A single alternative: unknown rules pass (they never block a note).
  if (alternatives.length === 1) {
    const r = evaluateAlternative(alternatives[0], note);
    return r === null ? true : r;
  }

  // OR group: at least one recognised alternative must match. If none of the
  // alternatives are recognised, the group cannot constrain anything.
  const results = alternatives.map(a => evaluateAlternative(a, note));
  if (results.every(r => r === null)) return true;
  return results.some(r => r === true);
}

export function matchesSmartFilter(note: Note, smartFilter: string): boolean {
  if (!smartFilter) return true;
  const clauses = smartFilter.split(',').filter(Boolean);
  return clauses.every(clause => evaluateClause(clause, note));
}

/** Human-readable text for a single alternative. */
function describeAlternative(rule: string): string {
  const trimmed = rule.trim();
  const lower = trimmed.toLowerCase();
  const negated = lower.startsWith('-');
  const body = negated ? lower.slice(1) : lower;
  const prefix = negated ? 'not ' : '';

  if (body.startsWith('tag:'))  return `${prefix}tagged "${body.slice(4)}"`;
  if (body.startsWith('type:')) return `${prefix}type = ${body.slice(5)}`;
  if (body === 'has:summary')     return `${prefix}has AI summary`;
  if (body === 'has:reminder')    return `${prefix}has reminder`;
  if (body === 'has:highlights')  return `${prefix}has highlights`;
  if (body === 'has:attachments') return `${prefix}has attachments`;
  return trimmed;
}

export function previewSmartFilter(filter: string): string {
  const clauses = filter.split(',').filter(Boolean);
  return clauses.map(clause => {
    const alternatives = clause.split('|').map(a => a.trim()).filter(Boolean);
    if (alternatives.length === 0) return '';
    return alternatives.map(describeAlternative).join(' or ');
  }).filter(Boolean).join(' + ');
}
