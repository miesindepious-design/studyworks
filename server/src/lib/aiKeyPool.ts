/**
 * Server-managed AI key pool.
 *
 * One API key is a single point of failure. When its project's free-tier
 * quota runs out — or the model is simply overloaded — every AI feature in
 * the app fails at the same moment and the user just sees "AI is out of
 * service". This pool holds several keys and spreads calls across them.
 *
 * How it behaves:
 *   - Selection is least-recently-used first. Free-tier quota is counted
 *     per project per day, so rotating keys spreads the day's tokens over
 *     every project instead of draining one and then failing.
 *   - A key that fails gets a cooldown and is skipped until it recovers.
 *   - A key that fails fatally (revoked, or its project has the API turned
 *     off) is dropped for the life of the process.
 *   - Keys are never logged in full — only a fingerprint, so a log line can
 *     point at a key without leaking it.
 *
 * The pool holds keys for whichever provider the server manages
 * (`AI_PROVIDER`, Gemini by default). A user who brings their own key is
 * not part of the pool: that key is theirs, and their quota is theirs.
 */

export type FailureKind =
  | 'transient'       // 500 / 502 / 504 — worth another key
  | 'rate-limited'    // 429 — quota or per-minute limit reached
  | 'overloaded'      // 503 — the model itself is busy
  | 'auth'            // 401 / 403 — the key is dead, drop it
  | 'invalid-request' // 400 for a reason the key cannot fix — stop here

export interface PoolKeyStatus {
  /** Short, non-reversible id — safe to log. */
  fingerprint: string;
  failures:     number;
  successes:    number;
  /** Epoch ms; the key is skipped until then. 0 means no cooldown. */
  cooldownUntil: number;
  dead:         boolean;
  lastUsedAt:   number;
}

/** How long a key sits out after each kind of failure, before escalation. */
const BASE_COOLDOWN_MS: Record<Exclude<FailureKind, 'auth' | 'invalid-request'>, number> = {
  transient:    10_000,
  overloaded:   20_000,
  'rate-limited': 60_000,
};

/** Escalating cooldowns stop a hard-limited key from being hammered. */
const MAX_COOLDOWN_MS = 10 * 60_000;

