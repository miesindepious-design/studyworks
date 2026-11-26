/**
 * GradesView — where the student stands, and what they have to do about it.
 *
 * The number on screen is not an average of averages. Every assignment
 * carries the share of the course grade it is worth, so a 90% on a 1% quiz
 * does not look the same as a 90% on a 99% final. That maths lives in
 * `src/utils/grades.ts` and is pure, so it is testable and instant.
 *
 * Three things the student asks, in this order:
 *
 *   - where am I now?                     → the big number
 *   - what do I need on the rest?         → "you need 74% across the rest"
 *   - where do I land if I score X?       → the what-if slider
 *
 * Assignments live on the server so they follow the student between
 * devices; when nobody is signed in they are kept in localStorage.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createAssignment,
  deleteAssignment,
  listAssignments,
  updateAssignment,
  type GradeAssignmentDTO,
} from '../api/grades';
import {
  daysUntil,
  groupByCourse,
  letterGrade,
  projectGrade,
  requiredAverage,
  sortAssignments,
  summarise,
  type GradeAssignment,
} from '../utils/grades';

const LOCAL_KEY = 'sw-assignments';

const CATEGORIES = ['Homework', 'Quiz', 'Exam', 'Project', 'Lab', 'Presentation'];

export interface GradesViewProps {
  authenticated: boolean;
  addToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}

const EMPTY_FORM = {
  title: '',
  course: '',
  category: 'Homework',
  weight: '',
  score: '',
  maxScore: '100',
  dueDate: '',
};

function toAssignment(dto: GradeAssignmentDTO): GradeAssignment {
  return {
    id: dto.id,
    title: dto.title,
    course: dto.course,
    category: dto.category,
    weight: dto.weight,
    score: dto.score,
    maxScore: dto.maxScore,
    dueDate: dto.dueDate ?? null,
    notes: dto.notes ?? null,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}

function loadLocal(): GradeAssignmentDTO[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as GradeAssignmentDTO[]) : [];
  } catch {
    return [];
  }
}

function saveLocal(items: GradeAssignmentDTO[]) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(items));
  } catch {
    /* ignore */
  }
}

/** The colour band a percentage sits in. */
function bandFor(pct: number): string {
  if (pct >= 80) return 'success';
  if (pct >= 60) return 'warning';
  return 'danger';
}

