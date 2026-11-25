/**
 * NoteRecallView — reviewing your notes by recalling them.
 *
 * A note is not a flashcard: it has no single question and no short answer.
 * The student's job is to recall the note from its title, so this screen
 * works in four beats:
 *
 *   1. The title and a short cue are shown. The note itself is hidden.
 *   2. The student thinks, and optionally writes what they remember.
 *   3. They reveal the note and compare it with what they recalled.
 *   4. They rate their recall, which schedules the note on the SM-2 curve.
 *
 * The rating scale is the same one the cards use, so a note that keeps
 * slipping comes back sooner — and long notes are rated more gently,
 * because recalling a long note is genuinely harder than recalling a short
 * one (see `utils/noteSrs`).
 *
 * Everything about the scheduling lives in the pure module; this file is the
 * screen around it.
 */
import { useMemo, useState } from 'react';
import type { Note } from '../types';
import {
  buildCue,
  scheduleNote,
  notePlainText,
  noteDifficultyReason,
  isNoteLeech,
  type NoteRecallQuality,
} from '../utils/noteSrs';
import { isDue } from '../utils/sm2';
import { useProgression } from '../game/ProgressionContext';
import { recordReview } from '../db/streaks';
import { IconArrowRight, IconNotes, IconTarget } from './icons';

interface Props {
  notes: Note[];
  setNotes: (notes: Note[]) => void;
  /** Leave the review. */
  onExit: () => void;
  /** Open a note in the notes library. */
  onOpenNote?: (noteId: string) => void;
}

/** The four ratings, in the order the cards use them. */
const RATINGS: { quality: NoteRecallQuality; label: string; emoji: string; hint: string; color: string }[] = [
  { quality: 0, label: 'Again',  emoji: '🔴', hint: 'Could not recall it',        color: '#f87171' },
  { quality: 1, label: 'Hard',   emoji: '🟠', hint: 'Barely recalled it',        color: '#fbbf24' },
  { quality: 2, label: 'Good',   emoji: '🟢', hint: 'Recalled it',               color: '#34d399' },
  { quality: 3, label: 'Easy',   emoji: '🔵', hint: 'Instantly recalled it',     color: '#60a5fa' },
];

/**
 * The notes worth reviewing: those the SM-2 scheduler says are due, most
 * urgent first. A note that has never been reviewed is not due — a student
 * has not had the chance to learn it yet — so it only enters the queue once
 * it has been reviewed at least once, or once the student asks for new
 * material.
 */
export function recallableNotes(notes: Note[], now = new Date()): Note[] {
  return notes
    .filter(n => n.repetitions !== undefined || n.nextReview !== undefined)
    .filter(n => isDue({ repetitions: n.repetitions, interval: n.interval, ef: n.ef, nextReview: n.nextReview }, now))
    .sort((a, b) => {
      const aDue = a.nextReview ? new Date(a.nextReview).getTime() : 0;
      const bDue = b.nextReview ? new Date(b.nextReview).getTime() : 0;
      return aDue - bDue;
    });
}

