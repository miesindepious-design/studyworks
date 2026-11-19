/**
 * api/progression.ts — the client's door into the progression server.
 *
 * Every call is cookie-authenticated (the same session as the rest of the
 * app), so there is no token juggling here. The hooks in `src/game/` handle
 * the offline case.
 */
import { apiDelete, apiGet, apiPatch, apiPost } from './client';
import type { AchievementDef, AchievementStatKey, QuestType, Season } from '../game/rules';

export interface QuestView {
  id: string;
  type: QuestType;
  title: string;
  description: string;
  icon: string;
  xp: number;
  target: number;
  progress: number;
  done: boolean;
  completed: boolean;
  readyToClaim: boolean;
}

export interface AchievementView extends AchievementDef {
  progress: number;
  unlocked: boolean;
  complete: boolean;
}

export interface SeasonView {
  id: string;
  name: string;
  description: string;
  icon: string;
  xpMultiplier: number;
  endsAt: string;
}

export interface ProgressionState {
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
  unlockedAchievements: string[];
  achievements: AchievementView[];
  quests: QuestView[];
  dailyXp: Record<string, number>;
  stats: Record<string, number>;
  serverDate: string;
}

export interface EventResult extends ProgressionState {
  xpGained: number;
  baseXp: number;
  questXp: number;
  leveledUp: boolean;
  level: number;
  previousLevel: number;
  newlyCompletedQuests: string[];
  multiplier: number;
}

export interface LeaderboardRow {
  userId: string;
  name: string;
  image?: string | null;
  xp: number;
  totalXp: number;
  level: number;
  levelTitle: string;
  isMe: boolean;
}

export interface RatingRow {
  userId: string;
  name: string;
  image?: string | null;
  rating: number;
  peakRating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  isMe: boolean;
}

export function getProgression(): Promise<ProgressionState> {
  return apiGet<ProgressionState>('/api/progression');
}

export function postEvent(
  type: string,
  amount?: number,
  meta?: Record<string, unknown>,
): Promise<EventResult> {
  return apiPost<EventResult>('/api/progression/event', { type, amount, meta });
}

export function postStats(stats: Partial<Record<AchievementStatKey, number>>): Promise<
  ProgressionState & { newlyUnlocked: string[] }
> {
  return apiPost('/api/progression/stats', { stats });
}

export function spendFreeze(): Promise<{ granted: boolean; streakFreezes: number }> {
  return apiPost('/api/progression/freeze/spend', {});
}

export function getXpLeaderboard(scope: 'global' | 'week' = 'global'): Promise<{
  scope: string;
  rows: LeaderboardRow[];
  me: LeaderboardRow | null;
}> {
  return apiGet(`/api/progression/leaderboard?scope=${scope}`);
}

export function getRatingLeaderboard(): Promise<{ rows: RatingRow[]; me: RatingRow | null }> {
  return apiGet('/api/game/leaderboard');
}

export function reportMatchResult(body: {
  roomCode: string;
  players: Array<{ userId: string; name: string; score: number }>;
  powerUps?: Record<string, number>;
}): Promise<{
  ok: boolean;
  winnerId: string;
  winnerName: string;
  iWon: boolean;
  ratings: Array<{ userId: string; name: string; score: number; ratingBefore: number; ratingAfter: number; delta: number }>;
}> {
  return apiPost('/api/game/results', body);
}

export function requestRematch(roomCode: string): Promise<{
  code: string;
  roomId: string;
  questionCount: number;
  lobbyCode: string | null;
}> {
  return apiPost('/api/game/rematch', { roomCode });
}

// ── Duels ─────────────────────────────────────────────────────────────────────

export interface DuelSummary {
  code: string;
  status: string;
  source: string;
  topic?: string | null;
  challengerName: string;
  opponentName?: string | null;
  challengerScore?: number | null;
  opponentScore?: number | null;
  winnerId?: string | null;
  createdAt: string;
  expiresAt?: string | null;
  iAmChallenger: boolean;
  myScore?: number | null;
  played: boolean;
}

export interface DuelQuestion {
  prompt: string;
  options: string[];
}

export interface DuelDetail {
  code: string;
  status: string;
  source: string;
  topic?: string | null;
  challengerId: string;
  challengerName: string;
  opponentId?: string | null;
  opponentName?: string | null;
  challengerScore?: number | null;
  opponentScore?: number | null;
  winnerId?: string | null;
  questions: DuelQuestion[];
  questionCount: number;
  iAmChallenger: boolean;
  iPlayed: boolean;
  awaitingOpponent: boolean;
  expiresAt?: string | null;
  createdAt: string;
}

export function createDuel(body: {
  source?: 'flashcards' | 'topic';
  topic?: string;
  flashcardIds?: string[];
  questionCount?: number;
}): Promise<{ code: string; questionCount: number; expiresAt: string }> {
  return apiPost('/api/duels', body);
}

export function listDuels(): Promise<DuelSummary[]> {
  return apiGet('/api/duels/mine');
}

export function getDuel(code: string): Promise<DuelDetail> {
  return apiGet(`/api/duels/${encodeURIComponent(code)}`);
}

export function answerDuel(code: string, answers: number[]): Promise<{
  ok: boolean;
  score: number;
  correct: number;
  completed: boolean;
  awaitingOpponent?: boolean;
  winnerId?: string | null;
  iWon?: boolean;
  isDraw?: boolean;
  challengerScore?: number;
  opponentScore?: number;
  myRating?: number;
  myDelta?: number;
}> {
  return apiPost(`/api/duels/${encodeURIComponent(code)}/answer`, { answers });
}

// ── Exam plans ────────────────────────────────────────────────────────────────

export interface ExamPlan {
  id: string;
  title: string;
  examDate: string;
  subjects: string[];
  dailyTarget: number;
  notes?: string | null;
  completed: boolean;
  createdAt: string;
}

export function listExamPlans(): Promise<ExamPlan[]> {
  return apiGet('/api/exams');
}

export function createExamPlan(body: {
  title: string;
  examDate: string;
  subjects?: string[];
  dailyTarget?: number;
  notes?: string;
}): Promise<ExamPlan> {
  return apiPost('/api/exams', body);
}

export function updateExamPlan(id: string, body: Partial<ExamPlan>): Promise<ExamPlan> {
  return apiPatch<ExamPlan>(`/api/exams/${encodeURIComponent(id)}`, body);
}

export function deleteExamPlan(id: string): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(`/api/exams/${encodeURIComponent(id)}`);
}

export type { Season };