export default function GradesView({ authenticated, addToast }: GradesViewProps) {
  const [items, setItems] = useState<GradeAssignmentDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [target, setTarget] = useState('70');
  const [assume, setAssume] = useState('80');
  const [courseFilter, setCourseFilter] = useState('All');

  const load = useCallback(async () => {
    if (authenticated) {
      try {
        const remote = await listAssignments();
        setItems(remote);
        saveLocal(remote);
        return;
      } catch {
        /* fall through to the local copy */
      }
    }
    setItems(loadLocal());
  }, [authenticated]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const assignments = useMemo(() => items.map(toAssignment), [items]);
  const courses = useMemo(() => {
    const set = new Set(assignments.map(a => a.course || 'General'));
    return Array.from(set).sort();
  }, [assignments]);

  const visible = useMemo(() => {
    const scoped = courseFilter === 'All'
      ? assignments
      : assignments.filter(a => (a.course || 'General') === courseFilter);
    return sortAssignments(scoped);
  }, [assignments, courseFilter]);

  /** The headline numbers for the whole course set (or the filtered course). */
  const summary = useMemo(() => summarise(visible), [visible]);
  const required = useMemo(
    () => requiredAverage(Number(target) || 0, visible),
    [target, visible],
  );
  const projected = useMemo(
    () => projectGrade(visible, Number(assume) || 0),
    [assume, visible],
  );

  const perCourse = useMemo(
    () => groupByCourse(assignments).map(g => ({
      course: g.course,
      summary: summarise(g.items),
    })),
    [assignments],
  );

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      addToast?.('Give the assignment a name.', 'info');
      return;
    }
    const weight = Number(form.weight);
    if (!Number.isFinite(weight) || weight < 0) {
      addToast?.('The weight must be a number of percentage points.', 'info');
      return;
    }
    const maxScore = Number(form.maxScore) || 100;
    const score = form.score.trim() === '' ? null : Number(form.score);
    if (score !== null && (!Number.isFinite(score) || score < 0 || score > maxScore)) {
      addToast?.(`The mark must be between 0 and ${maxScore}.`, 'info');
      return;
    }

    const payload = {
      title: form.title.trim(),
      course: form.course.trim() || 'General',
      category: form.category,
      weight,
      score,
      maxScore,
      dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
    };

    try {
      if (authenticated) {
        const saved = await createAssignment(payload);
        setItems(prev => [...prev, saved]);
        saveLocal([...items, saved]);
      } else {
        const local: GradeAssignmentDTO = {
          ...payload,
          id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          notes: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setItems(prev => [...prev, local]);
        saveLocal([...items, local]);
      }
      setForm(EMPTY_FORM);
      setAdding(false);
      addToast?.('Assignment added.', 'success');
    } catch (err: any) {
      addToast?.(err.message || 'Could not add the assignment.', 'error');
    }
  };

  /** Set a mark straight from the list — the common case, one tap. */
  const setMark = async (id: string, score: number | null) => {
    const previous = items;
    const next = items.map(i => i.id === id ? { ...i, score } : i);
    setItems(next);
    saveLocal(next);
    if (!authenticated) return;
    try {
      const saved = await updateAssignment(id, { score });
      setItems(prev => prev.map(i => i.id === id ? saved : i));
    } catch (err: any) {
      setItems(previous);
      addToast?.(err.message || 'Could not save the mark.', 'error');
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this assignment?')) return;
    const previous = items;
    const next = items.filter(i => i.id !== id);
    setItems(next);
    saveLocal(next);
    if (!authenticated) return;
    try {
      await deleteAssignment(id);
    } catch (err: any) {
      setItems(previous);
      addToast?.(err.message || 'Could not delete the assignment.', 'error');
    }
  };

  const startEdit = (a: GradeAssignment) => {
    setEditingId(a.id);
    setAdding(true);
    setForm({
      title: a.title,
      course: a.course,
      category: a.category,
      weight: String(a.weight),
      score: a.score === null ? '' : String(a.score),
      maxScore: String(a.maxScore),
      dueDate: a.dueDate ? new Date(a.dueDate).toISOString().slice(0, 10) : '',
    });
  };

  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    const weight = Number(form.weight);
    const maxScore = Number(form.maxScore) || 100;
    const score = form.score.trim() === '' ? null : Number(form.score);
    const payload = {
      title: form.title.trim(),
      course: form.course.trim() || 'General',
      category: form.category,
      weight: Number.isFinite(weight) ? weight : 0,
      score,
      maxScore,
      dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
    };
    try {
      if (authenticated) {
        const saved = await updateAssignment(editingId, payload);
        setItems(prev => prev.map(i => i.id === editingId ? saved : i));
      } else {
        setItems(prev => prev.map(i => i.id === editingId
          ? { ...i, ...payload, updatedAt: new Date().toISOString() }
          : i));
      }
      setEditingId(null);
      setAdding(false);
      setForm(EMPTY_FORM);
    } catch (err: any) {
      addToast?.(err.message || 'Could not save the assignment.', 'error');
    }
  };

  const current = summary.currentGrade;

  return (
    <div className="animate-in">
      <div className="page-header">
        <div>
          <span className="sw-label">Study</span>
          <h2>Grades</h2>
          <p className="text-sm text-muted">
            Where you stand, weighted properly — and what you must score on the rest to hit your target.
          </p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => { setAdding(v => !v); setEditingId(null); }}>
          {adding ? 'Close' : '+ Add assignment'}
        </button>
      </div>

      {/* ── The headline ─────────────────────────────────────────────────── */}
      <div className="sw-grades-top">
        <div className="card sw-grades-headline">
          <span className="text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {courseFilter === 'All' ? 'Current grade' : `${courseFilter} grade`}
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginTop: '0.25rem' }}>
            <span style={{ fontSize: '2.6rem', fontWeight: 800, lineHeight: 1 }}>
              {current === null ? '—' : `${current.toFixed(1)}%`}
            </span>
            {current !== null && (
              <span className="tag" style={{ fontSize: '0.9rem', fontWeight: 700 }}>
                {letterGrade(current)}
              </span>
            )}
          </div>
          <p className="text-xs text-muted" style={{ marginTop: '0.5rem' }}>
            {summary.count === 0
              ? 'Add your assignments and this becomes the number that matters.'
              : `Across ${summary.gradedCount} of ${summary.count} marked · ${summary.gradedWeight.toFixed(0)}% of the course graded`}
          </p>
          {summary.totalWeight > 0 && (
            <div className="progress-bar" style={{ marginTop: '0.6rem' }}>
              <div
                className={`progress-fill ${current === null ? '' : bandFor(current)}`}
                style={{ width: `${summary.totalWeight > 0 ? (summary.gradedWeight / summary.totalWeight) * 100 : 0}%` }}
              />
            </div>
          )}
        </div>

        {/* What is needed for the target */}
        <div className="card">
          <span className="text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            To hit your target
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.25rem' }}>
            <input
              className="input"
              type="number"
              min={0}
              max={100}
              value={target}
              onChange={e => setTarget(e.target.value)}
              style={{ width: '5.5rem', padding: '0.2rem 0.5rem' }}
              aria-label="Target grade"
            />
            <span className="text-sm text-muted">%</span>
          </div>
          {summary.remainingWeight > 0 ? (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.6rem' }}>
                <span style={{ fontSize: '1.6rem', fontWeight: 700 }}>
                  {required.needed === null ? '—' : `${required.needed.toFixed(1)}%`}
                </span>
                <span className="text-sm text-muted">on the rest</span>
              </div>
              <p className="text-xs text-muted" style={{ marginTop: '0.35rem' }}>{required.reason}</p>
            </>
          ) : (
            <p className="text-xs text-muted" style={{ marginTop: '0.6rem' }}>{required.reason}</p>
          )}
        </div>

        {/* What-if */}
        <div className="card">
          <span className="text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            If you score this on the rest
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.25rem' }}>
            <input
              className="input"
              type="number"
              min={0}
              max={100}
              value={assume}
              onChange={e => setAssume(e.target.value)}
              style={{ width: '5.5rem', padding: '0.2rem 0.5rem' }}
              aria-label="Assumed score on remaining work"
            />
            <span className="text-sm text-muted">%</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.6rem' }}>
            <span style={{ fontSize: '1.6rem', fontWeight: 700 }}>
              {projected === null ? '—' : `${projected.toFixed(1)}%`}
            </span>
            <span className="text-sm text-muted">final grade</span>
          </div>
          <p className="text-xs text-muted" style={{ marginTop: '0.35rem' }}>
            {summary.remainingWeight > 0
              ? `Based on ${summary.remainingWeight.toFixed(0)}% of the course still to come.`
              : 'Everything is marked — this is your final grade.'}
          </p>
        </div>
      </div>

      {/* ── Add / edit form ─────────────────────────────────────────────── */}
      {adding && (
        <form className="card" style={{ marginBottom: '1rem' }} onSubmit={editingId ? submitEdit : save}>
          <div className="card-header">
            <span className="card-title">{editingId ? 'Edit assignment' : 'New assignment'}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setAdding(false); setEditingId(null); setForm(EMPTY_FORM); }}>✕</button>
          </div>
          <div className="sw-grades-form">
            <label>
              <span className="text-xs text-muted">Title</span>
              <input
                className="input"
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                placeholder="Photosynthesis quiz"
              />
            </label>
            <label>
              <span className="text-xs text-muted">Course</span>
              <input
                className="input"
                value={form.course}
                onChange={e => setForm({ ...form, course: e.target.value })}
                placeholder="Biology"
                list="sw-grade-courses"
              />
              <datalist id="sw-grade-courses">
                {courses.map(c => <option key={c} value={c} />)}
              </datalist>
            </label>
            <label>
              <span className="text-xs text-muted">Type</span>
              <select className="select" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label>
              <span className="text-xs text-muted">Weight (% of grade)</span>
              <input
                className="input"
                type="number"
                min={0}
                step="0.5"
                value={form.weight}
                onChange={e => setForm({ ...form, weight: e.target.value })}
                placeholder="10"
              />
            </label>
            <label>
              <span className="text-xs text-muted">Mark</span>
              <input
                className="input"
                type="number"
                min={0}
                step="0.5"
                value={form.score}
                onChange={e => setForm({ ...form, score: e.target.value })}
                placeholder="not marked yet"
              />
            </label>
            <label>
              <span className="text-xs text-muted">Out of</span>
              <input
                className="input"
                type="number"
                min={1}
                step="0.5"
                value={form.maxScore}
                onChange={e => setForm({ ...form, maxScore: e.target.value })}
              />
            </label>
            <label>
              <span className="text-xs text-muted">Due</span>
              <input
                className="input"
                type="date"
                value={form.dueDate}
                onChange={e => setForm({ ...form, dueDate: e.target.value })}
              />
            </label>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setAdding(false); setEditingId(null); setForm(EMPTY_FORM); }}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm">{editingId ? 'Save changes' : 'Add assignment'}</button>
          </div>
        </form>
      )}

      {/* ── Course breakdown ────────────────────────────────────────────── */}
      {perCourse.length > 1 && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div className="card-header"><span className="card-title">By course</span></div>
          <div className="sw-grades-courses">
            {perCourse.map(c => (
              <button
                key={c.course}
                className="sw-grades-course"
                onClick={() => setCourseFilter(courseFilter === c.course ? 'All' : c.course)}
                style={{ borderColor: courseFilter === c.course ? 'var(--accent)' : undefined }}
              >
                <span className="text-sm" style={{ fontWeight: 600 }}>{c.course}</span>
                <span style={{ fontSize: '1.15rem', fontWeight: 700 }}>
                  {c.summary.currentGrade === null ? '—' : `${c.summary.currentGrade.toFixed(1)}%`}
                </span>
                <span className="text-xs text-muted">
                  {c.summary.gradedWeight.toFixed(0)}% of {c.summary.totalWeight.toFixed(0)}% graded
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── The list ────────────────────────────────────────────────────── */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Assignments</span>
          {courses.length > 0 && (
            <select className="select select-sm" value={courseFilter} onChange={e => setCourseFilter(e.target.value)} style={{ width: 'auto' }}>
              <option value="All">All courses</option>
              {courses.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>

        {loading && <p className="text-sm text-muted">Loading…</p>}

        {!loading && visible.length === 0 && (
          <div className="empty-state" style={{ padding: '2.5rem 1rem' }}>
            <div className="empty-state-icon">📊</div>
            <h3>No assignments yet</h3>
            <p>
              Add the pieces of your course — the quiz worth 10%, the essay worth 30% —
              and this page tells you where you stand and what is left to do.
            </p>
          </div>
        )}

        {visible.length > 0 && (
          <div className="sw-grades-list">
            {visible.map(a => {
              const pct = a.score !== null && a.maxScore > 0 ? (a.score / a.maxScore) * 100 : null;
              const due = daysUntil(a.dueDate);
              return (
                <div key={a.id} className="sw-grades-row">
                  <div className="sw-grades-row-main">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600 }}>{a.title}</span>
                      <span className="tag">{a.category}</span>
                      <span className="text-xs text-muted">{a.weight}% of grade</span>
                    </div>
                    <div className="text-xs text-muted" style={{ marginTop: '0.2rem' }}>
                      {a.course}
                      {due !== null && (
                        <>
                          {' · '}
                          <span style={{ color: due < 0 ? 'var(--danger)' : due <= 3 ? 'var(--warning)' : undefined }}>
                            {due < 0 ? `${Math.abs(due)}d overdue` : due === 0 ? 'due today' : `due in ${due}d`}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="sw-grades-row-mark">
                    {a.score === null ? (
                      <input
                        className="input"
                        type="number"
                        min={0}
                        step="0.5"
                        placeholder="—"
                        style={{ width: '5rem' }}
                        aria-label={`Mark for ${a.title}`}
                        onBlur={e => {
                          const v = e.target.value.trim();
                          if (v === '') return;
                          const n = Number(v);
                          if (Number.isFinite(n)) setMark(a.id, n);
                        }}
                      />
                    ) : (
                      <>
                        <input
                          className="input"
                          type="number"
                          min={0}
                          step="0.5"
                          defaultValue={a.score}
                          style={{ width: '5rem' }}
                          aria-label={`Mark for ${a.title}`}
                          onBlur={e => {
                            const n = Number(e.target.value);
                            if (Number.isFinite(n) && n !== a.score) setMark(a.id, n);
                          }}
                        />
                        <span className="text-xs text-muted">/ {a.maxScore}</span>
                      </>
                    )}
                    {pct !== null && (
                      <span
                        className="tag"
                        style={{ fontWeight: 700, color: `var(--${bandFor(pct) === 'success' ? 'success' : bandFor(pct) === 'warning' ? 'warning' : 'danger'})` }}
                      >
                        {pct.toFixed(0)}%
                      </span>
                    )}
                  </div>

                  <div className="sw-grades-row-actions">
                    <button className="btn btn-ghost btn-xs" onClick={() => startEdit(a)} title="Edit">✏️</button>
                    <button className="btn btn-danger btn-xs" onClick={() => remove(a.id)} title="Delete">🗑️</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