export default function NoteRecallView({ notes, setNotes, onExit, onOpenNote }: Props) {
  const { award } = useProgression();

  const [queue, setQueue]       = useState<Note[]>(() => recallableNotes(notes));
  const [index, setIndex]       = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [recalled, setRecalled] = useState('');
  const [done, setDone]         = useState(false);
  const [results, setResults]   = useState<Record<NoteRecallQuality, number>>({ 0: 0, 1: 0, 2: 0, 3: 0 });

  const current = queue[index];

  /** Notes never reviewed yet — offered as a separate "new material" batch. */
  const newNotes = useMemo(
    () => notes.filter(n => n.repetitions === undefined && n.nextReview === undefined && n.reviewHistory === undefined),
    [notes],
  );

  const rate = (quality: NoteRecallQuality) => {
    if (!current) return;
    const next = scheduleNote(current, quality, new Date());

    setNotes(notes.map(n => (n.id === current.id ? { ...n, ...next } : n)));
    setResults(prev => ({ ...prev, [quality]: prev[quality] + 1 }));

    // A recalled note counts towards the streak, the same as a card.
    recordReview().catch(() => {});
    award('note_reviewed');

    setRevealed(false);
    setRecalled('');
    if (index + 1 >= queue.length) setDone(true);
    else setIndex(index + 1);
  };

  /** Add a batch of never-reviewed notes to the queue and start them. */
  const startNewMaterial = (limit = 10) => {
    const batch = newNotes.slice(0, limit);
    if (batch.length === 0) return;
    setQueue(batch);
    setIndex(0);
    setRevealed(false);
    setRecalled('');
    setDone(false);
    setResults({ 0: 0, 1: 0, 2: 0, 3: 0 });
  };

  // ── Empty state ────────────────────────────────────────────────────────────
  if (queue.length === 0 && newNotes.length === 0) {
    return (
      <div className="sw-panel">
        <div className="sw-empty">
          <div className="sw-empty-icon"><IconNotes size={20} /></div>
          <p className="sw-empty-title">Nothing to recall</p>
          <p className="sw-empty-sub">
            Notes come back on their own once you have reviewed them. Write a note and come back
            later — it will resurface as you forget it.
          </p>
        </div>
        <button className="btn btn-secondary" onClick={onExit}>Back</button>
      </div>
    );
  }

  // ── Done ───────────────────────────────────────────────────────────────────
  if (done) {
    const total = results[0] + results[1] + results[2] + results[3];
    const good = results[2] + results[3];
    return (
      <div className="sw-panel">
        <div className="sw-panel-head">
          <div>
            <h3 className="sw-panel-title">Recall complete</h3>
            <p className="sw-panel-sub">
              {total} note{total === 1 ? '' : 's'} recalled
              {total > 0 && ` · ${Math.round((good / total) * 100)}% recalled well`}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          {RATINGS.map(r => (
            <span key={r.quality} className="sw-chip" style={{ color: r.color }}>
              {r.emoji} {r.label} {results[r.quality]}
            </span>
          ))}
        </div>
        {newNotes.length > 0 && (
          <button className="btn btn-primary" onClick={() => startNewMaterial()}>
            Review {Math.min(10, newNotes.length)} new note{newNotes.length === 1 ? '' : 's'} <IconArrowRight size={14} />
          </button>
        )}
        <button className="btn btn-secondary" onClick={onExit} style={{ marginLeft: '0.5rem' }}>Back</button>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="sw-panel">
        <p className="text-sm text-muted">Loading…</p>
      </div>
    );
  }

  const cue = buildCue(current);
  const difficulty = noteDifficultyReason(current);
  const body = notePlainText(current);

  return (
    <div className="sw-stack animate-in">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <span className="sw-label">Study</span>
          <h2>Recall notes</h2>
          <p className="text-sm text-muted">
            {index + 1} of {queue.length} · recall the note, then rate how it went
          </p>
        </div>
        <button className="btn btn-secondary" onClick={onExit}>✕ Exit</button>
      </div>

      {/* ── The note ───────────────────────────────────────────────────── */}
      <div className="sw-panel">
        <div className="sw-panel-head">
          <div>
            <h3 className="sw-panel-title">{current.title}</h3>
            {current.tags.length > 0 && (
              <p className="sw-panel-sub">{current.tags.join(' · ')}</p>
            )}
          </div>
          {current.folderId && (
            <div className="sw-panel-actions">
              <span className="sw-chip">{current.folderId}</span>
            </div>
          )}
        </div>

        {isNoteLeech(current) && (
          <p className="sw-chip danger" style={{ marginBottom: '0.75rem' }}>
            🩹 This note keeps slipping
          </p>
        )}

        {/* The cue — a hint, not the answer. */}
        {!revealed && (
          <div style={{ marginBottom: '1rem' }}>
            <p className="sw-label" style={{ marginBottom: '0.35rem' }}>What do you remember?</p>
            {cue
              ? <p style={{ fontSize: '0.95rem', color: 'var(--text-2)', lineHeight: 1.6 }}>{cue}</p>
              : <p className="text-sm text-muted">No summary — recall whatever you can from the title.</p>}
          </div>
        )}

        {/* The student's own attempt. Optional, but writing it down is the
            whole point of active recall. */}
        {!revealed && (
          <div style={{ marginBottom: '1rem' }}>
            <textarea
              className="textarea"
              value={recalled}
              onChange={e => setRecalled(e.target.value)}
              placeholder="Write what you remember, then reveal the note…"
              rows={4}
              style={{ width: '100%', resize: 'vertical' }}
              aria-label="What you remember"
            />
          </div>
        )}

        {revealed && (
          <div
            style={{
              padding: '0.9rem 1rem',
              borderRadius: 'var(--radius)',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              marginBottom: '1rem',
            }}
          >
            <p className="sw-label" style={{ marginBottom: '0.35rem' }}>The note</p>
            <p style={{ fontSize: '0.9rem', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
              {body || current.content}
            </p>
            {recalled.trim() && (
              <>
                <p className="sw-label" style={{ margin: '0.9rem 0 0.35rem' }}>What you wrote</p>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>
                  {recalled}
                </p>
              </>
            )}
          </div>
        )}

        {difficulty && !revealed && (
          <p className="text-xs text-muted" style={{ marginBottom: '0.9rem' }}>💡 {difficulty}</p>
        )}

        {/* ── Actions ─────────────────────────────────────────────────── */}
        {!revealed ? (
          <button className="btn btn-primary" onClick={() => setRevealed(true)} style={{ width: '100%' }}>
            Reveal the note
          </button>
        ) : (
          <>
            <p className="sw-label" style={{ marginBottom: '0.5rem' }}>How well did you recall it?</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.5rem' }}>
              {RATINGS.map(r => (
                <button
                  key={r.quality}
                  className="btn"
                  onClick={() => rate(r.quality)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '0.15rem',
                    padding: '0.6rem 0.4rem',
                    borderColor: r.color,
                    color: r.color,
                  }}
                  title={r.hint}
                >
                  <span style={{ fontSize: '1rem' }}>{r.emoji}</span>
                  <span style={{ fontWeight: 700, fontSize: '0.8rem' }}>{r.label}</span>
                  <span style={{ fontSize: '0.65rem', opacity: 0.8 }}>{r.hint}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {onOpenNote && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => onOpenNote(current.id)}
            style={{ marginTop: '0.9rem' }}
          >
            Open in notes <IconArrowRight size={13} />
          </button>
        )}
      </div>

      {/* ── Session summary ───────────────────────────────────────────── */}
      <div className="sw-panel">
        <div className="sw-panel-head">
          <div>
            <h3 className="sw-panel-title">This session</h3>
            <p className="sw-panel-sub">
              {results[0] + results[1] + results[2] + results[3]} recalled
            </p>
          </div>
          <div className="sw-panel-actions">
            {newNotes.length > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={() => startNewMaterial()}>
                <IconTarget size={13} /> {newNotes.length} new
              </button>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {RATINGS.map(r => (
            <span key={r.quality} className="sw-chip" style={{ color: r.color }}>
              {r.emoji} {r.label} {results[r.quality]}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
