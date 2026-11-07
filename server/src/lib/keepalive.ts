/**
 * Keep-alive probe for the Render-hosted voice signaling service.
 *
 * WHY: Render free web services spin down after 15 minutes without inbound
 * traffic. The first real voice connection after that would otherwise wait
 * for a cold start (~1 minute). A scheduled cron job pings /health so the
 * service stays warm and we get an early warning when it is down.
 */
export interface KeepAliveResult {
  ok: boolean;
  status: number | null;
  durationMs: number;
  error?: string;
}

export interface KeepAliveOptions {
  /** Per-attempt timeout. */
  timeoutMs?: number;
  /** Extra attempts after the first one fails. */
  retries?: number;
  /** Delay between attempts. */
  retryDelayMs?: number;
}

/**
 * GET a URL and report whether it answered with a 2xx/3xx.
 * Never throws — a failed probe is a result, not an exception.
 */
export async function pingHealth(url: string, options: KeepAliveOptions = {}): Promise<KeepAliveResult> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const retries = options.retries ?? 1;
  const retryDelayMs = options.retryDelayMs ?? 2_000;

  let lastStatus: number | null = null;
  let lastError = 'unknown error';

  for (let attempt = 0; attempt <= retries; attempt++) {
    const started = Date.now();
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': 'studyworks-keepalive' },
      });
      lastStatus = res.status;
      if (res.ok) {
        return { ok: true, status: res.status, durationMs: Date.now() - started };
      }
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    if (attempt < retries) {
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
  }

  return { ok: false, status: lastStatus, durationMs: 0, error: lastError };
}