/** Short, stable, non-reversible id for a key. Never log the key itself. */
function fingerprint(key: string): string {
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

interface KeyState {
  key:          string;
  fingerprint:  string;
  failures:     number;
  successes:    number;
  cooldownUntil: number;
  dead:         boolean;
  lastUsedAt:   number;
}

export class AIKeyPool {
  private states: KeyState[];

  constructor(keys: string[], private readonly now: () => number = Date.now) {
    // De-duplicate, keep the order the operator listed them in.
    const seen = new Set<string>();
    this.states = [];
    for (const raw of keys) {
      const key = raw.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      this.states.push({
        key,
        fingerprint: fingerprint(key),
        failures: 0,
        successes: 0,
        cooldownUntil: 0,
        dead: false,
        lastUsedAt: 0,
      });
    }
  }

  get size(): number {
    return this.states.length;
  }

  /** True when this key belongs to the pool. */
  has(key: string): boolean {
    return this.states.some(s => s.key === key);
  }

  /** A short, non-reversible id for a key — safe to put in a log line. */
  fingerprintOf(key: string): string {
    return this.state(key)?.fingerprint ?? 'unknown';
  }

  private state(key: string): KeyState | undefined {
    return this.states.find(s => s.key === key);
  }

  /**
   * The key to use for the next call: the healthy one that has gone
   * longest without being used. Spreading calls this way is what turns
   * several keys into several times the daily quota.
   */
  preferred(): string | null {
    const now = this.now();
    const healthy = this.states.filter(s => !s.dead && s.cooldownUntil <= now);
    if (!healthy.length) return null;
    healthy.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    const chosen = healthy[0];
    chosen.lastUsedAt = now;
    return chosen.key;
  }

  /**
   * The order in which to try keys for one request.
   *
   * `preferred` comes first (it is normally the key the caller already
   * holds), then the other healthy keys least-recently-used first, and
   * finally the cooling keys — soonest to recover first — so that a total
   * outage still tries something rather than giving up immediately.
   */
  candidates(preferred?: string): string[] {
    const now = this.now();
    const alive   = this.states.filter(s => !s.dead);
    const healthy = alive.filter(s => s.cooldownUntil <= now).sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    const cooling = alive.filter(s => s.cooldownUntil > now).sort((a, b) => a.cooldownUntil - b.cooldownUntil);

    const ordered: KeyState[] = [];
    if (preferred) {
      const p = healthy.find(s => s.key === preferred);
      if (p) ordered.push(p);
    }
    for (const s of healthy) if (!ordered.includes(s)) ordered.push(s);
    for (const s of cooling) ordered.push(s);

    return ordered.map(s => s.key);
  }

  /**
   * A key to use when every healthy key is on cooldown — the one closest to
   * recovering. Trying it beats refusing the request outright.
   */
  fallbackKey(): string | null {
    const now = this.now();
    const alive = this.states.filter(s => !s.dead);
    if (!alive.length) return this.states[0]?.key ?? null;
    const cooling = alive.filter(s => s.cooldownUntil > now).sort((a, b) => a.cooldownUntil - b.cooldownUntil);
    return cooling[0]?.key ?? alive[0].key;
  }

  reportSuccess(key: string): void {
    const s = this.state(key);
    if (!s) return;
    s.successes++;
    s.failures = 0;
    s.cooldownUntil = 0;
    s.lastUsedAt = this.now();
  }

  /**
   * Record a failure and decide how long this key sits out.
   * `retryDelayMs` is the provider's own advice, when it gives one.
   */
  reportFailure(key: string, kind: FailureKind, retryDelayMs?: number): void {
    const s = this.state(key);
    if (!s) return;

    if (kind === 'auth') {
      s.dead = true;
      s.cooldownUntil = Number.MAX_SAFE_INTEGER;
      return;
    }
    if (kind === 'invalid-request') return;

    s.failures++;
    const base = BASE_COOLDOWN_MS[kind];
    const escalated = Math.min(base * Math.pow(2, s.failures - 1), MAX_COOLDOWN_MS);
    const advised = retryDelayMs && retryDelayMs > 0 ? retryDelayMs : 0;
    s.cooldownUntil = this.now() + Math.max(escalated, advised);
  }

  /** A snapshot for diagnostics. Contains no secrets. */
  status(): PoolKeyStatus[] {
    return this.states.map(s => ({
      fingerprint:   s.fingerprint,
      failures:      s.failures,
      successes:     s.successes,
      cooldownUntil: s.cooldownUntil,
      dead:          s.dead,
      lastUsedAt:    s.lastUsedAt,
    }));
  }
}

// ── The process-wide pool ─────────────────────────────────────────────────────

let cached: AIKeyPool | null = null;
let cachedSignature = '';

/**
 * Read the pool from the environment.
 *
 * `AI_API_KEYS` holds a list — one key per Google Cloud project is the
 * point, because quota is counted per project. `AI_API_KEY` is the older
 * single-key variable and is still honoured, so nothing has to change for
 * existing deployments.
 */
function poolSignature(): string {
  return `${process.env.AI_PROVIDER || 'gemini'}|${process.env.AI_API_KEYS || ''}|${process.env.AI_API_KEY || ''}`;
}

export function getServerKeyPool(): AIKeyPool {
  const signature = poolSignature();
  if (cached && cachedSignature === signature) return cached;

  const list = (process.env.AI_API_KEYS || '')
    .split(/[\s,;]+/)
    .map(s => s.trim())
    .filter(Boolean);
  const single = (process.env.AI_API_KEY || '').trim();

  const keys = single ? [...list, single] : list;

  // Start on a random key. The API runs on serverless, where every warm
  // instance keeps its own pool state — without this, every instance would
  // open with the same key and the day's quota would land on one project
  // again.
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }

  cached = new AIKeyPool(keys);
  cachedSignature = signature;
  return cached;
}

/** Drop the cached pool — used by tests that change the environment. */
export function resetServerKeyPool(): void {
  cached = null;
  cachedSignature = '';
}
