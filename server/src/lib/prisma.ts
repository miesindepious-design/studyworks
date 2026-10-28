/**
 * Prisma client singleton.
 *
 * The app talks to a hosted Postgres (Neon) over a high-latency link. Opening a
 * fresh connection costs several seconds (TCP + TLS + SCRAM), which is close to
 * Prisma's 5s connect timeout — when it overshoots, Prisma raises P1001 and the
 * request fails with a 500. A warm pool avoids that entirely: a warm query is
 * ~100ms, a cold one is ~3s.
 */
import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
  // eslint-disable-next-line no-var
  var __prismaKeepAlive: ReturnType<typeof setInterval> | undefined;
}

const KEEP_ALIVE_MS = 45_000;

// Reuse in dev to avoid exhausting DB connections on hot reload
export const prisma = global.__prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') global.__prisma = prisma;

/**
 * Keep the connection pool warm. Skipped in serverless (Vercel), where a
 * long-lived interval would keep the function alive for no benefit.
 */
function startKeepAlive(): void {
  if (global.__prismaKeepAlive || process.env.VERCEL) return;
  const timer = setInterval(() => {
    prisma.$queryRaw`SELECT 1`.catch(() => {});
  }, KEEP_ALIVE_MS);
  timer.unref?.();
  global.__prismaKeepAlive = timer;
}

// Warm the pool at boot so the first real request doesn't pay the cold cost.
prisma.$queryRaw`SELECT 1`.catch(() => {});
startKeepAlive();
