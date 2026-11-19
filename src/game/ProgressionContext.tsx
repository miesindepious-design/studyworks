/**
 * ProgressionContext — one place where XP is earned.
 *
 * Every feature that does something worth points (a card review, a focus
 * session, a quiz battle, a tutor question) calls `award()` here. The provider
 * keeps a local copy so the UI reacts instantly and works offline, and syncs
 * with the server whenever the student is signed in.
 *
 * Offline behaviour matters: work done without a connection is queued, not
 * lost. The queue is flushed the moment the student signs in.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ACHIEVEMENTS,
  SEASON_BADGES,
  XP_EVENTS,
  buildDailyQuests,
  currentSeason,
  isoDate,
  levelInfo,
  type AchievementStatKey,
  type XpEventType,
} from './rules';
import {
  getProgression,
  postEvent,
  postStats,
  spendFreeze,
  type AchievementView,
  type ProgressionState,
  type QuestView,
  type SeasonView,
} from '../api/progression';

const STORAGE_KEY = 'sw-progression-v1';

interface LocalSnapshot {
  xp: number;
  seasonXp: number;
  focusTrees: number;
  streakFreezes: number;
  unlocked: string[];
  stats: Record<string, number>;
  /** questId -> { p: progress, d: done } */
  questState: Record<string, { p: number; d: boolean }>;
  questDate: string | null;
  /** Events earned while offline, replayed once the student signs in. */
  pending: Array<{ type: string; amount?: number }>;
}

const EMPTY_LOCAL: LocalSnapshot = {
  xp: 0,
  seasonXp: 0,
  focusTrees: 0,
  streakFreezes: 1,
  unlocked: [],
  stats: {},
  questState: {},
  questDate: null,
  pending: [],
};

function loadLocal(): LocalSnapshot {  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_LOCAL;
    const parsed = JSON.parse(raw);
    return { ...EMPTY_LOCAL, ...parsed };
  } catch {
    return EMPTY_LOCAL;
  }
}

function saveLocal(state: LocalSnapshot) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked — the server copy still has the truth */
  }
}

/** The season as the UI sees it, whether it came from the server or the calendar. */
function toSeasonView(season: ReturnType<typeof currentSeason>): SeasonView | null {
  if (!season) return null;
  return {
    id: season.id,
    name: season.name,
    description: season.description,
    icon: season.icon,
    xpMultiplier: season.xpMultiplier,
    endsAt: season.end,
  };
}

export interface ProgressionContextValue {
  xp: number;
  level: number;
  levelTitle: string;
  xpIntoLevel: number;
  xpForNextLevel: number;
  progressPct: number;
  seasonXp: number;
  season: SeasonView | null;
  streakFreezes: number;
  focusTrees: number;
  quests: QuestView[];
  achievements: AchievementView[];
  unlockedAchievements: string[];
  stats: Record<string, number>;
  dailyXp: Record<string, number>;
  /** Award XP for an activity. Resolves with the server response when online. */
  award: (type: XpEventType, amount?: number) => Promise<void>;
  /** Push the counters achievements are judged on (absolute totals). */
  syncStats: (stats: Partial<Record<AchievementStatKey, number>>) => Promise<void>;
  /** Spend a streak freeze to cover a missed day. */
  useFreeze: () => Promise<boolean>;
  /** The achievement that just unlocked, if any. */
  newAchievement: AchievementView | null;
  dismissAchievement: () => void;
  /** True once the server state has been loaded. */
  ready: boolean;
}

const ProgressionContext = createContext<ProgressionContextValue | null>(null);
export { ProgressionContext };

export interface ProgressionProviderProps {
  children: ReactNode;
  /** Whether the student is signed in — controls server vs local mode. */
  authenticated: boolean;
  onToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}

