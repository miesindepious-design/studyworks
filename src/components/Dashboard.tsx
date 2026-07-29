import { Note, Contact, Flashcard, Folder, PracticeQuestion } from '../types';
import type { WeeklyInsights } from '../hooks/useAI';
import { useEffect, useState } from 'react';
import { getStreakData, last7Days, EMPTY_STREAK } from '../db/streaks';
import type { StreakData } from '../db/schema';
import { useCountUp } from '../hooks/useCountUp';
import StreakRing from './StreakRing';

type Tier = 'free' | 'pro';

interface DashboardProps {
  notes: Note[];
  contacts: Contact[];
  flashcards: Flashcard[];
  tier: Tier;
  totalItems: number;
  aiSummariesThisMonth: number;
  qaQueriesThisMonth: number;
  folders: Folder[];
  practiceQuestions: PracticeQuestion[];
  setCurrentView: (view: string) => void;
  aiReady: boolean;
  aiProvider: string;
  onGenerateInsights: () => void;
  weeklyInsights: WeeklyInsights | null;
  insightsLoading: boolean;
}

const STATS = (notes: Note[], contacts: Contact[], flashcards: Flashcard[], folders: Folder[], practiceQuestions: PracticeQuestion[]) => [
  { icon: '📝', label: 'Notes',      value: notes.length,           color: 'indigo'  },
  { icon: '👥', label: 'People',     value: contacts.length,        color: 'violet'  },
  { icon: '💡', label: 'Flashcards', value: flashcards.length,      color: 'amber'   },
  { icon: '📁', label: 'Folders',    value: folders.length,         color: 'emerald' },
  { icon: '❓', label: 'Practice Qs',value: practiceQuestions.length, color: 'rose'  },
];

