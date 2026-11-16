/**
 * keyPoints.ts — the "important points" engine.
 *
 * Both the AI Tutor (for a plain topic) and the document analyzer (for an
 * uploaded file) need the same thing: a short, prioritised list of what the
 * student MUST know. Asking the model for that in a second provider call
 * would double latency and burn the user's quota, so instead the model is
 * asked to close its reply with a machine-readable block:
 *
 *   <<<KEY_POINTS>>>
 *   [{"importance":"must-know","point":"…","why":"…"}]
 *   <<<END_KEY_POINTS>>>
 *
 * This module extracts that block, parses it defensively (models like to
 * wrap it in a ```json fence, add a trailing comma, or write it as a plain
 * bullet list) and returns the cleaned answer text plus the parsed points.
 *
 * The same parser handles the document analyzer, whose *whole* reply is a
 * JSON object containing a `keyPoints` array.
 */

export type KeyPointImportance = 'must-know' | 'should-know' | 'good-to-know';

export interface KeyPoint {
  /** The fact itself, written so a student can revise it from memory. */
  point: string;
  /** Why it matters — what breaks if you get it wrong. */
  why: string;
  /** How strongly the student needs it. */
  importance: KeyPointImportance;
}

export const KEY_POINTS_OPEN = '<<<KEY_POINTS>>>';
export const KEY_POINTS_CLOSE = '<<<END_KEY_POINTS>>>';

/** Order used when grouping points by importance. */
export const IMPORTANCE_ORDER: KeyPointImportance[] = ['must-know', 'should-know', 'good-to-know'];

export const IMPORTANCE_LABELS: Record<KeyPointImportance, string> = {
  'must-know':     'Must know',
  'should-know':   'Should know',
  'good-to-know':  'Good to know',
};

// ── Normalisation ────────────────────────────────────────────────────────────

const IMPORTANCE_ALIASES: Record<string, KeyPointImportance> = {
  'must-know':    'must-know',
  'must know':    'must-know',
  'mustknow':     'must-know',
  'essential':    'must-know',
  'critical':     'must-know',
  'core':         'must-know',
  'high':         'must-know',
  'priority':     'must-know',
  'should-know':  'should-know',
  'should know':  'should-know',
  'important':    'should-know',
  'medium':       'should-know',
  'secondary':    'should-know',
  'good-to-know': 'good-to-know',
  'good to know': 'good-to-know',
  'nice-to-know': 'good-to-know',
  'extra':        'good-to-know',
  'optional':     'good-to-know',
  'low':          'good-to-know',
};

export function normalizeImportance(value: unknown): KeyPointImportance {
  if (typeof value !== 'string') return 'should-know';
  const key = value.trim().toLowerCase().replace(/[_–—]/g, '-');
  if (IMPORTANCE_ALIASES[key]) return IMPORTANCE_ALIASES[key];
  // "nice to know" → "nice-to-know", "must know" → "must-know".
  const hyphenated = key.replace(/\s+/g, '-');
  if (IMPORTANCE_ALIASES[hyphenated]) return IMPORTANCE_ALIASES[hyphenated];
  // "must know (high priority)" → match the first known alias inside.
  for (const alias of Object.keys(IMPORTANCE_ALIASES)) {
    if (key.includes(alias)) return IMPORTANCE_ALIASES[alias];
  }
  return 'should-know';
}

function cleanString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
}

/** Accepts a single object or an array and returns a normalized KeyPoint[]. */
export function parseKeyPoints(input: unknown): KeyPoint[] {
  let list: unknown[] = [];

  if (Array.isArray(input)) {
    list = input;
  } else if (typeof input === 'string') {
    const parsed = tryParseJson(input);
    if (Array.isArray(parsed)) list = parsed;
    else if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      const nested = obj.keyPoints ?? obj.key_points ?? obj.points;
      if (Array.isArray(nested)) list = nested;
    } else {
      return parseLoosePoints(input);
    }
  } else if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    const nested = obj.keyPoints ?? obj.key_points ?? obj.points;
    if (Array.isArray(nested)) list = nested;
    else list = [input];
  }

  const out: KeyPoint[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const point = cleanString(e.point ?? e.text ?? e.title ?? e.fact ?? e.content);
    if (!point) continue;
    out.push({
      point,
      why: cleanString(e.why ?? e.reason ?? e.explanation ?? e.rationale ?? e.importance_reason),
      importance: normalizeImportance(e.importance ?? e.priority ?? e.level ?? e.tier),
    });
  }
  return out;
}

