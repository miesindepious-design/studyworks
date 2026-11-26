/**
 * Cron entrypoint for the weekly digest.
 *
 * Render (and most cron hosts) run a command on a schedule and exit when it
 * finishes. This script connects to the database directly and sends the
 * digest to everyone who opted in and whose chosen day is today — no HTTP,
 * no session, no round trip.
 *
 * A non-zero exit marks the run as failed, which is what a cron host needs
 * to see when something went wrong.
 *
 * Config:
 *   DATABASE_URL   the database (already required by Prisma)
 *   EMAIL_FROM     the sender address
 */
import { runWeeklyDigest } from './lib/digestRunner.js';

try {
  const result = await runWeeklyDigest(new Date());
  console.log(JSON.stringify({ ok: true, at: new Date().toISOString(), ...result }));
  // A run where every send failed is a failed run, even though the script
  // itself completed.
  process.exit(result.failed > 0 && result.sent === 0 ? 1 : 0);
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: (e as Error).message }));
  process.exit(1);
}
