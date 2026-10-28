import { useGoals, type DailyGoal } from '../hooks/useGoals';

function CircularProgress({ goal, progress }: { goal: DailyGoal; progress: number }) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);

  return (
    <div className="goal-item">
      <div className="goal-circular">
        <svg viewBox="0 0 80 80" className="goal-svg">
          <circle
            cx="40"
            cy="40"
            r={radius}
            fill="none"
            stroke="var(--surface-3)"
            strokeWidth="6"
          />
          <circle
            cx="40"
            cy="40"
            r={radius}
            fill="none"
            stroke={goal.color}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform="rotate(-90 40 40)"
            style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(.22,1,.36,1)' }}
          />
        </svg>
        <div className="goal-center">
          <span className="goal-icon">{goal.icon}</span>
          <span className="goal-percent">{Math.round(progress * 100)}%</span>
        </div>
      </div>
      <p className="goal-label">{goal.label}</p>
      <p className="goal-target">{goal.target} {goal.statKey === 'studyMinutes' ? 'min' : goal.id === 'notes' ? 'notes' : 'cards'}</p>
    </div>
  );
}

export default function GoalTracker() {
  const { state, getProgress, goals } = useGoals();
  const completedCount = goals.filter(g => (state.counts[g.statKey] || 0) >= g.target).length;
  const allComplete = completedCount === goals.length;

  return (
    <div className={`goal-tracker ${allComplete ? 'goal-tracker--complete' : ''}`}>
      <div className="goal-tracker-header">
        <div>
          <h3 className="goal-tracker-title">Daily Goals</h3>
          <p className="goal-tracker-streak">
            🔥 {state.streak} day streak
          </p>
        </div>
        {allComplete && (
          <span className="goal-complete-badge">✅ All done!</span>
        )}
      </div>

      <div className="goal-tracker-grid">
        {goals.map(goal => (
          <CircularProgress
            key={goal.id}
            goal={goal}
            progress={getProgress(goal)}
          />
        ))}
      </div>

      <div className="goal-tracker-footer">
        <span className="goal-progress-text">
          {completedCount} / {goals.length} goals completed
        </span>
      </div>
    </div>
  );
}
