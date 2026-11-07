/**
 * Cron entrypoint for the Render keep-alive job.
 *
 * Render cron jobs run `startCommand` on a schedule and exit when the
 * command finishes. A non-zero exit marks the run as failed, which is what
 * we want when the voice service is unreachable.
 *
 * Config:
 *   VOICE_HEALTH_URL        full URL to ping (default: local voice server)
 *   VOICE_HEALTH_TIMEOUT_MS per-attempt timeout in ms
 *   VOICE_HEALTH_RETRIES    extra attempts after the first failure
 */
import { pingHealth } from './lib/keepalive.js';

const url = process.env.VOICE_HEALTH_URL || 'http://127.0.0.1:3002/health';
const timeoutMs = Number(process.env.VOICE_HEALTH_TIMEOUT_MS) || 10_000;
const retries = Number(process.env.VOICE_HEALTH_RETRIES ?? 1);

const result = await pingHealth(url, { timeoutMs, retries });

console.log(
  JSON.stringify({
    url,
    ok: result.ok,
    status: result.status,
    durationMs: result.durationMs,
    error: result.error,
    at: new Date().toISOString(),
  }),
);

process.exit(result.ok ? 0 : 1);