export default function Dashboard({ notes, contacts, flashcards, tier, totalItems, aiSummariesThisMonth, folders, practiceQuestions, setCurrentView, aiReady, aiProvider, onGenerateInsights, weeklyInsights, insightsLoading }: DashboardProps) {
  const stats = STATS(notes, contacts, flashcards, folders, practiceQuestions);
  const recentNotes = [...notes].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 3);
  const overdueContacts = contacts.filter(c => c.nextReminder && new Date(c.nextReminder) < new Date()).length;
  const dueFlashcards   = flashcards.filter(c => !c.nextReview || new Date(c.nextReview) <= new Date()).length;

  // Streak data — refreshed on mount and whenever the window regains focus
  // (so finishing a review and switching back to the dashboard shows the
  // updated count without a manual reload).
  const [streak, setStreak] = useState<StreakData>(EMPTY_STREAK);
  useEffect(() => {
    let alive = true;
    const reload = () => { getStreakData().then(s => { if (alive) setStreak(s); }); };
    reload();
    window.addEventListener('focus', reload);
    return () => { alive = false; window.removeEventListener('focus', reload); };
  }, [dueFlashcards]); // re-fetch when due count changes (proxy for "user just reviewed")

  return (
    <div className="animate-in">
      {/* Hero */}
      <div className="dash-hero">
        <div>
          <h2 className="dash-hero-title">Welcome back 👋</h2>
          <p className="text-muted" style={{ marginTop: '0.35rem', fontSize: '0.9375rem' }}>
            Here's what's happening in your study workspace
          </p>
        </div>
        {tier === 'free' && (
          <button className="btn btn-primary" onClick={() => setCurrentView('pricing')}>
            💎 Upgrade to Pro
          </button>
        )}
      </div>

      {/* Streak widget — current streak, today's reviews, last-7-day bar chart */}
      <StreakWidget streak={streak} dueFlashcards={dueFlashcards} setCurrentView={setCurrentView} />

      {/* Stats grid — animated count-up */}
      <div className="grid-stats stagger">
        {stats.map(s => <StatCard key={s.label} {...s} />)}
      </div>

      {/* Alert row — AI, overdue contacts, due flashcards */}
      {(!aiReady || overdueContacts > 0 || dueFlashcards > 0) && (
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
          {!aiReady && (
            <button
              className="card"
              onClick={() => setCurrentView('settings')}
              style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.875rem 1.125rem', cursor: 'pointer', border: '1px dashed var(--accent)', background: 'var(--accent-soft)', flex: '1 1 220px', textAlign: 'left' }}
            >
              <span style={{ fontSize: '1.5rem' }}>🤖</span>
              <div>
                <p style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--accent)' }}>Set up AI</p>
                <p className="text-xs text-muted">Gemini is free — enable AI summaries, flashcards &amp; Q&A</p>
              </div>
              <span style={{ marginLeft: 'auto', color: 'var(--accent)' }}>→</span>
            </button>
          )}
          {aiReady && (
            <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.875rem 1.125rem', flex: '1 1 220px', background: 'var(--success-soft)', border: '1px solid rgb(52 211 153 / .3)' }}>
              <span style={{ fontSize: '1.5rem' }}>🤖</span>
              <div>
                <p style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--success)' }}>AI active</p>
                <p className="text-xs text-muted">{aiProvider === 'gemini' ? 'Gemini' : 'OpenAI'} connected</p>
              </div>
            </div>
          )}
          {overdueContacts > 0 && (
            <button
              className="card"
              onClick={() => setCurrentView('contacts')}
              style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.875rem 1.125rem', cursor: 'pointer', background: 'var(--danger-soft)', border: '1px solid rgb(251 113 133 / .3)', flex: '1 1 220px', textAlign: 'left' }}
            >
              <span style={{ fontSize: '1.5rem' }}>👥</span>
              <div>
                <p style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--danger)' }}>{overdueContacts} overdue reminder{overdueContacts > 1 ? 's' : ''}</p>
                <p className="text-xs text-muted">People you need to follow up with</p>
              </div>
              <span style={{ marginLeft: 'auto', color: 'var(--danger)' }}>→</span>
            </button>
          )}
          {dueFlashcards > 0 && (
            <button
              className="card"
              onClick={() => setCurrentView('flashcards')}
              style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.875rem 1.125rem', cursor: 'pointer', background: 'var(--warning-soft)', border: '1px solid rgb(251 191 36 / .3)', flex: '1 1 220px', textAlign: 'left' }}
            >
              <span style={{ fontSize: '1.5rem' }}>💡</span>
              <div>
                <p style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--warning)' }}>{dueFlashcards} card{dueFlashcards > 1 ? 's' : ''} due for review</p>
                <p className="text-xs text-muted">Start your spaced repetition session</p>
              </div>
              <span style={{ marginLeft: 'auto', color: 'var(--warning)' }}>→</span>
            </button>
          )}
        </div>
      )}

      {/* Free plan usage + Pro upgrade */}
      {tier === 'free' && (
        <div className="pro-banner" style={{ marginBottom: '1.75rem' }}>
          <span className="pro-banner-icon">💎</span>
          <div className="pro-banner-text">
            <p>Unlock Pro Features</p>
            <p>You've used {totalItems}/50 items · {aiSummariesThisMonth}/20 AI summaries this month</p>
          </div>
          <ul style={{ listStyle: 'none', fontSize: '0.8125rem', color: 'var(--text-2)', display: 'flex', flexWrap: 'wrap', gap: '0.375rem 1rem' }}>
            <li>✅ Unlimited items</li>
            <li>✅ Unlimited AI</li>
            <li>✅ File uploads</li>
            <li>✅ Spaced repetition</li>
            <li>✅ Smart Q&A</li>
          </ul>
          <button className="btn btn-primary" onClick={() => setCurrentView('pricing')}>See plans</button>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
        {/* Recent notes */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">📝 Recent Notes</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setCurrentView('notes')}>View all →</button>
          </div>
          {recentNotes.length === 0 ? (
            <div className="empty-state" style={{ padding: '1.5rem' }}>
              <div className="empty-state-icon">📝</div>
              <h3>No notes yet</h3>
              <p>Start capturing your knowledge</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {recentNotes.map(n => (
                <div key={n.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', padding: '0.75rem', background: 'var(--surface-2)', borderRadius: 'var(--radius)' }}>
                  <span style={{ fontSize: '1.1rem' }}>{n.type === 'article' ? '📰' : n.type === 'idea' ? '💡' : n.type === 'project' ? '🗂️' : '📄'}</span>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontWeight: 600, fontSize: '0.875rem' }} className="truncate">{n.title}</p>
                    <p className="text-xs text-muted" style={{ marginTop: '0.125rem' }}>{new Date(n.updatedAt).toLocaleDateString()}</p>
                  </div>
                  <span className="tag" style={{ marginLeft: 'auto', flexShrink: 0 }}>{n.type}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Weekly AI Insights */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">🧠 Weekly Insights</span>
            {aiReady && (
              <button className="btn btn-ghost btn-sm" onClick={onGenerateInsights} disabled={insightsLoading}>
                {insightsLoading ? '⏳ Generating…' : '↺ Generate'}
              </button>
            )}
          </div>
          {!aiReady ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <p className="text-sm text-muted">Connect an AI provider in Settings to get personalised weekly study insights.</p>
              <button className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setCurrentView('settings')}>Set up AI →</button>
            </div>
          ) : !weeklyInsights ? (
            <div className="empty-state" style={{ padding: '1.5rem' }}>
              <div className="empty-state-icon">🧠</div>
              <h3>No insights yet</h3>
              <p>Click Generate to get your weekly study digest</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {/* Summary */}
              <div style={{ display: 'flex', gap: '0.625rem', padding: '0.75rem', background: 'var(--surface-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>📊</span>
                <p className="text-sm">{weeklyInsights.summary}</p>
              </div>
              {/* Top topics */}
              {weeklyInsights.topTopics.length > 0 && (
                <div style={{ display: 'flex', gap: '0.625rem', padding: '0.75rem', background: 'var(--surface-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>🏷️</span>
                  <p className="text-sm font-bold" style={{ marginRight: '0.25rem' }}>Top topics:</p>
                  {weeklyInsights.topTopics.map(t => <span key={t} className="tag primary">{t}</span>)}
                </div>
              )}
              {/* Suggested focus */}
              <div style={{ display: 'flex', gap: '0.625rem', padding: '0.75rem', background: 'var(--surface-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>💡</span>
                <div>
                  <p style={{ fontWeight: 700, fontSize: '0.875rem', marginBottom: '0.2rem' }}>Focus this week</p>
                  <p className="text-sm text-muted">{weeklyInsights.suggestedFocus}</p>
                </div>
              </div>
              {/* Review reminder */}
              <div style={{ display: 'flex', gap: '0.625rem', padding: '0.75rem', background: 'var(--surface-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>📚</span>
                <div>
                  <p style={{ fontWeight: 700, fontSize: '0.875rem', marginBottom: '0.2rem' }}>Review reminder</p>
                  <p className="text-sm text-muted">{weeklyInsights.reviewReminder}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Quick tips */}
        <div className="card">
          <div className="card-header"><span className="card-title">🚀 Quick Tips</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {[
              ['📝', 'Write [[Note Title]] in any note to link to another note'],
              ['⚡', 'Create smart folders with rules like "tag:exam" or "type:article"'],
              ['🔗', 'Related notes auto-detected by shared tags (Pro)'],
              ['🧠', 'Use Spaced Review to study due cards daily (Pro)'],
              ['⏰', 'Set revisit reminders on notes with the ⏰ button'],
            ].map(([icon, tip]) => (
              <div key={tip} style={{ display: 'flex', gap: '0.625rem', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '1rem', marginTop: '0.1rem' }}>{icon}</span>
                <p className="text-sm text-muted">{tip}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── StatCard ───────────────────────────────────────────────────────────────
// Small card with an animated count-up value.
function StatCard({ icon, label, value, color }: { icon: string; label: string; value: number; color: string }) {
  const animated = useCountUp(value);
  return (
    <div className="stat-card">
      <div className={`stat-icon ${color}`}>{icon}</div>
      <div>
        <div className="stat-value">{animated}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

// ── StreakWidget ──────────────────────────────────────────────────────────────
// Self-contained card showing the current daily streak, today's review
// count, and a tiny bar chart of the last 7 days. Reads from the
// `streaks` IDB store (populated by `recordReview` whenever the user
// rates a card in any of the three study modes).
function StreakWidget({ streak, dueFlashcards, setCurrentView }: { streak: StreakData; dueFlashcards: number; setCurrentView: (v: string) => void }) {
  const days = last7Days(streak);
  const todayCount = days[6] ?? 0;
  const maxDay = Math.max(...days, 1);

  // Day labels (M, T, W, T, F, S, S) for the bar chart x-axis.
  const dayLabel = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - offset));
    return 'SMTWTFS'[d.getDay()];
  };

  // Streak "fire" intensity: 1 = bronze, 2 = silver, 3+ = gold. Drives the
  // colour of the streak number.
  const tier = streak.currentStreak >= 30 ? 'gold' : streak.currentStreak >= 7 ? 'silver' : streak.currentStreak >= 1 ? 'bronze' : 'none';
  const tierColor = tier === 'gold' ? '#f59e0b' : tier === 'silver' ? '#94a3b8' : tier === 'bronze' ? '#ea580c' : 'var(--muted)';
  const tierEmoji = tier === 'gold' ? '🏆' : tier === 'silver' ? '⚡' : tier === 'bronze' ? '🔥' : '💤';

  return (
    <div className="card" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
      {/* Streak ring — the headline */}
      <StreakRing
        value={streak.currentStreak}
        progress={Math.min(1, streak.currentStreak / 30)}
        emoji={tierEmoji}
        color={tierColor}
      />
      <div style={{ minWidth: 150 }}>
        <div className="text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
          Day streak
        </div>
        <div className="text-sm" style={{ marginTop: '0.15rem' }}>
          {streak.currentStreak === 0
            ? 'Start one today 💤'
            : <>best <span style={{ fontWeight: 700, color: 'var(--text)' }}>{streak.longestStreak}</span></>}
        </div>
      </div>

      {/* Today's review count + CTA */}
      <div style={{ flex: 1, minWidth: 200 }}>
        <div className="text-sm" style={{ marginBottom: '0.5rem' }}>
          <span style={{ fontWeight: 700 }}>{todayCount}</span>
          <span className="text-muted"> review{todayCount === 1 ? '' : 's'} today</span>
          {dueFlashcards > 0 && (
            <>
              <span className="text-muted"> · </span>
              <span style={{ color: 'var(--danger)', fontWeight: 600 }}>{dueFlashcards} due now</span>
            </>
          )}
        </div>
        {/* Bar chart — last 7 days, oldest on the left. */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.375rem', height: 40 }}>
          {days.map((count, i) => (
            <div key={i} title={`${count} review${count === 1 ? '' : 's'}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
              <div style={{
                width: '100%',
                height: `${Math.max(4, (count / maxDay) * 36)}px`,
                background: i === 6 ? 'var(--accent)' : (count > 0 ? 'var(--accent-soft)' : 'var(--surface-2)'),
                borderRadius: 4,
                transition: 'height 200ms ease',
              }} />
              <div className="text-xs text-muted" style={{ fontSize: '0.625rem' }}>{dayLabel(i)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA: jump to study */}
      {dueFlashcards > 0 && (
        <button className="btn btn-primary" onClick={() => setCurrentView('flashcards')}>
          Start review →
        </button>
      )}
    </div>
  );
}
