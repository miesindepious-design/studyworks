/**
 * DuelView — challenge someone who is not online.
 *
 * A live quiz battle needs both players at the same time, which is a lot to
 * ask of a friend. A duel does not: you pick some cards, play them, and send
 * the code. Your opponent answers whenever they open the link, and the two
 * scores settle it — with ELO ratings moving either way.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  answerDuel,
  createDuel,
  getDuel,
  listDuels,
  type DuelDetail,
  type DuelSummary,
} from '../api/progression';
import { useProgression } from '../game/ProgressionContext';

export interface DuelViewProps {
  onToast?: (message: string, type: 'success' | 'error' | 'info') => void;
  /** Fired when a duel is finished, so the app can award XP. */
  onDuelComplete?: (won: boolean) => void;
  /** A duel code that arrived from a shared link. */
  initialCode?: string | null;
}

export default function DuelView({ onToast, onDuelComplete, initialCode }: DuelViewProps) {
  const { award } = useProgression();
  const [duels, setDuels] = useState<DuelSummary[]>([]);
  const [active, setActive] = useState<DuelDetail | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(false);
  const [topic, setTopic] = useState('');
  const [questionCount, setQuestionCount] = useState(5);

  const load = useCallback(async () => {
    try {
      setDuels(await listDuels());
    } catch {
      /* the server may be unreachable; the list is a nicety */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Open a duel that arrived through a link.
  useEffect(() => {
    if (!initialCode) return;
    getDuel(initialCode)
      .then(d => {
        setActive(d);
        setAnswers({});
      })
      .catch(err => onToast?.((err as Error).message || 'That duel could not be opened', 'error'));
  }, [initialCode, onToast]);

  const openDuel = async (code: string) => {
    setLoading(true);
    try {
      const d = await getDuel(code);
      setActive(d);
      setAnswers({});
    } catch (err) {
      onToast?.((err as Error).message || 'Could not open that duel', 'error');
    } finally {
      setLoading(false);
    }
  };

  const create = async () => {
    setLoading(true);
    try {
      const res = await createDuel({
        source: topic.trim() ? 'topic' : 'flashcards',
        topic: topic.trim() || undefined,
        questionCount,
      });
      onToast?.(`Duel ${res.code} created — play it, then share the code.`, 'success');
      await load();
      await openDuel(res.code);
    } catch (err) {
      onToast?.((err as Error).message || 'Could not create the duel', 'error');
    } finally {
      setLoading(false);
    }
  };

  const submit = async () => {
    if (!active) return;
    setLoading(true);
    try {
      const list = active.questions.map((_, i) => answers[i] ?? -1);
      const res = await answerDuel(active.code, list);
      if (res.completed) {
        onToast?.(
          res.isDraw
            ? 'A draw — nicely matched.'
            : res.iWon
              ? '🏆 You won the duel!'
              : 'You lost this one. The rematch is yours to take.',
          res.iWon ? 'success' : 'info',
        );
        award(res.iWon ? 'duel_won' : 'duel_completed');
        onDuelComplete?.(Boolean(res.iWon));
      } else {
        onToast?.('Your answers are in. Waiting for your opponent.', 'success');
        award('duel_completed');
      }
      await load();
      await openDuel(active.code);
    } catch (err) {
      onToast?.((err as Error).message || 'Could not submit your answers', 'error');
    } finally {
      setLoading(false);
    }
  };

  const copyCode = async (code: string) => {
    const url = `${window.location.origin}/?duel=${code}`;
    try {
      await navigator.clipboard.writeText(url);
      onToast?.('Duel link copied — send it to your rival.', 'success');
    } catch {
      onToast?.(`Share this code: ${code}`, 'info');
    }
  };

  // ── Playing a duel ─────────────────────────────────────────────────────────
  if (active) {
    const answeredCount = Object.keys(answers).length;
    const complete = active.status === 'completed';

    return (
      <div className="sw-panel">
        <div className="sw-panel-head">
          <div>
            <h3 className="sw-panel-title">
              {complete ? '🏁 Duel result' : '⚔️ Duel'} · <span style={{ fontFamily: 'monospace' }}>{active.code}</span>
            </h3>
            <p className="sw-panel-sub">
              {active.iAmChallenger
                ? `You challenged ${active.opponentName ?? 'someone'}.`
                : `${active.challengerName} challenged you.`}
              {active.source === 'topic' && active.topic ? ` · ${active.topic}` : ''}
            </p>
          </div>
          <div className="sw-panel-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => { setActive(null); setAnswers({}); }}>
              Back
            </button>
          </div>
        </div>

        {complete && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '0.6rem',
              marginBottom: '1rem',
            }}
          >
            <div className="sw-stat-tile">
              <div className="sw-stat-tile-value">{active.challengerScore ?? 0}</div>
              <div className="sw-stat-tile-label">{active.challengerName}</div>
            </div>
            <div className="sw-stat-tile">
              <div className="sw-stat-tile-value">{active.opponentScore ?? 0}</div>
              <div className="sw-stat-tile-label">{active.opponentName ?? 'Opponent'}</div>
            </div>
          </div>
        )}

        {!complete && active.iPlayed && (
          <p className="sw-panel-sub" style={{ marginBottom: '0.75rem' }}>
            You have played this duel — waiting for {active.opponentName ?? 'your opponent'} to answer.
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {active.questions.map((q, qi) => (
            <div
              key={qi}
              style={{
                padding: '0.85rem',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--border)',
                background: 'var(--surface-1)',
              }}
            >
              <div style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.6rem' }}>
                {qi + 1}. {q.prompt}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {q.options.map((opt, oi) => {
                  const picked = answers[qi] === oi;
                  const disabled = complete || active.iPlayed;
                  return (
                    <button
                      key={oi}
                      disabled={disabled}
                      onClick={() => setAnswers(prev => ({ ...prev, [qi]: oi }))}
                      style={{
                        textAlign: 'left',
                        padding: '0.5rem 0.7rem',
                        borderRadius: 'var(--radius-md, 8px)',
                        border: `1px solid ${picked ? 'var(--accent)' : 'var(--border)'}`,
                        background: picked ? 'var(--surface-3)' : 'transparent',
                        color: 'var(--text)',
                        fontSize: '0.83rem',
                        cursor: disabled ? 'default' : 'pointer',
                        opacity: disabled && !picked ? 0.6 : 1,
                      }}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {!complete && !active.iPlayed && (
          <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem', flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={loading || answeredCount < active.questions.length}
              onClick={submit}
            >
              Submit answers ({answeredCount}/{active.questions.length})
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => copyCode(active.code)}>
              Copy duel link
            </button>
          </div>
        )}

        {!complete && active.iPlayed && (
          <button className="btn btn-ghost btn-sm" style={{ marginTop: '1rem' }} onClick={() => copyCode(active.code)}>
            Copy duel link to invite someone else
          </button>
        )}
      </div>
    );
  }

  // ── The duel list ──────────────────────────────────────────────────────────
  return (
    <div className="sw-panel">
      <div className="sw-panel-head">
        <div>
          <h3 className="sw-panel-title">⚔️ Duels</h3>
          <p className="sw-panel-sub">
            Challenge a friend to the same questions — no need to be online at the same time.
          </p>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: '0.9rem',
        }}
      >
        <input
          className="sw-input"
          placeholder="Topic (optional — uses your tagged cards)"
          value={topic}
          onChange={e => setTopic(e.target.value)}
          style={{
            flex: '1 1 14rem',
            padding: '0.5rem 0.65rem',
            borderRadius: 'var(--radius-md, 8px)',
            border: '1px solid var(--border)',
            background: 'var(--surface-2)',
            color: 'var(--text)',
            fontSize: '0.83rem',
          }}
        />
        <select
          value={questionCount}
          onChange={e => setQuestionCount(Number(e.target.value))}
          style={{
            padding: '0.5rem 0.6rem',
            borderRadius: 'var(--radius-md, 8px)',
            border: '1px solid var(--border)',
            background: 'var(--surface-2)',
            color: 'var(--text)',
            fontSize: '0.83rem',
          }}
        >
          {[3, 5, 8, 10, 15, 20].map(n => (
            <option key={n} value={n}>{n} questions</option>
          ))}
        </select>
        <button className="btn btn-primary btn-sm" onClick={create} disabled={loading}>
          Create duel
        </button>
      </div>

      {!duels.length && (
        <div className="sw-empty">
          <div className="sw-empty-icon">⚔️</div>
          <p className="sw-empty-title">No duels yet</p>
          <p className="sw-empty-sub">
            Create one from your flashcards, play it, then send the code to a friend.
          </p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {duels.map(duel => (
          <div
            key={duel.code}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.65rem 0.8rem',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border)',
              background: 'var(--surface-1)',
            }}
          >
            <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', fontWeight: 700 }}>{duel.code}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: '0.8rem', color: 'var(--text-2)' }}>
              {duel.iAmChallenger ? 'You' : duel.challengerName} vs {duel.iAmChallenger ? duel.opponentName ?? '—' : 'you'}
              {duel.status === 'completed' && duel.myScore != null && (
                <span style={{ marginLeft: '0.4rem', color: 'var(--text-3)' }}>
                  · {duel.myScore}/?
                </span>
              )}
            </span>
            <button className="btn btn-ghost btn-xs" onClick={() => openDuel(duel.code)}>
              {duel.played && duel.status !== 'completed' ? 'View' : duel.status === 'completed' ? 'Result' : 'Play'}
            </button>
            <button className="btn btn-ghost btn-xs" onClick={() => copyCode(duel.code)}>
              Copy
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
