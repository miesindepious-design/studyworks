import { useState, useEffect } from 'react';
import { useAchievements, getRarityStyle } from '../hooks/useAchievements';

const CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'streaks', label: 'Streaks' },
  { key: 'study', label: 'Study' },
  { key: 'social', label: 'Social' },
  { key: 'ai', label: 'AI' },
];

const CATEGORY_EMOJI: Record<string, string> = {
  streaks: '🔥',
  study: '📚',
  social: '🤝',
  ai: '🤖',
};

export default function Achievements() {
  const { allAchievements, unlocked, progress, isUnlocked, newlyUnlocked, dismissCelebration } = useAchievements();
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(false);

  const filtered = filter === 'all' ? allAchievements : allAchievements.filter(a => a.category === filter);

  // Auto-close celebration after 4 seconds
  useEffect(() => {
    if (newlyUnlocked) {
      const timer = setTimeout(dismissCelebration, 4000);
      return () => clearTimeout(timer);
    }
  }, [newlyUnlocked, dismissCelebration]);

  return (
    <>
      {/* Trigger button */}
      <button
        className="icon-btn"
        onClick={() => setOpen(true)}
        title="Achievements"
        style={{ position: 'relative' }}
      >
        🏆
        {unlocked.length > 0 && (
          <span
            style={{
              position: 'absolute',
              top: '-4px',
              right: '-4px',
              background: 'var(--danger)',
              color: '#fff',
              fontSize: '0.65rem',
              fontWeight: 700,
              width: '18px',
              height: '18px',
              borderRadius: 'var(--r-full)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '2px solid var(--surface-0)',
            }}
          >
            {unlocked.length}
          </span>
        )}
      </button>

      {/* Modal */}
      {open && (
        <div
          className="achievements-overlay"
          onClick={() => setOpen(false)}
        >
          <div
            className="achievements-modal"
            onClick={e => e.stopPropagation()}
          >
            <div className="achievements-header">
              <div>
                <h2 className="achievements-title">🏆 Achievements</h2>
                <p className="achievements-subtitle">
                  {unlocked.length} / {allAchievements.length} unlocked
                </p>
              </div>
              <button className="icon-btn" onClick={() => setOpen(false)}>✕</button>
            </div>

            <div className="achievements-filters">
              {CATEGORIES.map(c => (
                <button
                  key={c.key}
                  className={`achievements-filter-btn ${filter === c.key ? 'active' : ''}`}
                  onClick={() => setFilter(c.key)}
                >
                  {c.key === 'all' ? '🏷️' : CATEGORY_EMOJI[c.key]} {c.label}
                </button>
              ))}
            </div>

            <div className="achievements-grid">
              {filtered.map(achievement => {
                const unlockedStatus = isUnlocked(achievement.id);
                const prog = progress(achievement);
                const rarity = getRarityStyle(achievement.rarity);

                return (
                  <div
                    key={achievement.id}
                    className={`achievement-card ${unlockedStatus ? 'unlocked' : 'locked'}`}
                    style={{
                      borderColor: unlockedStatus ? rarity.border : 'var(--border)',
                      background: unlockedStatus ? rarity.bg : 'var(--surface-1)',
                    }}
                  >
                    <div className="achievement-icon" style={{
                      filter: unlockedStatus ? 'none' : 'grayscale(1) opacity(0.5)',
                    }}>
                      {achievement.icon}
                    </div>
                    <div className="achievement-info">
                      <h3 className="achievement-name" style={{
                        color: unlockedStatus ? rarity.text : 'var(--text-2)',
                      }}>
                        {achievement.title}
                      </h3>
                      <p className="achievement-desc">{achievement.description}</p>

                      {/* Progress bar */}
                      {!unlockedStatus && (
                        <div className="achievement-progress">
                          <div
                            className="achievement-progress-fill"
                            style={{
                              width: `${prog * 100}%`,
                              background: rarity.text,
                            }}
                          />
                        </div>
                      )}
                      <span className="achievement-rarity" style={{ color: rarity.text }}>
                        {achievement.rarity.toUpperCase()}
                      </span>
                    </div>
                    {unlockedStatus && (
                      <div className="achievement-badge" style={{ background: rarity.text }}>
                        ✓
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Celebration overlay */}
          {newlyUnlocked && (
            <div className="achievement-celebrate-overlay">
              <div className="achievement-celebrate-card">
                <div className="achievement-celebrate-emoji">{newlyUnlocked.icon}</div>
                <h2 className="achievement-celebrate-title">Achievement Unlocked!</h2>
                <p className="achievement-celebrate-name">{newlyUnlocked.title}</p>
                <p className="achievement-celebrate-desc">{newlyUnlocked.description}</p>
                <div className="confetti-container">
                  {Array.from({ length: 40 }).map((_, i) => (
                    <div
                      key={i}
                      className="confetti-piece"
                      style={{
                        left: `${Math.random() * 100}%`,
                        background: ['#2dd4bf', '#38bdf8', '#a855f7', '#fbbf24', '#fb7185'][Math.floor(Math.random() * 5)],
                        animationDelay: `${Math.random() * 0.5}s`,
                        animationDuration: `${1.5 + Math.random() * 1.5}s`,
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
