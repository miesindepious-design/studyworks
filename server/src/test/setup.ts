/**
 * Test setup — provides a mocked Prisma client + Better Auth so the
 * Hono app can be tested without a live database.
 *
 * Each test file gets a fresh `prismaMock` via `vi.mocked(prisma)`.
 * `auth.api.getSession` is stubbed to read a `__testUser` global
 * that tests can set per-request via a mock cookie.
 */
import { vi } from 'vitest';

// ── Mutable test state per test file ──────────────────────────────────────────
declare global {
  // eslint-disable-next-line no-var
  var __testUser: { id: string; email: string; name: string | null; tier: 'FREE' | 'PRO' } | null;
  // eslint-disable-next-line no-var
  var __testSession: { id: string; userId: string; expiresAt: Date } | null;
}

globalThis.__testUser = null;
globalThis.__testSession = null;

// ── Mock Prisma ──────────────────────────────────────────────────────────────
export const prismaMock = {
  $transaction: vi.fn(async (fn: any) => fn(prismaMock)),
  note:             { findMany: vi.fn(), upsert: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
  contact:          { findMany: vi.fn(), upsert: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
  flashcard:        { findMany: vi.fn(), upsert: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
  folder:           { findMany: vi.fn(), upsert: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
  practiceQuestion: { findMany: vi.fn(), upsert: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
  savedSearch:      { findMany: vi.fn(), upsert: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
  aISettings:       { findUnique: vi.fn(), upsert: vi.fn() },
  user:             { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  highlight:        { findMany: vi.fn(), create: vi.fn(), delete: vi.fn() },
  personalNote:     { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  attachment:       { findMany: vi.fn(), create: vi.fn(), delete: vi.fn() },
};

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }));

// ── Mock Better Auth ─────────────────────────────────────────────────────────
vi.mock('../lib/auth.js', () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => {
        if (!globalThis.__testUser || !globalThis.__testSession) return null;
        return { user: globalThis.__testUser, session: globalThis.__testSession };
      }),
    },
    handler: vi.fn(),
  },
}));

// ── Mock env vars required at module load ────────────────────────────────────
process.env.BETTER_AUTH_SECRET = 'test-secret';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_dummy';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.FRONTEND_URL = 'http://localhost:5173';

// Reset between tests
afterEach(() => {
  vi.clearAllMocks();
  globalThis.__testUser = null;
  globalThis.__testSession = null;
});
