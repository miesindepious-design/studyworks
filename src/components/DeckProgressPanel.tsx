/**
 * DeckProgressPanel — how far through each deck the student is.
 *
 * The Mastery Map answers "which subject do I know". This answers "how far
 * through my Biology deck am I, and how much is waiting". A student with
 * three decks wants to see which one is behind before deciding where to
 * spend the evening.
 *
 * Each row shows a progress bar, the mastered count, and what is due now.
 * Clicking a deck filters the flashcard view to it.
 */
import { useMemo } from 'react';
import type { Flashcard, Folder } from '../types';
import { computeDeckProgress, deckSummary, overallProgress } from '../utils/deckProgress';
import { IconArrowRight } from './icons';

interface Props {
  flashcards: Flashcard[];
  folders: Folder[];
  /** The deck currently being filtered by, if any. */
  selectedFolder?: string;
  /** Filter the flashcard view to a deck. */
  onSelectFolder?: (folderId: string) => void;
}

function barColour(pct: number): string {
  if (pct >= 75) return 'var(--success, #34d399)';
  if (pct >= 45) return 'var(--accent)';
  if (pct >= 20) return 'var(--warning, #fbbf24)';
  return 'var(--danger, #f87171)';
}

export default function DeckProgressPanel({
  flashcards,
  folders,
  selectedFolder,
  onSelectFolder,
}: Props) {
  const decks = useMemo(
    () => computeDeckProgress(flashcards, folders, new Date()),
    [flashcards, folders],
  );

  const overall = useMemo(() => overallProgress(decks), [decks]);

  if (decks.length === 0) {
    return (
      <div className="sw-panel">
        <div className="sw-panel-head">
          <h3 className="sw-panel-title">🗂️ Decks</h3>
        </div>
        <div className="sw-empty">
          <div className="sw-empty-icon">🗂️</div>
          <p className="sw-empty-title">No decks yet</p>
          <p className="sw-empty-sub">
            Put cards into a folder and this shows how far through each deck you are.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="sw-panel">
      <div className="sw-panel-head">
        <div>
          <h3 className="sw-panel-title">🗂️ Decks</h3>
          <p className="sw-panel-sub">
            {overall}% overall · {decks.reduce((s, d) => s + d.due, 0)} due across {decks.length} deck{decks.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
        {decks.map(deck => {
          const isSelected = selectedFolder === deck.folderId;
          const pct = deck.progress;
          return (
            <button
              key={deck.folderId}
              onClick={() => onSelectFolder?.(deck.folderId)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: isSelected ? 'var(--surface-2)' : 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: '0.6rem 0.7rem',
                cursor: onSelectFolder ? 'pointer' : 'default',
              }}
              aria-label={`${deck.name}: ${deckSummary(deck)}`}
            >
              <span style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.35rem' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{deck.name}</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>
                  {deckSummary(deck)}
                </span>
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    color: barColour(pct),
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {pct}%
                </span>
                {onSelectFolder && <IconArrowRight size={13} />}
              </span>

              <span
                style={{
                  display: 'block',
                  height: '6px',
                  borderRadius: 'var(--r-full, 999px)',
                  background: 'var(--surface-3)',
                  overflow: 'hidden',
                }}
              >
                <span
                  style={{
                    display: 'block',
                    height: '100%',
                    width: `${pct}%`,
                    background: barColour(pct),
                    transition: 'width .4s ease',
                  }}
                />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
