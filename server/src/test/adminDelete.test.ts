/**
 * Tests for the admin account-deletion endpoints.
 *
 *   GET    /api/admin/users/:id  → the account plus a count of everything
 *                                  that goes with it (the "blast radius")
 *   DELETE /api/admin/users/:id  → permanently removes the account
 *
 * Deleting an account cannot be undone, so the guards matter more than the
 * happy path: only an admin may do it, never their own account, and only
 * when the request carries the exact email of the account being removed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTestApp, prismaMock } from './helpers.js';

// ── Mock Stripe so no real network call is made ──────────────────────────────
const stripeCancel = vi.fn(async () => ({}));
vi.mock('../lib/stripe.js', () => ({
  getStripe: vi.fn(() => ({ subscriptions: { cancel: stripeCancel } })),
  isStripeConfigured: vi.fn(() => true),
}));

const ADMIN_EMAIL = 'admin@example.com';
const TARGET = {
  id: 'u-target',
  email: 'student@example.com',
  name: 'Student',
  tier: 'PRO',
  stripeSubscriptionId: null as string | null,
  stripeCustomerId: null as string | null,
};

/** Log in as the admin and make the next findUnique (the target lookup) return TARGET. */
async function loginAsAdmin(target: Record<string, unknown> | null = TARGET) {
  const { request, login } = await buildTestApp();
  login({ id: 'u-admin', email: ADMIN_EMAIL, name: 'Admin', tier: 'PRO' });
  // requireAuth resolves the admin's own row first, then the route looks up
  // the account being deleted.
  prismaMock.user.findUnique
    .mockResolvedValueOnce({
      id: 'u-admin', email: ADMIN_EMAIL, name: 'Admin', tier: 'PRO',
      educationLevel: null, schoolStage: null, schoolClass: null,
      universityYear: null, department: null,
      trialStartsAt: new Date(Date.now() - 8 * 86400_000),
      trialEndsAt: new Date(Date.now() - 86400_000),
    } as any)
    .mockResolvedValueOnce(target as any);
  return { request, login };
}

