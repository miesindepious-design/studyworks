/**
 * ExamPlanner — "my biology paper is in 12 days".
 *
 * A deadline is the strongest motivator a student can have, and the app can
 * do the arithmetic: given the cards that belong to the exam's subjects and
 * the number of days left, it works out how many reviews a day are needed to
 * get through them all.
 *
 * Plans live on the server so they follow the student between devices; when
 * nobody is signed in they are kept in localStorage instead.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Flashcard } from '../types';
import { daysBetween, isoDate } from '../game/rules';
import { createExamPlan, deleteExamPlan, listExamPlans, updateExamPlan, type ExamPlan } from '../api/progression';

const LOCAL_KEY = 'sw-exam-plans';

export interface ExamPlannerProps {
  flashcards: Flashcard[];
  authenticated: boolean;
  onToast?: (message: string, type: 'success' | 'error' | 'info') => void;
  /** Awards XP for creating a plan. */
  onPlanCreated?: () => void;
}

function loadLocal(): ExamPlan[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as ExamPlan[]) : [];
  } catch {
    return [];
  }
}

function saveLocal(plans: ExamPlan[]) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(plans));
  } catch {
    /* ignore */
  }
}

export default function ExamPlanner({
  flashcards,
  authenticated,
  onToast,
  onPlanCreated,
}: ExamPlannerProps) {
  const [plans, setPlans] = useState<ExamPlan[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', examDate: '', subjects: '', dailyTarget: '' });

  const load = useCallback(async () => {
    if (authenticated) {
      try {
        const remote = await listExamPlans();
        setPlans(remote);
        saveLocal(remote);
        return;
      } catch {
        /* fall through to the local copy */
      }
    }
    setPlans(loadLocal());
  }, [authenticated]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  /** How many cards belong to the plan's subjects. */
  const cardsForPlan = useCallback(
    (plan: ExamPlan): Flashcard[] => {
      if (!plan.subjects?.length) return flashcards;
      const wanted = plan.subjects.map(s => s.toLowerCase());
      return flashcards.filter(c => {
        const topic = (c.topic ?? '').toLowerCase();
        return wanted.includes(topic) || c.tags?.some(t => wanted.includes(t.toLowerCase()));
      });
    },
    [flashcards],
  );

  /** The number of days left, and the reviews a day that needs. */
  const planStats = useCallback(
    (plan: ExamPlan) => {
      const today = isoDate();
      const daysLeft = Math.max(0, daysBetween(today, isoDate(new Date(plan.examDate))));
      const cards = cardsForPlan(plan);
      const suggested =
        daysLeft > 0 ? Math.max(1, Math.ceil(cards.length / daysLeft)) : cards.length;
      return { daysLeft, cards: cards.length, suggested };
    },
    [cardsForPlan],
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.examDate) {
      onToast?.('Give the exam a name and a date.', 'info');
      return;
    }

    const subjects = form.subjects
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    const payload = {
      title: form.title.trim(),
      examDate: new Date(form.examDate).toISOString(),
      subjects,
      dailyTarget: form.dailyTarget ? Number(form.dailyTarget) : undefined,
    };

    try {
      if (authenticated) {
        const created = await createExamPlan(payload);
        setPlans(prev => [...prev, created]);
        saveLocal([...plans, created]);
      } else {
        const local: ExamPlan = {
          id: `local-${Date.now()}`,
          title: payload.title,
          examDate: payload.examDate,
          subjects,
          dailyTarget: payload.dailyTarget ?? 20,
          notes: null,
          completed: false,
          createdAt: new Date().toISOString(),
        };
        setPlans(prev => [...prev, local]);
        saveLocal([...plans, local]);
      }
      setForm({ title: '', examDate: '', subjects: '', dailyTarget: '' });
      setAdding(false);
      onPlanCreated?.();
      onToast?.('Exam plan created — the countdown starts now.', 'success');
    } catch (err) {
      onToast?.((err as Error).message || 'Could not save the plan', 'error');
    }
  };

  const remove = async (plan: ExamPlan) => {
    try {
      if (authenticated && !plan.id.startsWith('local-')) {
        await deleteExamPlan(plan.id);
      }
      const next = plans.filter(p => p.id !== plan.id);
      setPlans(next);
      saveLocal(next);
    } catch (err) {
      onToast?.((err as Error).message || 'Could not delete the plan', 'error');
    }
  };

  const toggleDone = async (plan: ExamPlan) => {
    const completed = !plan.completed;
    try {
      if (authenticated && !plan.id.startsWith('local-')) {
        await updateExamPlan(plan.id, { completed });
      }
      const next = plans.map(p => (p.id === plan.id ? { ...p, completed } : p));
      setPlans(next);
      saveLocal(next);
    } catch {
      /* keep the local change even if the server call fails */
    }
  };

  const sorted = useMemo(
    () => [...plans].sort((a, b) => new Date(a.examDate).getTime() - new Date(b.examDate).getTime()),
    [plans],
  );

  return (
    <div className="sw-panel">
      <div className="sw-panel-head">
        <div>
          <h3 className="sw-panel-title">🎯 Exam countdown</h3>
          <p className="sw-panel-sub">
            {sorted.length
              ? 'How much has to be done each day to be ready.'
              : 'Add an exam and the app works out your daily target.'}
          </p>
        </div>
        <div className="sw-panel-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => setAdding(v => !v)}>
            {adding ? 'Cancel' : '+ Add exam'}
          </button>
        </div>
      </div>

      {adding && (
        <form onSubmit={submit} style={{ display: 'grid', gap: '0.6rem', marginBottom: '1rem' }}>
          <input
            className="sw-input"
            placeholder="Exam name (e.g. Biology Paper 2)"
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            style={inputStyle}
          />
          <input
            type="date"
            className="sw-input"
            value={form.examDate}
            onChange={e => setForm(f => ({ ...f, examDate: e.target.value }))}
            style={inputStyle}
          />
          <input
            className="sw-input"
            placeholder="Subjects, comma separated (matches card topics)"
            value={form.subjects}
            onChange={e => setForm(f => ({ ...f, subjects: e.target.value }))}
            style={inputStyle}
          />
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="number"
              min={1}
              className="sw-input"
              placeholder="Cards per day (optional)"
              value={form.dailyTarget}
              onChange={e => setForm(f => ({ ...f, dailyTarget: e.target.value }))}
              style={{ ...inputStyle, width: '11rem' }}
            />
            <button type="submit" className="btn btn-primary btn-sm">Save plan</button>
          </div>
        </form>
      )}

      {!loading && !sorted.length && !adding && (
        <div className="sw-empty">
          <div className="sw-empty-icon">🎯</div>
          <p className="sw-empty-title">No exams planned</p>
          <p className="sw-empty-sub">
            Add the next exam on the calendar and see exactly how many cards a day you have to get
            through.
          </p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {sorted.map(plan => {
          const { daysLeft, cards, suggested } = planStats(plan);
          const target = plan.dailyTarget || suggested;
          const urgent = daysLeft > 0 && daysLeft <= 7;

          return (
            <div
              key={plan.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.85rem',
                padding: '0.75rem 0.9rem',
                borderRadius: 'var(--radius-lg)',
                border: `1px solid ${urgent ? 'var(--danger, #f87171)' : 'var(--border)'}`,
                background: 'var(--surface-1)',
                opacity: plan.completed ? 0.6 : 1,
              }}
            >
              <div
                style={{
                  minWidth: '3.25rem',
                  textAlign: 'center',
                  padding: '0.35rem 0.25rem',
                  borderRadius: 'var(--radius-md, 8px)',
                  background: urgent ? 'rgba(248,113,113,.14)' : 'var(--surface-2)',
                }}
              >
                <div style={{ fontSize: '1.15rem', fontWeight: 800, lineHeight: 1.1 }}>
                  {plan.completed ? '✓' : daysLeft}
                </div>
                <div style={{ fontSize: '0.6rem', color: 'var(--text-3)', textTransform: 'uppercase' }}>
                  {plan.completed ? 'done' : 'days'}
                </div>
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.875rem', fontWeight: 650 }}>{plan.title}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-2)', marginTop: '0.15rem' }}>
                  {cards} card{cards === 1 ? '' : 's'}
                  {plan.subjects?.length ? ` · ${plan.subjects.join(', ')}` : ''}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: '0.2rem' }}>
                  {plan.completed
                    ? 'Marked as finished'
                    : `Target: ${target} card${target === 1 ? '' : 's'} a day${
                        plan.dailyTarget ? '' : ` (suggested ${suggested})`
                      }`}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
                <button className="btn btn-ghost btn-xs" onClick={() => toggleDone(plan)}>
                  {plan.completed ? 'Undo' : 'Done'}
                </button>
                <button className="btn btn-ghost btn-xs" onClick={() => remove(plan)} aria-label="Delete plan">
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.55rem 0.7rem',
  borderRadius: 'var(--radius-md, 8px)',
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  fontSize: '0.85rem',
  outline: 'none',
};
