/**
 * The server-managed AI key pool.
 *
 * One key is a single point of failure: when its project runs out of quota
 * for the day — or the model is simply overloaded — every AI feature fails
 * at once and the user sees "AI is out of service". These tests pin the
 * behaviour that stops that: calls spread across keys, a busy key stepped
 * over, a dead key dropped, and a user's own key left alone.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

import { AIKeyPool, getServerKeyPool, resetServerKeyPool } from '../lib/aiKeyPool.js';
import { callProvider, ProviderError } from '../lib/aiProvider.js';

const GEMINI_REPLY = {
  candidates: [{ content: { parts: [{ text: 'All good.' }] } }],
};

/**
 * Stub fetch so each key gets its own answer.
 * `responses` maps a key to either a body (success) or an error to throw.
 */
function stubGemini(responses: Record<string, { status: number; message: string; details?: any } | 'ok'>) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    const key = String(url).split('key=')[1]?.split('&')[0] ?? '';
    calls.push(key);
    const res = responses[key] ?? 'ok';
    if (res === 'ok') {
      return { ok: true, status: 200, json: async () => GEMINI_REPLY } as any;
    }
    return {
      ok: false,
      status: res.status,
      statusText: 'stub',
      json: async () => ({ error: { message: res.message, details: res.details } }),
    } as any;
  }) as any;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const SAVED_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...SAVED_ENV };
  resetServerKeyPool();
  vi.restoreAllMocks();
});

describe('AIKeyPool', () => {
  it('spreads calls across the keys so one project does not drain', () => {
    let now = 1000;
    const pool = new AIKeyPool(['a', 'b', 'c'], () => now);

    expect(pool.preferred()).toBe('a');
    now += 10;
    expect(pool.preferred()).toBe('b');
    now += 10;
    expect(pool.preferred()).toBe('c');
    now += 10;
    // Round and round again.
    expect(pool.preferred()).toBe('a');
  });

  it('skips a key that is cooling down and comes back to it later', () => {
    let now = 1000;
    const pool = new AIKeyPool(['a', 'b'], () => now);

    pool.reportFailure('a', 'rate-limited');
    expect(pool.candidates()).toEqual(['b', 'a']);

    // Once the cooldown expires it is fair game again.
    now += 61_000;
    expect(pool.candidates()[0]).toBe('a');
  });

  it('drops a key that fails authentication for good', () => {
    const pool = new AIKeyPool(['a', 'b']);
    pool.reportFailure('a', 'auth');

    expect(pool.candidates()).toEqual(['b']);
    expect(pool.status().find(s => s.fingerprint)?.dead).toBe(true);
  });

  it('never logs the key itself', () => {
    const pool = new AIKeyPool(['AIzaSySuperSecretValue']);
    const status = pool.status()[0];
    expect(status.fingerprint).not.toContain('AIzaSy');
    expect(status.fingerprint.length).toBeGreaterThan(0);
  });

  it('reads AI_API_KEYS and the older AI_API_KEY from the environment', () => {
    process.env.AI_API_KEYS = 'key-one, key-two';
    process.env.AI_API_KEY = 'key-three';
    resetServerKeyPool();

    const pool = getServerKeyPool();
    expect(pool.size).toBe(3);
    expect(pool.has('key-one')).toBe(true);
    expect(pool.has('key-two')).toBe(true);
    // The legacy single key is folded in, not dropped.
    expect(pool.has('key-three')).toBe(true);
  });
});

