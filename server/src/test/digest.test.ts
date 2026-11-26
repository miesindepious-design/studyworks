/**
 * Tests for the weekly email digest.
 *
 * Three layers are proven here:
 *
 *   1. the wording (pure — `lib/digest.ts`): a week with nothing in it must
 *      not read like a scolding, and the subject must be worth opening;
 *   2. the route: opting in and out, and the secret on the weekly run;
 *   3. the run itself: only opted-in users whose day is today get mail, and
 *      a retried run never sends a second copy.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildTestApp, prismaMock } from './helpers.js';
import { buildDigest, digestSubject, digestText, type DigestInput } from '../lib/digest.js';
import { runWeeklyDigest, gatherDigest } from '../lib/digestRunner.js';

const INPUT: DigestInput = {
  name: 'Sam',
  rangeStart: '2026-11-19',
  rangeEnd: '2026-11-25',
  cardsReviewed: 42,
  cardsCreated: 3,
  notesCreated: 2,
  xpEarned: 130,
  level: 5,
  currentStreak: 6,
  longestStreak: 11,
  cardsDue: 18,
  notesDue: 4,
  settingsUrl: 'https://studyworks.app/settings',
};

const QUIET: DigestInput = {
  ...INPUT,
  name: null,
  cardsReviewed: 0,
  cardsCreated: 0,
  notesCreated: 0,
  xpEarned: 0,
  currentStreak: 0,
  cardsDue: 0,
  notesDue: 0,
};

describe('digest wording', () => {
  it('puts the headline in the subject', () => {
    expect(digestSubject(INPUT)).toContain('42 cards reviewed');
  });

  it('says something worth opening for a quiet week', () => {
    // A wall of zeros is worse than no email — say it plainly instead.
    expect(digestSubject(QUIET)).toContain('nothing due, nothing missed');
  });

  it('lists what the student did', () => {
    const text = digestText(INPUT);
    expect(text).toContain('42 cards reviewed');
    expect(text).toContain('130 XP earned');
    expect(text).toContain('6-day streak');
  });

  it('says what is waiting', () => {
    const text = digestText(INPUT);
    expect(text).toContain('18 cards due for review');
    expect(text).toContain('4 notes due for recall');
  });

  it('does not shame a student for a quiet week', () => {
    const text = digestText(QUIET);
    expect(text).toContain('Nothing yet this week.');
    expect(text).not.toContain('failed');
    expect(text).not.toContain('you should');
  });

  it('greets by name when there is one', () => {
    expect(digestText(INPUT)).toContain('Hi Sam,');
    expect(digestText(QUIET)).toContain('Hi,');
  });

  it('always says how to turn it off', () => {
    expect(digestText(INPUT)).toContain('Turn this email off');
  });

  it('escapes HTML so a name cannot break the email', () => {
    const html = buildDigest({ ...INPUT, name: '<script>alert(1)</script>' }).html;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('produces a plain-text body too', () => {
    const content = buildDigest(INPUT);
    expect(content.text).toContain('Sam');
    expect(content.html).toContain('Sam');
    expect(content.subject).toBeTruthy();
  });
});

describe('GET /api/digest/preferences', () => {
  it('returns the saved preference', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });
    // `login()` sets the mocked user row, so the digest fields have to be
    // added afterwards — otherwise the session row wins.
    prismaMock.user.findUnique.mockResolvedValue({
      digestEnabled: true, digestDay: 3, digestLastSentAt: null,
    } as any);
    const res = await request('/api/digest/preferences');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.day).toBe(3);
  });

  it('needs a session', async () => {
    const { request } = await buildTestApp();
    const res = await request('/api/digest/preferences');
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/digest/preferences', () => {
  it('turns the digest on', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });
    prismaMock.user.update.mockResolvedValue({} as any);
    const res = await request('/api/digest/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ enabled: true, day: 5 }),
    });
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ digestEnabled: true, digestDay: 5 }),
      }),
    );
  });

  it('turns the digest off', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });
    prismaMock.user.update.mockResolvedValue({} as any);
    const res = await request('/api/digest/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ digestEnabled: false }),
      }),
    );
  });

  it('rejects an impossible day', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });
    const res = await request('/api/digest/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ enabled: true, day: 9 }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/digest/run', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    prismaMock.user.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('refuses without the secret', async () => {
    process.env.DIGEST_SECRET = 'the-secret';
    const { request } = await buildTestApp();
    const res = await request('/api/digest/run', { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('refuses when the secret is not configured at all', async () => {
    delete process.env.DIGEST_SECRET;
    const { request } = await buildTestApp();
    const res = await request('/api/digest/run', {
      method: 'POST',
      headers: { 'x-digest-secret': 'anything' },
    });
    expect(res.status).toBe(403);
  });

  it('runs with the right secret', async () => {
    process.env.DIGEST_SECRET = 'the-secret';
    const { request } = await buildTestApp();
    const res = await request('/api/digest/run', {
      method: 'POST',
      headers: { 'x-digest-secret': 'the-secret' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.candidates).toBe(0);
  });
});

describe('runWeeklyDigest', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    prismaMock.user.findMany.mockResolvedValue([]);
    prismaMock.user.findUnique.mockResolvedValue({
      name: 'Sam', email: 'sam@example.com', digestEnabled: true,
      digestDay: 1, digestLastSentAt: null,
    } as any);
    prismaMock.streak.findUnique.mockResolvedValue({
      dailyCounts: {}, currentStreak: 0, longestStreak: 0,
    } as any);
    prismaMock.userProgress.findUnique.mockResolvedValue({
      xp: 0, level: 1, dailyXp: {},
    } as any);
    prismaMock.flashcard.count.mockResolvedValue(0);
    prismaMock.note.count.mockResolvedValue(0);
    prismaMock.user.update.mockResolvedValue({} as any);
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('only considers users who opted in', async () => {
    await runWeeklyDigest(new Date('2026-11-23T09:00:00Z'));
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ digestEnabled: true }),
      }),
    );
  });

  it('only considers users whose chosen day is today', async () => {
    await runWeeklyDigest(new Date('2026-11-23T09:00:00Z'));
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ digestDay: new Date('2026-11-23T09:00:00Z').getDay() }),
      }),
    );
  });

  it('skips a user whose digest already went out today', async () => {
    const now = new Date('2026-11-23T09:00:00Z');
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'u1', email: 'a@b.com', digestLastSentAt: new Date('2026-11-23T07:00:00Z') },
    ] as any);
    const result = await runWeeklyDigest(now);
    expect(result.skipped).toBe(1);
    expect(result.sent).toBe(0);
  });

  it('counts a user who has never been sent one as a candidate', async () => {
    const now = new Date('2026-11-23T09:00:00Z');
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'u1', email: 'a@b.com', digestLastSentAt: null },
    ] as any);
    const result = await runWeeklyDigest(now);
    expect(result.candidates).toBe(1);
  });
});

describe('gatherDigest', () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue({ name: 'Sam', email: 'a@b.com' } as any);
    prismaMock.streak.findUnique.mockResolvedValue({
      dailyCounts: { '2026-11-20': 10, '2026-11-21': 5, '2026-10-01': 99 },
      currentStreak: 3, longestStreak: 9,
    } as any);
    prismaMock.userProgress.findUnique.mockResolvedValue({
      xp: 500, level: 4, dailyXp: { '2026-11-20': 40 },
    } as any);
    prismaMock.flashcard.count.mockResolvedValue(0);
    prismaMock.note.count.mockResolvedValue(0);
  });

  it('sums the week and ignores older days', async () => {
    const now = new Date('2026-11-21T12:00:00Z');
    const digest = await gatherDigest('u1', now);
    // 2026-10-01 is outside the seven-day window and must not be counted.
    expect(digest.cardsReviewed).toBe(15);
    expect(digest.xpEarned).toBe(40);
    expect(digest.currentStreak).toBe(3);
    expect(digest.longestStreak).toBe(9);
    expect(digest.level).toBe(4);
  });

  it('covers seven days', async () => {
    const now = new Date('2026-11-21T12:00:00Z');
    const digest = await gatherDigest('u1', now);
    expect(digest.rangeEnd).toBe('2026-11-21');
    expect(digest.rangeStart).toBe('2026-11-15');
  });
});
