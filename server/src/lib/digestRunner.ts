/**
 * digestRunner — the weekly run, as a plain function.
 *
 * It lives outside the route on purpose: the cron job runs it in-process
 * (no HTTP, no session, no round trip) and the HTTP trigger calls exactly
 * the same function, so there is only one behaviour to reason about.
 */
import { prisma } from './prisma.js';
import { buildDigest, type DigestInput } from './digest.js';
import { isoDate } from './progressionRules.js';

/** The day names, in the order the database stores them. */
export const DIGEST_DAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const;

// ── Gathering the numbers ──────────────────────────────────────────────────────

/** The days of the week the digest covers, oldest first. */
export function weekDays(now: Date, days = 7): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    out.push(isoDate(d));
  }
  return out;
}

/** Sum the counts a daily map holds over a set of days. */
function sumOver(map: unknown, days: string[]): number {
  if (!map || typeof map !== 'object') return 0;
  const rec = map as Record<string, unknown>;
  let total = 0;
  for (const day of days) {
    const v = rec[day];
    if (typeof v === 'number' && Number.isFinite(v)) total += v;
  }
  return total;
}

/**
 * Collect everything the digest needs about one student.
 *
 * Reviews come from the streak's daily counts and XP from the progress
 * record's daily XP — both are already per-day maps, so a week is a sum
 * over seven keys rather than a scan of every review ever done.
 */
export async function gatherDigest(userId: string, now = new Date()): Promise<DigestInput> {
  const days = weekDays(now);
  const rangeStart = days[0];
  const rangeEnd = days[days.length - 1];
  const weekStart = new Date(`${rangeStart}T00:00:00.000Z`);
  const weekEnd = new Date(`${rangeEnd}T23:59:59.999Z`);

  const [user, streak, progress, cardsCreated, notesCreated, cardsDue, notesDue] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
    prisma.streak.findUnique({ where: { userId }, select: { dailyCounts: true, currentStreak: true, longestStreak: true } }),
    prisma.userProgress.findUnique({ where: { userId }, select: { xp: true, level: true, dailyXp: true } }),
    prisma.flashcard.count({ where: { userId, createdAt: { gte: weekStart, lte: weekEnd } } }),
    prisma.note.count({ where: { userId, createdAt: { gte: weekStart, lte: weekEnd } } }),
    prisma.flashcard.count({ where: { userId, nextReview: { not: null, lte: now } } }),
    prisma.note.count({ where: { userId, nextReview: { not: null, lte: now } } }),
  ]);

  return {
    name: user?.name ?? null,
    rangeStart,
    rangeEnd,
    cardsReviewed: sumOver(streak?.dailyCounts, days),
    cardsCreated,
    notesCreated,
    xpEarned: sumOver(progress?.dailyXp, days),
    level: progress?.level ?? 1,
    currentStreak: streak?.currentStreak ?? 0,
    longestStreak: streak?.longestStreak ?? 0,
    cardsDue,
    notesDue,
    settingsUrl: process.env.FRONTEND_URL
      ? `${process.env.FRONTEND_URL.replace(/\/$/, '')}/settings`
      : 'https://studyworks.app/settings',
  };
}

// ── Sending ────────────────────────────────────────────────────────────────────

/** Whether the server can actually send email. */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/**
 * Send one digest. Returns false when email is not configured, so the
 * caller can say "we could not send that" instead of pretending it worked.
 */
export async function sendDigest(
  to: string,
  content: { subject: string; text: string; html: string },
): Promise<boolean> {
  if (!isEmailConfigured()) return false;
  const { Resend } = await import('resend');
  const resend = new Resend(process.env.RESEND_API_KEY!);
  await resend.emails.send({
    from: process.env.EMAIL_FROM || 'StudyWorks <noreply@studyworks.app>',
    to,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });
  return true;
}

/** Send one user's digest, and stamp when it went out. */
export async function sendDigestFor(userId: string, email: string, now = new Date()): Promise<boolean> {
  const input = await gatherDigest(userId, now);
  const content = buildDigest(input);
  const sent = await sendDigest(email, content);
  if (sent) {
    await prisma.user.update({
      where: { id: userId },
      data: { digestLastSentAt: now },
    });
  }
  return sent;
}

// ── The weekly run ─────────────────────────────────────────────────────────────

export interface DigestRunResult {
  /** How many opted-in users were due today. */
  candidates: number;
  sent: number;
  /** Skipped because a digest already went out today. */
  skipped: number;
  failed: number;
}

/**
 * Send the digest to everybody who opted in and whose chosen day is today.
 *
 * A user whose digest already went out today is skipped — a retried run
 * must never send a second copy, because "you reviewed 12 cards" twice in
 * one morning is how a student learns to ignore the email.
 */
export async function runWeeklyDigest(now = new Date()): Promise<DigestRunResult> {
  const today = now.getDay();

  const users = await prisma.user.findMany({
    where: { digestEnabled: true, digestDay: today },
    select: { id: true, email: true, digestLastSentAt: true },
  });

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const u of users) {
    if (u.digestLastSentAt && u.digestLastSentAt.toDateString() === now.toDateString()) {
      skipped++;
      continue;
    }
    try {
      const ok = await sendDigestFor(u.id, u.email, now);
      if (ok) sent++; else failed++;
    } catch {
      failed++;
    }
  }

  return { candidates: users.length, sent, skipped, failed };
}
