/**
 * Copilot — the in-app guide.
 *
 * Answers two kinds of question without leaving the page:
 *   "Where do I find X?" → the article says which page it lives on and
 *                          carries a deep link that navigates you there.
 *   "How do I do X?"      → the same article with numbered steps, plus a
 *                          task the Copilot can run for you.
 *
 * The knowledge base is static and local (src/config/copilot.ts), so this
 * works for every plan, with no AI provider and no network round-trip.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { View } from '../config/nav';
import { NAV_ITEMS } from '../config/nav';
import {
  COPILOT_SUGGESTIONS,
  COPILOT_TASKS,
  matchCopilot,
  type CopilotActionId,
  type CopilotArticle,
} from '../config/copilot';
import { IconArrowRight, IconChevronRight, IconSearch, IconSparkles } from './icons';

interface Props {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  currentView: View;
  onNavigate: (view: View) => void;
  onAction: (action: CopilotActionId) => void;
}

/** Human label for a view, taken from the nav model so it never drifts. */
function viewLabel(view: View): string {
  return NAV_ITEMS.find(i => i.view === view)?.label ?? view;
}

/** The button label for an article's call to action. */
function ctaFor(article: CopilotArticle): string {
  if (article.cta) return article.cta;
  if (article.action) {
    const task = COPILOT_TASKS.find(t => t.id === article.action);
    if (task) return task.label;
  }
  if (article.view) return `Go to ${viewLabel(article.view)}`;
  return 'Open';
}

export default function Copilot({
  open, onOpen, onClose, currentView, onNavigate, onAction,
}: Props) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => matchCopilot(query), [query]);

  // Reset and focus whenever the panel opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  /** Navigate, run a task, or both — then get out of the way. */
  const run = useCallback((article: CopilotArticle) => {
    if (article.view) onNavigate(article.view);
    if (article.action) onAction(article.action);
    onClose();
  }, [onNavigate, onAction, onClose]);

  // Escape closes; Enter runs the best match.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'Enter') {
        const top = matches[0];
        if (top) { e.preventDefault(); run(top.article); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, matches, run, onClose]);

  const hasQuery = query.trim().length > 0;

  return (
    <>
      {/* Launcher */}
      <button
        type="button"
        className="sw-copilot-fab"
        onClick={open ? onClose : onOpen}
        aria-label={open ? 'Close the StudyWorks Copilot' : 'Open the StudyWorks Copilot'}
        title="Ask the Copilot"
      >
        <span className="sw-copilot-fab-ring" aria-hidden="true" />
        <IconSparkles size={18} />
        <span className="sw-copilot-fab-label">Ask</span>
      </button>

      {open && (
        <>
          <div className="sw-copilot-scrim" onMouseDown={onClose} />
          <section
            className="sw-copilot-panel"
            role="dialog"
            aria-label="StudyWorks Copilot"
            onMouseDown={e => e.stopPropagation()}
          >
            <header className="sw-copilot-head">
              <span className="sw-copilot-mark"><IconSparkles size={15} /></span>
              <div className="sw-copilot-head-text">
                <p className="sw-copilot-title">Copilot</p>
                <p className="sw-copilot-sub">Find a feature, or get a task done</p>
              </div>
              <button type="button" className="sw-icon-btn" onClick={onClose} aria-label="Close Copilot">
                <IconChevronRight size={16} />
              </button>
            </header>

            <div className="sw-copilot-search">
              <IconSearch size={15} />
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Where do I find…?"
                aria-label="Search for a feature"
              />
              {hasQuery && (
                <button
                  type="button"
                  className="sw-copilot-clear"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="sw-copilot-body">
              {!hasQuery && (
                <>
                  <p className="sw-copilot-section">Quick tasks</p>
                  <div className="sw-copilot-tasks">
                    {COPILOT_TASKS.map(t => (
                      <button
                        key={t.id}
                        type="button"
                        className="sw-copilot-task"
                        onClick={() => { onAction(t.id); onClose(); }}
                      >
                        <span className="sw-copilot-task-label">{t.label}</span>
                        <span className="sw-copilot-task-hint">{t.hint}</span>
                      </button>
                    ))}
                  </div>

                  <p className="sw-copilot-section">Popular questions</p>
                  <div className="sw-copilot-suggestions">
                    {COPILOT_SUGGESTIONS.map(s => (
                      <button
                        key={s}
                        type="button"
                        className="sw-copilot-suggestion"
                        onClick={() => setQuery(s)}
                      >
                        <IconChevronRight size={14} />
                        <span>{s}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {hasQuery && matches.length === 0 && (
                <div className="sw-copilot-empty">
                  <p className="sw-copilot-empty-title">No match for “{query.trim()}”</p>
                  <p className="sw-copilot-empty-body">
                    Try a simpler word — “timer”, “backup”, “notifications”, “support” — or
                    browse everything the Copilot knows about.
                  </p>
                  <button
                    type="button"
                    className="sw-btn secondary sm"
                    onClick={() => { setQuery(''); onNavigate('settings'); onClose(); }}
                  >
                    Open Settings
                  </button>
                </div>
              )}

              {hasQuery && matches.length > 0 && (
                <div className="sw-copilot-results">
                  {matches.map(({ article }) => (
                    <article key={article.id} className="sw-copilot-card">
                      <div className="sw-copilot-card-head">
                        <h4 className="sw-copilot-card-title">{article.title}</h4>
                        <span className="sw-chip">{article.category}</span>
                      </div>
                      <p className="sw-copilot-summary">{article.summary}</p>
                      {article.steps && article.steps.length > 0 && (
                        <ol className="sw-copilot-steps">
                          {article.steps.map(s => <li key={s}>{s}</li>)}
                        </ol>
                      )}
                      <div className="sw-copilot-card-foot">
                        <button type="button" className="sw-btn primary sm" onClick={() => run(article)}>
                          {ctaFor(article)} <IconArrowRight size={14} />
                        </button>
                        {article.view && (
                          <span className="sw-copilot-where">
                            in {viewLabel(article.view)}
                            {article.view === currentView ? ' — you\'re there' : ''}
                          </span>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}
