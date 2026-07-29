/**
 * Parses [[Note Title]] wiki-style links in note content and renders them
 * as clickable inline chips that open the referenced note in the editor.
 */

import type { Note } from '../types';

interface RenderLinkedContentProps {
  content:     string;
  notes:       Note[];
  highlights?: { text: string; color: string; id: string }[];
  onLinkClick: (note: Note) => void;
}

/** Split content by [[...]] and highlight patterns, return React nodes */
export function renderLinkedContent({
  content, notes, highlights = [], onLinkClick,
}: RenderLinkedContentProps): React.ReactNode[] {
  // Build a title → note map
  const noteMap = new Map(notes.map(n => [n.title.toLowerCase(), n]));

  // First apply highlights to raw text
  const withHighlights = applyHighlights(content, highlights);

  // Then parse [[links]] inside text nodes
  return withHighlights.flatMap((node, idx) => {
    if (typeof node !== 'string') return [node];
    return parseLinks(node, noteMap, onLinkClick, idx);
  });
}

function applyHighlights(
  text: string,
  highlights: { text: string; color: string; id: string }[]
): React.ReactNode[] {
  if (highlights.length === 0) return [text];
  let remaining = text;
  const parts: React.ReactNode[] = [];
  for (const h of highlights) {
    const idx = remaining.indexOf(h.text);
    if (idx === -1) continue;
    if (idx > 0) parts.push(remaining.slice(0, idx));
    parts.push(
      <mark key={h.id} style={{ background: h.color, borderRadius: '2px', padding: '0 2px' }}>
        {h.text}
      </mark>
    );
    remaining = remaining.slice(idx + h.text.length);
  }
  parts.push(remaining);
  return parts;
}

function parseLinks(
  text: string,
  noteMap: Map<string, Note>,
  onLinkClick: (note: Note) => void,
  baseKey: number
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /\[\[([^\]]+)\]\]/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const linkTitle = match[1];
    const linkedNote = noteMap.get(linkTitle.toLowerCase());
    parts.push(
      <button
        key={`link-${baseKey}-${match.index}`}
        onClick={() => linkedNote && onLinkClick(linkedNote)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '3px',
          padding: '1px 7px',
          borderRadius: '9999px',
          border: `1px solid ${linkedNote ? 'var(--accent)' : 'var(--border)'}`,
          background: linkedNote ? 'var(--accent-soft)' : 'var(--surface-2)',
          color: linkedNote ? 'var(--accent)' : 'var(--text-3)',
          fontWeight: 600,
          fontSize: '0.8em',
          cursor: linkedNote ? 'pointer' : 'default',
          verticalAlign: 'middle',
          lineHeight: 1.4,
        }}
        title={linkedNote ? `Open: ${linkedNote.title}` : `Note "${linkTitle}" not found`}
      >
        🔗 {linkTitle}{!linkedNote && ' (not found)'}
      </button>
    );
    last = regex.lastIndex;
  }

  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