// ── JSON helpers ─────────────────────────────────────────────────────────────

function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const attempts: string[] = [trimmed];

  // Strip a ```json … ``` fence.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) attempts.push(fenced[1].trim());

  // Pull the first balanced [...] or {...} out of the text.
  const bracket = trimmed.match(/\[[\s\S]*\]/);
  if (bracket) attempts.push(bracket[0]);
  const brace = trimmed.match(/\{[\s\S]*\}/);
  if (brace) attempts.push(brace[0]);

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch {
      // Try again with trailing commas removed — models add them often.
      const relaxed = attempt.replace(/,\s*([}\]])/g, '$1');
      if (relaxed !== attempt) {
        try { return JSON.parse(relaxed); } catch { /* keep going */ }
      }
    }
  }
  return null;
}

// ── Loose (non-JSON) parsing ─────────────────────────────────────────────────
// "- (must-know) Photosynthesis stores energy as glucose | It is the core of the chapter"
// "1. [must-know] … — why it matters"

const LINE_RE = /^\s*(?:[-*•]|\d+[.)])?\s*[\[(]?\s*(must[\s-]?know|should[\s-]?know|good[\s-]?to[\s-]?know|essential|critical|important|optional|extra)\s*[\])]?\s*[:\-–—]?\s*(.+)$/i;

export function parseLoosePoints(text: string): KeyPoint[] {
  const out: KeyPoint[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(LINE_RE);
    if (!m) continue;
    const importance = normalizeImportance(m[1]);
    let body = m[2].trim();
    let why = '';
    // Split on a pipe or an em dash — the two separators models use for
    // "point | why" / "point — why".
    const split = body.split(/\s*(?:\||—|–)\s*/);
    if (split.length >= 2) {
      body = split[0].trim();
      why = split.slice(1).join(' — ').trim();
    }
    if (body) out.push({ point: body, why, importance });
  }
  return out;
}

// ── Block extraction ─────────────────────────────────────────────────────────

export interface ExtractedKeyPoints {
  /** The reply with the machine-readable block removed. */
  text: string;
  keyPoints: KeyPoint[];
  /** True when the block was present (even if it failed to parse). */
  found: boolean;
}

/**
 * Pull the `<<<KEY_POINTS>>> … <<<END_KEY_POINTS>>>` block out of a reply.
 *
 * The block is removed from the text so the user never sees the raw markers,
 * and the parsed points are returned separately for the UI to render as a
 * "Key points to remember" panel.
 */
export function extractKeyPointsBlock(raw: string): ExtractedKeyPoints {
  if (!raw) return { text: '', keyPoints: [], found: false };

  const openIdx = raw.indexOf(KEY_POINTS_OPEN);
  if (openIdx === -1) return { text: raw.trim(), keyPoints: [], found: false };

  const closeIdx = raw.indexOf(KEY_POINTS_CLOSE, openIdx + KEY_POINTS_OPEN.length);
  const inner = closeIdx === -1
    ? raw.slice(openIdx + KEY_POINTS_OPEN.length)
    : raw.slice(openIdx + KEY_POINTS_OPEN.length, closeIdx);

  const before = raw.slice(0, openIdx);
  const after = closeIdx === -1 ? '' : raw.slice(closeIdx + KEY_POINTS_CLOSE.length);
  const text = `${before}${after}`.trim();

  let keyPoints = parseKeyPoints(inner);
  if (keyPoints.length === 0) keyPoints = parseLoosePoints(inner);

  return { text, keyPoints, found: true };
}

/**
 * The instruction appended to a tutor prompt so the model emits the block.
 * Kept in one place so the tutor and the document analyzer stay in sync.
 */
export const KEY_POINTS_INSTRUCTION = `End your reply with a machine-readable block containing the most important points the student must know.
Use exactly this format, with nothing after the closing marker:
${KEY_POINTS_OPEN}
[{"importance":"must-know","point":"one sentence a student can memorise","why":"why it matters"},{"importance":"should-know","point":"…","why":"…"}]
${KEY_POINTS_CLOSE}
Give 4-8 points. Use "must-know" for the core ideas that will be examined, "should-know" for supporting detail, and "good-to-know" for extras.`;
