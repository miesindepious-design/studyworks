/**
 * tutorDoc.ts — turn an AI Tutor session into a document.
 *
 * The tutor used to dump its whole lesson into the notes section as one long
 * block of text. That is unreadable a week later, when what the student
 * actually wants is a handout, a worksheet or a deck they can print, present
 * or edit.
 *
 * So the lesson is parsed into structured blocks (headings, bullets, tables,
 * diagrams), and the block list is rendered into a real file:
 *
 *   • Word (.docx)  — a handout: the default for a lesson you want to read
 *                     through, edit and print.
 *   • PDF           — a worksheet: chosen when the session is quiz-shaped, so
 *                     the questions come out as something to work through on
 *                     paper.
 *   • Slides (.pptx)— a deck: chosen when the lesson has a clear structure to
 *                     present or revise from.
 *
 * The format is chosen from the shape of the session (see `chooseDocFormat`),
 * and the student can always override it.
 */
import type { DocumentAnalysis, KeyPoint } from '../api/ai';
import type { GeneratedDocFormat } from '../types';

// ── The block model ──────────────────────────────────────────────────────────

export type DocBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'numbers'; items: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; text: string; lang: string }
  | { kind: 'diagram'; svg: string; caption: string }
  | { kind: 'callout'; title: string; text: string }
  | { kind: 'divider' };

/** A run of text with its emphasis kept. */
export interface InlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

/** The whole document, before it is rendered into a file. */
export interface TutorDocModel {
  title: string;
  subtitle: string;
  topic: string;
  blocks: DocBlock[];
  /** Small lines under the title (date, source, counts). */
  meta: string[];
  generatedAt: Date;
}

// ── Inline formatting ────────────────────────────────────────────────────────

/**
 * Split a line into runs, keeping **bold**, *italic* and `code`.
 * Used by the Word and PowerPoint writers, which can style a run.
 */
export function parseInline(input: string): InlineRun[] {
  const runs: InlineRun[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    if (match.index > last) {
      runs.push({ text: input.slice(last, match.index) });
    }
    const token = match[0];
    if (token.startsWith('**')) runs.push({ text: token.slice(2, -2), bold: true });
    else if (token.startsWith('`')) runs.push({ text: token.slice(1, -1), code: true });
    else runs.push({ text: token.slice(1, -1), italic: true });
    last = match.index + token.length;
  }
  if (last < input.length) runs.push({ text: input.slice(last) });
  return runs.filter(r => r.text.length > 0);
}

/** The same line with the markers taken out — for the PDF writer. */
export function stripInline(input: string): string {
  return parseInline(input).map(r => r.text).join('');
}

// ── Markdown → blocks ────────────────────────────────────────────────────────

/**
 * Parse the markdown the tutor writes into structured blocks.
 *
 * The tutor writes `##` headings, `-` bullets, markdown tables and fenced
 * ```diagram / ```svg blocks — this parser understands exactly those.
 */
export function parseMarkdownBlocks(md: string): DocBlock[] {
  const blocks: DocBlock[] = [];
  if (!md) return blocks;

  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(' ').trim();
    if (text) blocks.push({ kind: 'paragraph', text });
    paragraph = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    // ── Fenced blocks (code, plain-text diagram, SVG) ───────────────────────
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      flushParagraph();
      const lang = (fence[1] || '').toLowerCase();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // closing fence
      const content = body.join('\n').trim();
      if (!content) continue;
      if (lang === 'svg' || content.startsWith('<svg')) {
        blocks.push({ kind: 'diagram', svg: content, caption: '' });
      } else {
        blocks.push({ kind: 'code', text: content, lang: lang || 'text' });
      }
      continue;
    }

    // ── Headings ───────────────────────────────────────────────────────────
    const heading = line.match(/^\s{0,3}(#{1,3})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      const level = Math.min(3, heading[1].length) as 1 | 2 | 3;
      blocks.push({ kind: 'heading', level, text: heading[2].trim() });
      i++;
      continue;
    }

    // ── Horizontal rule ───────────────────────────────────────────────────
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushParagraph();
      blocks.push({ kind: 'divider' });
      i++;
      continue;
    }

    // ── Table ─────────────────────────────────────────────────────────────
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]*-{2,}[\s:|-]*\|?\s*$/.test(lines[i + 1])) {
      flushParagraph();
      const header = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push({ kind: 'table', header, rows });
      continue;
    }

    // ── Quote ─────────────────────────────────────────────────────────────
    if (/^\s*>\s?/.test(line)) {
      flushParagraph();
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push({ kind: 'quote', text: quote.join(' ').trim() });
      continue;
    }

    // ── Bullet list ───────────────────────────────────────────────────────
    if (/^\s*[-*+]\s+/.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, '').trim());
        i++;
      }
      if (items.length) blocks.push({ kind: 'bullets', items });
      continue;
    }

    // ── Numbered list ─────────────────────────────────────────────────────
    if (/^\s*\d+[.)]\s+/.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '').trim());
        i++;
      }
      if (items.length) blocks.push({ kind: 'numbers', items });
      continue;
    }

    // ── Blank line ends a paragraph ───────────────────────────────────────
    if (!line.trim()) {
      flushParagraph();
      i++;
      continue;
    }

    paragraph.push(line.trim());
    i++;
  }

  flushParagraph();
  return blocks;
}

/** Split a markdown table row into its cells. */
function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(c => c.trim());
}

// ── Building the document model from a tutor session ────────────────────────

export interface TutorTurnInput {
  mode: 'lesson' | 'simpler' | 'deeper' | 'quiz';
  response: string;
  keyPoints?: KeyPoint[];
  analysis?: DocumentAnalysis | null;
}