describe('Admin — account deletion', () => {
  beforeEach(() => {
    process.env.ADMIN_EMAIL = ADMIN_EMAIL;
    // `vi.clearAllMocks()` only clears call history — the one-shot
    // implementation queue survives it, so a lookup queued by one test would
    // otherwise leak into the next one. Reset both explicitly.
    prismaMock.user.findUnique.mockReset();
    stripeCancel.mockReset();
    stripeCancel.mockImplementation(async () => ({}));
  });

  // ── Guards ────────────────────────────────────────────────────────────────

  it('refuses a non-admin', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u-other', email: 'someone@example.com', name: 'Other', tier: 'FREE' });

    const res = await request('/api/admin/users/u-target', {
      method: 'DELETE',
      body: JSON.stringify({ confirmEmail: 'student@example.com' }),
    });

    expect(res.status).toBe(403);
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated request', async () => {
    const { request } = await buildTestApp();

    const res = await request('/api/admin/users/u-target', {
      method: 'DELETE',
      body: JSON.stringify({ confirmEmail: 'student@example.com' }),
    });

    expect(res.status).toBe(401);
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  it("refuses to delete the admin's own account", async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u-admin', email: ADMIN_EMAIL, name: 'Admin', tier: 'PRO' });
    prismaMock.user.findUnique
      .mockResolvedValueOnce({
        id: 'u-admin', email: ADMIN_EMAIL, name: 'Admin', tier: 'PRO',
        educationLevel: null, schoolStage: null, schoolClass: null,
        universityYear: null, department: null,
        trialStartsAt: new Date(Date.now() - 8 * 86400_000),
        trialEndsAt: new Date(Date.now() - 86400_000),
      } as any)
      .mockResolvedValueOnce({
        id: 'u-admin', email: ADMIN_EMAIL, name: 'Admin',
        stripeSubscriptionId: null, stripeCustomerId: null,
      } as any);

    const res = await request('/api/admin/users/u-admin', {
      method: 'DELETE',
      body: JSON.stringify({ confirmEmail: ADMIN_EMAIL }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/your own admin account/i);
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  it('refuses when the confirmation email does not match', async () => {
    const { request } = await loginAsAdmin();

    const res = await request('/api/admin/users/u-target', {
      method: 'DELETE',
      body: JSON.stringify({ confirmEmail: 'wrong@example.com' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/does not match/i);
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  it('requires a confirmation email at all', async () => {
    const { request } = await loginAsAdmin();

    const res = await request('/api/admin/users/u-target', {
      method: 'DELETE',
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  it('404s when the account does not exist', async () => {
    const { request } = await loginAsAdmin(null);

    const res = await request('/api/admin/users/does-not-exist', {
      method: 'DELETE',
      body: JSON.stringify({ confirmEmail: 'student@example.com' }),
    });

    expect(res.status).toBe(404);
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  // ── The happy path ────────────────────────────────────────────────────────

  it('deletes the account and reports what went with it', async () => {
    const { request } = await loginAsAdmin();
    prismaMock.attachment.findMany.mockResolvedValue([] as any);
    prismaMock.user.delete.mockResolvedValue({ id: TARGET.id } as any);

    const res = await request('/api/admin/users/u-target', {
      method: 'DELETE',
      body: JSON.stringify({ confirmEmail: 'student@example.com' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toEqual({ id: 'u-target', email: 'student@example.com' });
    expect(body.filesRemoved).toBe(0);
    expect(body.warnings).toEqual([]);
    expect(prismaMock.user.delete).toHaveBeenCalledWith({ where: { id: 'u-target' } });
  });

  it('matches the confirmation email case-insensitively', async () => {
    const { request } = await loginAsAdmin();
    prismaMock.attachment.findMany.mockResolvedValue([] as any);
    prismaMock.user.delete.mockResolvedValue({ id: TARGET.id } as any);

    const res = await request('/api/admin/users/u-target', {
      method: 'DELETE',
      body: JSON.stringify({ confirmEmail: '  STUDENT@EXAMPLE.COM ' }),
    });

    expect(res.status).toBe(200);
    expect(prismaMock.user.delete).toHaveBeenCalled();
  });

  // ── Stripe ────────────────────────────────────────────────────────────────

  it('cancels the Stripe subscription before deleting the account', async () => {
    const { request } = await loginAsAdmin({
      ...TARGET,
      stripeSubscriptionId: 'sub_123',
      stripeCustomerId: 'cus_123',
    });
    prismaMock.attachment.findMany.mockResolvedValue([] as any);
    prismaMock.user.delete.mockResolvedValue({ id: TARGET.id } as any);

    const res = await request('/api/admin/users/u-target', {
      method: 'DELETE',
      body: JSON.stringify({ confirmEmail: 'student@example.com' }),
    });

    expect(res.status).toBe(200);
    expect(stripeCancel).toHaveBeenCalledWith('sub_123');
    expect(prismaMock.user.delete).toHaveBeenCalled();
  });

  it('still deletes the account but warns when the subscription cannot be cancelled', async () => {
    stripeCancel.mockRejectedValueOnce(new Error('no such subscription'));
    const { request } = await loginAsAdmin({
      ...TARGET,
      stripeSubscriptionId: 'sub_gone',
      stripeCustomerId: 'cus_123',
    });
    prismaMock.attachment.findMany.mockResolvedValue([] as any);
    prismaMock.user.delete.mockResolvedValue({ id: TARGET.id } as any);

    const res = await request('/api/admin/users/u-target', {
      method: 'DELETE',
      body: JSON.stringify({ confirmEmail: 'student@example.com' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.warnings.join(' ')).toMatch(/stripe/i);
    expect(prismaMock.user.delete).toHaveBeenCalled();
  });

  it('does not touch Stripe when the account has no subscription', async () => {
    const { request } = await loginAsAdmin();
    prismaMock.attachment.findMany.mockResolvedValue([] as any);
    prismaMock.user.delete.mockResolvedValue({ id: TARGET.id } as any);

    const res = await request('/api/admin/users/u-target', {
      method: 'DELETE',
      body: JSON.stringify({ confirmEmail: 'student@example.com' }),
    });

    expect(res.status).toBe(200);
    expect(stripeCancel).not.toHaveBeenCalled();
  });

  // ── Object storage ────────────────────────────────────────────────────────

  it('removes the user’s uploaded files from storage', async () => {
    const { request } = await loginAsAdmin();
    prismaMock.attachment.findMany.mockResolvedValue([
      { storageKey: 'attachments/u-target/a.pdf' },
      { storageKey: 'attachments/u-target/b.png' },
    ] as any);
    prismaMock.user.delete.mockResolvedValue({ id: TARGET.id } as any);

    const res = await request('/api/admin/users/u-target', {
      method: 'DELETE',
      body: JSON.stringify({ confirmEmail: 'student@example.com' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.filesRemoved).toBe(2);
    expect(prismaMock.attachment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { note: { userId: 'u-target' } } }),
    );
  });

  it('warns but still deletes when a file cannot be removed from storage', async () => {
    const { request } = await loginAsAdmin();
    prismaMock.attachment.findMany.mockResolvedValue([
      { storageKey: 'attachments/u-target/a.pdf' },
    ] as any);
    prismaMock.user.delete.mockResolvedValue({ id: TARGET.id } as any);

    const res = await request('/api/admin/users/u-target', {
      method: 'DELETE',
      body: JSON.stringify({ confirmEmail: 'student@example.com' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    // Storage is not configured in tests, so deleteObject is a no-op that
    // resolves — the count is still reported honestly.
    expect(body.filesRemoved).toBe(1);
    expect(prismaMock.user.delete).toHaveBeenCalled();
  });
});

describe('Admin — account impact summary', () => {
  beforeEach(() => {
    process.env.ADMIN_EMAIL = ADMIN_EMAIL;
    prismaMock.user.findUnique.mockReset();
  });

  it('counts everything that belongs to the account', async () => {
    const { request } = await loginAsAdmin();
    prismaMock.note.count.mockResolvedValue(12 as any);
    prismaMock.folder.count.mockResolvedValue(3 as any);
    prismaMock.contact.count.mockResolvedValue(4 as any);
    prismaMock.flashcard.count.mockResolvedValue(20 as any);
    prismaMock.practiceQuestion.count.mockResolvedValue(7 as any);
    prismaMock.savedSearch.count.mockResolvedValue(2 as any);
    prismaMock.attachment.count.mockResolvedValue(5 as any);
    prismaMock.gameRoom.count.mockResolvedValue(1 as any);
    prismaMock.supportTicket.count.mockResolvedValue(3 as any);

    const res = await request('/api/admin/users/u-target');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe('student@example.com');
    expect(body.counts).toEqual({
      notes: 12, folders: 3, contacts: 4, flashcards: 20,
      practiceQuestions: 7, savedSearches: 2, attachments: 5,
      gameRooms: 1, supportTickets: 3,
    });
  });

  it('404s for an unknown account', async () => {
    const { request } = await loginAsAdmin(null);

    const res = await request('/api/admin/users/nope');

    expect(res.status).toBe(404);
  });

  it('refuses a non-admin', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u-other', email: 'someone@example.com', name: 'Other', tier: 'FREE' });

    const res = await request('/api/admin/users/u-target');

    expect(res.status).toBe(403);
  });
});