describe('callProvider — key pool failover', () => {
  it('answers with the next key when the first one is crowded', async () => {
    process.env.AI_API_KEYS = 'key-a,key-b';
    resetServerKeyPool();

    const gemini = stubGemini({
      'key-a': { status: 503, message: 'The model is overloaded. Please try again later.' },
    });
    try {
      const out = await callProvider({
        provider: 'gemini',
        model: 'gemini-4-hydrogen',
        apiKey: 'key-a',
        messages: [{ role: 'user', content: 'hello' }],
      });
      expect(out).toBe('All good.');
      expect(gemini.calls).toEqual(['key-a', 'key-b']);
    } finally {
      gemini.restore();
    }
  });

  it('keeps a rate-limited key out of the way on the next request', async () => {
    process.env.AI_API_KEYS = 'key-a,key-b';
    resetServerKeyPool();

    const gemini = stubGemini({
      'key-a': { status: 429, message: 'Resource has been exhausted (e.g. check quota).' },
    });
    try {
      await callProvider({
        provider: 'gemini', model: 'm', apiKey: 'key-a',
        messages: [{ role: 'user', content: 'hello' }],
      });
      expect(gemini.calls).toEqual(['key-a', 'key-b']);

      // Second request: the exhausted key is skipped, not retried.
      gemini.calls.length = 0;
      await callProvider({
        provider: 'gemini', model: 'm', apiKey: 'key-b',
        messages: [{ role: 'user', content: 'hello again' }],
      });
      expect(gemini.calls).toEqual(['key-b']);
    } finally {
      gemini.restore();
    }
  });

  it('drops a key that fails authentication and stops using it', async () => {
    process.env.AI_API_KEYS = 'key-a,key-b';
    resetServerKeyPool();

    const gemini = stubGemini({
      'key-a': { status: 401, message: 'API key not valid. Please pass a valid API key.' },
    });
    try {
      await callProvider({
        provider: 'gemini', model: 'm', apiKey: 'key-a',
        messages: [{ role: 'user', content: 'hello' }],
      });
      expect(gemini.calls).toEqual(['key-a', 'key-b']);

      gemini.calls.length = 0;
      await callProvider({
        provider: 'gemini', model: 'm', apiKey: 'key-b',
        messages: [{ role: 'user', content: 'again' }],
      });
      expect(gemini.calls).not.toContain('key-a');
    } finally {
      gemini.restore();
    }
  });

  it('does not burn other keys when the request itself is wrong', async () => {
    process.env.AI_API_KEYS = 'key-a,key-b';
    resetServerKeyPool();

    const gemini = stubGemini({
      'key-a': { status: 400, message: 'Invalid JSON payload received. Unknown name "foo".' },
    });
    try {
      await expect(callProvider({
        provider: 'gemini', model: 'm', apiKey: 'key-a',
        messages: [{ role: 'user', content: 'hello' }],
      })).rejects.toThrow(/Gemini 400/);
      expect(gemini.calls).toEqual(['key-a']);
    } finally {
      gemini.restore();
    }
  });

  it('reports the failure when every key is busy', async () => {
    process.env.AI_API_KEYS = 'key-a,key-b';
    resetServerKeyPool();

    const gemini = stubGemini({
      'key-a': { status: 503, message: 'The model is overloaded.' },
      'key-b': { status: 503, message: 'The model is overloaded.' },
    });
    try {
      await expect(callProvider({
        provider: 'gemini', model: 'm', apiKey: 'key-a',
        messages: [{ role: 'user', content: 'hello' }],
      })).rejects.toThrow(/Gemini 503/);
      expect(gemini.calls).toEqual(['key-a', 'key-b']);
    } finally {
      gemini.restore();
    }
  });

  it("leaves a user's own key alone when no pool is configured", async () => {
    const gemini = stubGemini({
      'user-key': { status: 503, message: 'The model is overloaded.' },
    });
    try {
      await expect(callProvider({
        provider: 'gemini', model: 'm', apiKey: 'user-key',
        messages: [{ role: 'user', content: 'hello' }],
      })).rejects.toThrow(/Gemini 503/);
      expect(gemini.calls).toEqual(['user-key']);
    } finally {
      gemini.restore();
    }
  });

  it("covers a user's own key with the pool when that key is busy", async () => {
    process.env.AI_API_KEYS = 'key-a';
    resetServerKeyPool();

    const gemini = stubGemini({
      'user-key': { status: 429, message: 'Rate limit hit.' },
    });
    try {
      const out = await callProvider({
        provider: 'gemini', model: 'm', apiKey: 'user-key',
        messages: [{ role: 'user', content: 'hello' }],
      });
      expect(out).toBe('All good.');
      expect(gemini.calls).toEqual(['user-key', 'key-a']);
    } finally {
      gemini.restore();
    }
  });

  it('can be told not to cover a user key with the pool', async () => {
    process.env.AI_API_KEYS = 'key-a';
    process.env.AI_POOL_FALLBACK = '0';
    resetServerKeyPool();

    const gemini = stubGemini({
      'user-key': { status: 429, message: 'Rate limit hit.' },
    });
    try {
      await expect(callProvider({
        provider: 'gemini', model: 'm', apiKey: 'user-key',
        messages: [{ role: 'user', content: 'hello' }],
      })).rejects.toThrow(/Gemini 429/);
      expect(gemini.calls).toEqual(['user-key']);
    } finally {
      gemini.restore();
    }
  });

  it('carries the status and kind on the error it throws', async () => {
    const gemini = stubGemini({
      'user-key': { status: 429, message: 'Rate limit hit.' },
    });
    try {
      await expect(callProvider({
        provider: 'gemini', model: 'm', apiKey: 'user-key',
        messages: [{ role: 'user', content: 'hello' }],
      })).rejects.toBeInstanceOf(ProviderError);
    } finally {
      gemini.restore();
    }
  });

  it('falls back to another model when every key fails on the first one', async () => {
    process.env.AI_API_KEYS = 'key-a';
    process.env.AI_FALLBACK_MODELS = 'gemini-2.5-flash';
    resetServerKeyPool();

    const models: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      const model = /models\/([^:]+):/.exec(u)?.[1] ?? '';
      models.push(model);
      if (model === 'gemini-4-hydrogen') {
        return {
          ok: false, status: 503, statusText: 'stub',
          json: async () => ({ error: { message: 'The model is overloaded.' } }),
        } as any;
      }
      return { ok: true, status: 200, json: async () => GEMINI_REPLY } as any;
    }) as any;

    try {
      const out = await callProvider({
        provider: 'gemini', model: 'gemini-4-hydrogen', apiKey: 'key-a',
        messages: [{ role: 'user', content: 'hello' }],
      });
      expect(out).toBe('All good.');
      expect(models).toEqual(['gemini-4-hydrogen', 'gemini-2.5-flash']);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("honours Gemini's own advice about how long to wait", async () => {
    process.env.AI_API_KEYS = 'key-a,key-b';
    resetServerKeyPool();

    const gemini = stubGemini({
      // Gemini says "come back in 45 seconds" — longer than our own guess.
      'key-a': { status: 503, message: 'The model is overloaded.', details: [{ retryDelay: '45s' }] },
    });
    try {
      const before = Date.now();
      await callProvider({
        provider: 'gemini', model: 'm', apiKey: 'key-a',
        messages: [{ role: 'user', content: 'hello' }],
      });
      const status = getServerKeyPool().status();
      expect(status).toHaveLength(2);
      // The failed key sits out for at least the 45s Gemini asked for.
      const cooled = status.find(s => s.cooldownUntil > before);
      expect(cooled).toBeDefined();
      expect(cooled!.cooldownUntil - before).toBeGreaterThanOrEqual(44_000);
    } finally {
      gemini.restore();
    }
  });

  it('never writes a key to the log when it fails over', async () => {
    process.env.AI_API_KEYS = 'super-secret-key-a,super-secret-key-b';
    resetServerKeyPool();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gemini = stubGemini({
      'super-secret-key-a': { status: 503, message: 'The model is overloaded.' },
    });
    try {
      await callProvider({
        provider: 'gemini', model: 'm', apiKey: 'super-secret-key-a',
        messages: [{ role: 'user', content: 'hello' }],
      });
      const logged = warn.mock.calls.map(c => c.join(' ')).join('\n');
      expect(logged).toContain('failed (overloaded)');
      expect(logged).not.toContain('super-secret-key-a');
      expect(logged).not.toContain('super-secret-key-b');
    } finally {
      gemini.restore();
    }
  });
});