export interface BuildDocInput {
  topic: string;
  title?: string;
  turns: TutorTurnInput[];
  /** The source the lesson came from — a shared file, a topic, … */
  sourceLabel?: string;
}

/** The label for the mode, used as a small heading in the document. */
const MODE_LABEL: Record<TutorTurnInput['mode'], string> = {
  lesson: 'Lesson',
  simpler: 'In simpler words',
  deeper: 'Going deeper',
  quiz: 'Practice questions',
};

/**
 * Build the document model: the title page material, then the lesson itself.
 */
export function buildTutorDoc(input: BuildDocInput): TutorDocModel {
  const blocks: DocBlock[] = [];
  const topic = input.topic.trim();
  const title = (input.title || `AI Tutor: ${topic}`).trim();

  for (const turn of input.turns) {
    const parsed = parseMarkdownBlocks(turn.response);
    const isFirst = blocks.length === 0;

    if (isFirst) {
      // The first turn opens the document — its own headings are enough.
      blocks.push(...parsed);
    } else {
      blocks.push({ kind: 'heading', level: 2, text: MODE_LABEL[turn.mode] });
      blocks.push(...parsed);
    }

    if (turn.keyPoints?.length) {
      blocks.push({ kind: 'heading', level: 3, text: 'Key points to remember' });
      blocks.push({
        kind: 'callout',
        title: 'Key points',
        text: turn.keyPoints
          .map(p => `${p.point}${p.why ? ` — ${p.why}` : ''}`)
          .join('\n'),
      });
    }

    if (turn.analysis) {
      const a = turn.analysis;
      if (a.outline?.length) {
        blocks.push({ kind: 'heading', level: 3, text: 'Outline' });
        blocks.push({
          kind: 'bullets',
          items: a.outline.map(o => `${o.heading}${o.detail ? ` — ${o.detail}` : ''}`),
        });
      }
      if (a.glossary?.length) {
        blocks.push({ kind: 'heading', level: 3, text: 'Vocabulary' });
        blocks.push({
          kind: 'table',
          header: ['Term', 'Meaning'],
          rows: a.glossary.map(g => [g.term, g.meaning]),
        });
      }
      if (a.questions?.length) {
        blocks.push({ kind: 'heading', level: 3, text: 'Questions to test yourself' });
        blocks.push({ kind: 'numbers', items: a.questions });
      }
    }
  }

  const keyPointCount = input.turns.reduce((n, t) => n + (t.keyPoints?.length ?? 0), 0);
  const questionCount = input.turns.reduce((n, t) => n + (t.analysis?.questions?.length ?? 0), 0);

  const meta: string[] = [
    `Prepared by the StudyWorks AI Tutor`,
    input.sourceLabel ? `Material: ${input.sourceLabel}` : `Topic: ${topic}`,
    `${input.turns.length} section${input.turns.length === 1 ? '' : 's'}`,
  ];
  if (keyPointCount > 0) meta.push(`${keyPointCount} key points`);
  if (questionCount > 0) meta.push(`${questionCount} practice questions`);

  return {
    title,
    subtitle: topic,
    topic,
    blocks,
    meta,
    generatedAt: new Date(),
  };
}

// ── Choosing the format ─────────────────────────────────────────────────────

export interface DocContext {
  /** Which tutor modes the session used. */
  modes: TutorTurnInput['mode'][];
  /** The session was built from an uploaded document. */
  hasBriefing: boolean;
  /** The briefing carried an outline — the material has a clear structure. */
  hasOutline: boolean;
  /** The session produced exam questions. */
  hasQuestions: boolean;
  /** How long the lesson is, in characters. */
  length: number;
  /** How many headings the lesson has — the sign of a structured talk. */
  headingCount: number;
}

/**
 * Pick the format that fits the session.
 *
 *   • A quiz-shaped session becomes a printable worksheet (PDF).
 *   • A short, clearly structured lesson becomes a deck you can present
 *     (PowerPoint).
 *   • Everything else becomes a handout you can edit and print (Word).
 */
export function chooseDocFormat(ctx: DocContext): { format: GeneratedDocFormat; reason: string } {
  const quizTurns = ctx.modes.filter(m => m === 'quiz').length;
  const quizHeavy = quizTurns > 0 && quizTurns >= ctx.modes.length / 2;

  if (quizHeavy || (ctx.hasQuestions && ctx.headingCount <= 2)) {
    return {
      format: 'pdf',
      reason: 'The session is practice-shaped — a printable worksheet fits it best.',
    };
  }

  if (ctx.hasOutline || (ctx.headingCount >= 4 && ctx.length <= 9000)) {
    return {
      format: 'pptx',
      reason: 'The lesson has a clear structure — a slide deck is easier to revise from.',
    };
  }

  return {
    format: 'docx',
    reason: 'A written handout — easy to read, edit and print.',
  };
}

/** Work out the context of a session so the format can be chosen. */
export function describeContext(input: BuildDocInput): DocContext {
  const blocks = input.turns.flatMap(t => parseMarkdownBlocks(t.response));
  const headingCount = blocks.filter(b => b.kind === 'heading').length;
  const length = input.turns.reduce((n, t) => n + t.response.length, 0);
  const analysis = input.turns.find(t => t.analysis)?.analysis;

  return {
    modes: input.turns.map(t => t.mode),
    hasBriefing: input.turns.some(t => Boolean(t.analysis)),
    hasOutline: Boolean(analysis?.outline?.length),
    hasQuestions: Boolean(analysis?.questions?.length),
    length,
    headingCount,
  };
}
