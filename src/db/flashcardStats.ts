/**
 * flashcardStats.ts — persisted review session stats for flashcards.
 *
 * Each completed review/cram/intensive session is written here so the
 * statistics view can show historical accuracy, frequency, and trends.
 */

import { getDB } from './schema';
import type { SessionStat } from '../types';

const DAY_KEY = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export async function getRecentSessions(limit = 50): Promise<SessionStat[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex('flashcard_sessions', 'by_date');
  return all.reverse().slice(0, limit);
}

export async function saveSession(stat: SessionStat): Promise<void> {
  const db = await getDB();
  await db.put('flashcard_sessions', stat);
}

export async function getSessionsForDate(date: string): Promise<SessionStat[]> {
  const db = await getDB();
  return db.getAllFromIndex('flashcard_sessions', 'by_date', date);
}

export async function getSessionsInRange(start: Date, end: Date): Promise<SessionStat[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex('flashcard_sessions', 'by_date');
  const startKey = DAY_KEY(start);
  const endKey = DAY_KEY(end);
  return all.filter(s => s.date >= startKey && s.date <= endKey);
}

export function computeAggregate(sessions: SessionStat[]) {
  if (!sessions.length) {
    return {
      totalReviews: 0,
      accuracy: 0,
      avgResponseTime: 0,
      totalMinutes: 0,
      again: 0,
      hard: 0,
      good: 0,
      easy: 0,
      sessions: 0,
    };
  }
  const totalCards = sessions.reduce((s, x) => s + x.cardsReviewed, 0);
  const totalAgain = sessions.reduce((s, x) => s + x.again, 0);
  const totalHard = sessions.reduce((s, x) => s + x.hard, 0);
  const totalGood = sessions.reduce((s, x) => s + x.good, 0);
  const totalEasy = sessions.reduce((s, x) => s + x.easy, 0);
  const totalDuration = sessions.reduce((s, x) => s + x.duration, 0);
  const weightedAccuracy = sessions.reduce((s, x) => s + x.accuracy * x.cardsReviewed, 0) / totalCards;
  const weightedRT = sessions.reduce((s, x) => s + x.avgResponseTime * x.cardsReviewed, 0) / totalCards;

  return {
    totalReviews: totalCards,
    accuracy: Math.round(weightedAccuracy * 100) / 100,
    avgResponseTime: Math.round(weightedRT),
    totalMinutes: Math.round(totalDuration / 60),
    again: totalAgain,
    hard: totalHard,
    good: totalGood,
    easy: totalEasy,
    sessions: sessions.length,
  };
}