export function ProgressionProvider({ children, authenticated, onToast }: ProgressionProviderProps) {
  const [local, setLocal] = useState<LocalSnapshot>(EMPTY_LOCAL);
  const [server, setServer] = useState<ProgressionState | null>(null);
  const [ready, setReady] = useState(false);
  const [newAchievement, setNewAchievement] = useState<AchievementView | null>(null);
  const localRef = useRef(local);
  localRef.current = local;

  // Load the cached snapshot once.
  useEffect(() => {
    setLocal(loadLocal());
    setReady(true);
  }, []);

  useEffect(() => {
    saveLocal(local);
  }, [local]);

  // Pull the server state when signed in, then replay anything earned offline.
  useEffect(() => {
    if (!authenticated) {
      setServer(null);
      return;
    }
    let alive = true;

    (async () => {
      try {
        const remote = await getProgression();
        if (!alive) return;
        setServer(remote);

        // Flush the offline queue so the student keeps the points they earned.
        const pending = localRef.current.pending;
        if (pending.length > 0) {
          let state = remote;
          for (const event of pending) {
            try {
              state = await postEvent(event.type, event.amount);
            } catch {
              // Leave the rest queued — try again next time.
              const rest = pending.slice(pending.indexOf(event));
              setLocal(prev => ({ ...prev, pending: rest }));
              break;
            }
          }
          if (alive) {
            setServer(state);
            setLocal(prev => ({ ...prev, pending: [] }));
          }
        }
      } catch (err) {
        console.warn('[StudyWorks] Progression sync failed (offline?):', err);
      }
    })();

    return () => { alive = false; };
  }, [authenticated]);

  const award = useCallback(async (type: XpEventType, amount?: number) => {
    const def = XP_EVENTS[type];
    if (!def) return;

    if (authenticated) {
      try {
        const result = await postEvent(type, amount);
        setServer(result);
        if (result.leveledUp) {
          onToast?.(`🎉 Level ${result.level} — ${result.levelTitle}!`, 'success');
        }
        const fresh = result.achievements.filter(a => a.unlocked);
        if (fresh.length > 0) {
          const justUnlocked = result.achievements.filter(
            a => a.unlocked && !localRef.current.unlocked.includes(a.id),
          );
          if (justUnlocked.length > 0) setNewAchievement(justUnlocked[0]);
        }
      } catch (err) {
        console.warn('[StudyWorks] Could not record XP:', err);
        // Fall back to the local ledger so the work is not lost.
        setLocal(prev => ({ ...prev, pending: [...prev.pending, { type, amount }] }));
      }
      return;
    }

    // Offline / signed out: keep it locally and queue it for later.
    const multiplier = currentSeason()?.xpMultiplier ?? 1;
    const gained = Math.round((amount ?? def.xp) * multiplier);
    const today = isoDate();

    setLocal(prev => {
      const quests = buildDailyQuests(today, 'local', levelInfo(prev.xp).level);
      const questState = prev.questDate === today ? { ...prev.questState } : {};
      let xp = prev.xp + gained;
      let seasonXp = prev.seasonXp + gained;

      if (def.quest) {
        const quest = quests.find(q => q.type === def.quest);
        if (quest) {
          const entry = questState[quest.id] ?? { p: 0, d: false };
          if (!entry.d) {
            const next = entry.p + (def.step ?? 1);
            if (next >= quest.target) {
              entry.p = quest.target;
              entry.d = true;
              xp += quest.xp;
              seasonXp += quest.xp;
            } else {
              entry.p = next;
            }
            questState[quest.id] = entry;
          }
        }
      }

      return {
        ...prev,
        xp,
        seasonXp,
        questState,
        questDate: today,
        pending: [...prev.pending, { type, amount }],
      };
    });
  }, [authenticated, onToast]);

  const syncStats = useCallback(async (stats: Partial<Record<AchievementStatKey, number>>) => {
    if (authenticated) {
      try {
        const result = await postStats(stats);
        setServer(result);
        const justUnlocked = result.achievements.filter(
          a => a.unlocked && !localRef.current.unlocked.includes(a.id),
        );
        if (justUnlocked.length > 0) setNewAchievement(justUnlocked[0]);
        return;
      } catch (err) {
        console.warn('[StudyWorks] Could not sync stats:', err);
      }
    }
    setLocal(prev => {
      const next = { ...prev.stats };
      for (const [k, v] of Object.entries(stats)) {
        if (typeof v === 'number') next[k] = Math.max(next[k] ?? 0, v);
      }
      return { ...prev, stats: next };
    });
  }, [authenticated]);

  const useFreeze = useCallback(async () => {
    if (authenticated) {
      try {
        const result = await spendFreeze();
        if (result.granted) {
          setServer(prev => (prev ? { ...prev, streakFreezes: result.streakFreezes } : prev));
          setLocal(prev => ({ ...prev, streakFreezes: result.streakFreezes }));
          return true;
        }
        return false;
      } catch {
        return false;
      }
    }
    // Offline: spend from the local wallet if there is one.
    if (localRef.current.streakFreezes <= 0) return false;
    setLocal(prev => ({ ...prev, streakFreezes: prev.streakFreezes - 1 }));
    return true;
  }, [authenticated]);

  // ── Derived state ──────────────────────────────────────────────────────────
  const value = useMemo<ProgressionContextValue>(() => {
    const xp = server?.xp ?? local.xp;
    const info = levelInfo(xp);
    const today = isoDate();

    // Quests: the server knows the real progress; offline we rebuild it from
    // the local quest state.
    let quests: QuestView[];
    if (server) {
      quests = server.quests;
    } else {
      const localQuests = buildDailyQuests(today, 'local', info.level);
      quests = localQuests.map(q => {
        const entry = local.questDate === today ? local.questState[q.id] : undefined;
        const progress = Math.min(entry?.p ?? 0, q.target);
        const done = Boolean(entry?.d);
        return {
          id: q.id,
          type: q.type,
          title: q.title,
          description: q.description,
          icon: q.icon,
          xp: q.xp,
          target: q.target,
          progress,
          done,
          completed: done,
          readyToClaim: done,
        };
      });
    }

    // Achievements: the catalogue plus whatever progress we know about.
    const stats = server?.stats ?? local.stats;
    const unlocked = server?.unlockedAchievements ?? local.unlocked;
    const catalogue = [...ACHIEVEMENTS, ...SEASON_BADGES];
    const achievements: AchievementView[] = catalogue.map(a => {
      const current = stats[a.statKey] ?? 0;
      return {
        ...a,
        progress: Math.min(current, a.target),
        unlocked: unlocked.includes(a.id),
        complete: current >= a.target,
      };
    });

    return {
      xp,
      level: info.level,
      levelTitle: info.title,
      xpIntoLevel: info.xpIntoLevel,
      xpForNextLevel: info.xpForNextLevel,
      progressPct: info.progressPct,
      seasonXp: server?.seasonXp ?? local.seasonXp,
      season: server?.season ?? toSeasonView(currentSeason()),
      streakFreezes: server?.streakFreezes ?? local.streakFreezes,
      focusTrees: server?.focusTrees ?? local.focusTrees,
      quests,
      achievements,
      unlockedAchievements: unlocked,
      stats,
      dailyXp: server?.dailyXp ?? {},
      award,
      syncStats,
      useFreeze,
      newAchievement,
      dismissAchievement: () => setNewAchievement(null),
      ready,
    };
  }, [server, local, award, syncStats, useFreeze, newAchievement, ready]);

  return (
    <ProgressionContext.Provider value={value}>
      {children}
    </ProgressionContext.Provider>
  );
}

/** Access the progression. Must be used inside a ProgressionProvider. */
export function useProgression(): ProgressionContextValue {
  const ctx = useContext(ProgressionContext);
  if (!ctx) {
    throw new Error('useProgression must be used inside a ProgressionProvider');
  }
  return ctx;
}
