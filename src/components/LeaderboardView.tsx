/**
 * LeaderboardView — two ways to be the best in the room.
 *
 * "XP" is the grind: everything the student has done adds up, and it never
 * resets. "Rating" is the head-to-head ladder: only quiz battles and duels
 * move it, and beating a stronger opponent is worth more.
 */
import { useCallback, useEffect, useState } from 'react';
import { getRatingLeaderboard, getXpLeaderboard, type LeaderboardRow, type RatingRow } from '../api/progression';

type Tab = 'xp' | 'rating';

export interface LeaderboardViewProps {
  /** Which tab to open on. */
  initialTab?: Tab;
}

function medal(rank: number): string {
  if (rank === 0) return '🥇';
  if (rank === 1) return '🥈';
  if (rank === 2) return '🥉';
  return `${rank + 1}`;
}

export default function LeaderboardView({ initialTab = 'xp' }: LeaderboardViewProps) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [scope, setScope] = useState<'global' | 'week'>('global');
  const [xpRows, setXpRows] = useState<LeaderboardRow[]>([]);
  const [ratingRows, setRatingRows] = useState<RatingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === 'xp') {
        const res = await getXpLeaderboard(scope);
        setXpRows(res.rows);
      } else {
        const res = await getRatingLeaderboard();
        setRatingRows(res.rows);
      }
    } catch (err) {
      setError((err as Error).message || 'Could not load the leaderboard');
    } finally {
      setLoading(false);
    }
  }, [tab, scope]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = tab === 'xp' ? xpRows : ratingRows;

  return (
    <div className="sw-panel">
      <div className="sw-panel-head">
        <div>
          <h3 className="sw-panel-title">🏆 Leaderboard</h3>
          <p className="sw-panel-sub">
            {tab === 'xp'
              ? 'Everything you have done, added up.'
              : 'Quiz battles and duels only — this one is about winning.'}
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.9rem', flexWrap: 'wrap' }}>
        <button
          className={`btn btn-sm ${tab === 'xp' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('xp')}
        >
          ⚡ XP
        </button>
        <button
          className={`btn btn-sm ${tab === 'rating' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('rating')}
        >
          🎯 Rating
        </button>
        {tab === 'xp' && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.35rem' }}>
            <button
              className={`btn btn-xs ${scope === 'global' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setScope('global')}
            >
              All time
            </button>
            <button
              className={`btn btn-xs ${scope === 'week' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setScope('week')}
            >
              This week
            </button>
          </div>
        )}
      </div>

      {error && (
        <p style={{ fontSize: '0.8rem', color: 'var(--danger, #f87171)' }}>{error}</p>
      )}

      {loading && <p className="sw-panel-sub">Loading…</p>}

      {!loading && !rows.length && !error && (
        <div className="sw-empty">
          <div className="sw-empty-icon">🏁</div>
          <p className="sw-empty-title">Nobody on the board yet</p>
          <p className="sw-empty-sub">
            {tab === 'xp'
              ? 'Review a card or finish a focus session and you will be the first one up.'
              : 'Host a quiz battle or challenge a friend to a duel to start the ladder.'}
          </p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {rows.map((row, index) => {
          const isRating = tab === 'rating';
          const rating = row as RatingRow;
          const xpRow = row as LeaderboardRow;
          const value = isRating ? rating.rating : xpRow.xp;
          const detail = isRating
            ? `${rating.wins}W · ${rating.losses}L${rating.draws ? ` · ${rating.draws}D` : ''} · peak ${rating.peakRating}`
            : `Level ${xpRow.level} ${xpRow.levelTitle}`;

          return (
            <div
              key={row.userId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.6rem 0.8rem',
                borderRadius: 'var(--radius-lg)',
                border: `1px solid ${row.isMe ? 'var(--accent)' : 'var(--border)'}`,
                background: row.isMe ? 'var(--surface-2)' : 'var(--surface-1)',
              }}
            >
              <span
                style={{
                  width: '2rem',
                  textAlign: 'center',
                  fontSize: index < 3 ? '1.1rem' : '0.85rem',
                  fontWeight: 700,
                  color: 'var(--text-2)',
                }}
              >
                {medal(index)}
              </span>
              <span
                style={{
                  width: '2rem',
                  height: '2rem',
                  borderRadius: 'var(--r-full)',
                  background: 'var(--surface-3)',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  overflow: 'hidden',
                  flexShrink: 0,
                }}
              >
                {row.image ? (
                  <img src={row.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  (row.name || '?').slice(0, 1).toUpperCase()
                )}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600 }}>
                  {row.name}
                  {row.isMe && (
                    <span className="sw-chip" style={{ marginLeft: '0.4rem' }}>you</span>
                  )}
                </span>
                <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-3)' }}>{detail}</span>
              </span>
              <span style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', fontSize: '0.9rem' }}>
                {value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
