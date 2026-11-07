/**
 * GET a URL and report whether it answered with a 2xx/3xx.
 * Never throws — a failed probe is a result, not an exception.
 */
export async function pingHealth(url, options = {}) {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const retries = options.retries ?? 1;
    const retryDelayMs = options.retryDelayMs ?? 2_000;
    let lastStatus = null;
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
        }
        catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
        }
        if (attempt < retries) {
            await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        }
    }
    return { ok: false, status: lastStatus, durationMs: 0, error: lastError };
}
