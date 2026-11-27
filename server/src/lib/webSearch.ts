/**
 * webSearch.ts — Tavily web search, used as a function-calling tool by the
 * AI Tutor.
 *
 * Design decisions:
 *
 *   - Only snippets and URLs are used. No page scraping.
 *   - Results are cached in memory for 24 h so repeated questions on the
 *     same topic don't burn the free quota.
 *   - A per-user rate limit (10 searches/hour) and a monthly counter
 *     (stop at 900 of 1000) guard the free plan.
 *   - Every call is logged (level, search count, response time) so we can
 *     tune the thresholds later. No personal student data is logged.
 *   - Any failure — network error, bad key, quota exhausted — returns an
 *     empty array so the tutor falls back to its own knowledge silently.
 */

/** One search result handed to the tutor as context. */
export interface SearchResult {
  title:   string;
  url:     string;
  snippet: string;
  /** Domain extracted from url, shown in the Sources panel. */
  domain:  string;
}

/** The full output of one web_search call. */
export interface SearchOutput {
  query:   string;
  results: SearchResult[];
  /** True when the results came from the 24h cache (no API credit used). */
  cached:  boolean;
}

// ── In-memory cache ───────────────────────────────────────────────────────────
// Key: lowercased, trimmed query. Value: results + expiry.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry {
  results:   SearchResult[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheGet(query: string): SearchResult[] | null {
  const key   = query.toLowerCase().trim();
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.results;
}

function cacheSet(query: string, results: SearchResult[]): void {
  cache.set(query.toLowerCase().trim(), { results, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ── Monthly usage counter ─────────────────────────────────────────────────────
// Free plan: 1 000 credits/month. We stop at 900 to leave headroom.
const FREE_MONTHLY_LIMIT  = 1000;
const MONTHLY_STOP_AT     = 900;

interface MonthlyCounter { month: string; count: number }
let monthlyCounter: MonthlyCounter = { month: '', count: 0 };

function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function incrementMonthly(): boolean {
  const m = currentMonth();
  if (monthlyCounter.month !== m) {
    monthlyCounter = { month: m, count: 0 };
  }
  if (monthlyCounter.count >= MONTHLY_STOP_AT) return false; // quota guard
  monthlyCounter.count++;
  return true;
}

export function monthlySearchStats(): { month: string; used: number; limit: number; stopAt: number } {
  return {
    month:  currentMonth(),
    used:   monthlyCounter.count,
    limit:  FREE_MONTHLY_LIMIT,
    stopAt: MONTHLY_STOP_AT,
  };
}

// ── Per-user rate limit ───────────────────────────────────────────────────────
// 10 searches per user per hour.
const USER_RATE_LIMIT    = 10;
const USER_RATE_WINDOW   = 60 * 60 * 1000; // 1 hour

interface UserWindow { resets: number; count: number }
const userWindows = new Map<string, UserWindow>();

function checkUserRate(userId: string): boolean {
  const now = Date.now();
  let w = userWindows.get(userId);
  if (!w || now > w.resets) {
    w = { resets: now + USER_RATE_WINDOW, count: 0 };
  }
  if (w.count >= USER_RATE_LIMIT) return false;
  w.count++;
  userWindows.set(userId, w);
  return true;
}

// ── Domain extraction ────────────────────────────────────────────────────────
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// ── Logging ───────────────────────────────────────────────────────────────────
export interface SearchLogEntry {
  at:            string;    // ISO timestamp
  level:         1 | 2 | 3;
  searchCount:   number;
  responseMs:    number;
  cacheHits:     number;
  queriesUsed:   string[];  // trimmed queries, no student content
}

/** Call this once per tutor reply that used search. */
export function logSearchUsage(entry: SearchLogEntry): void {
  // Simple structured log — adapt to your log aggregator if needed.
  console.log(
    `[tutor-search] level=${entry.level} searches=${entry.searchCount} ` +
    `cacheHits=${entry.cacheHits} responseMs=${entry.responseMs}ms ` +
    `queries=${JSON.stringify(entry.queriesUsed)}`,
  );
}

// ── Tavily call ───────────────────────────────────────────────────────────────
const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
const TAVILY_TIMEOUT  = 8000; // ms — if search hangs, the tutor should not wait

export async function tavilySearch(query: string, maxResults = 5): Promise<SearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TAVILY_TIMEOUT);

  try {
    const res = await fetch(TAVILY_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key:        apiKey,
        query,
        search_depth:   'basic',   // 'basic' costs 1 credit; 'advanced' costs 2
        include_answer: false,     // we want sources, not an AI-generated summary
        max_results:    maxResults,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      console.warn(`[webSearch] Tavily ${res.status}: ${await res.text().catch(() => '')}`);
      return [];
    }

    const data = await res.json();
    const raw: any[] = data?.results ?? [];
    return raw
      .filter(r => r.url && r.title)
      .map(r => ({
        title:   String(r.title   || '').slice(0, 200),
        url:     String(r.url     || ''),
        snippet: String(r.content || r.snippet || '').slice(0, 500),
        domain:  extractDomain(String(r.url || '')),
      }));
  } catch (err: any) {
    clearTimeout(timer);
    if (err?.name === 'AbortError') {
      console.warn('[webSearch] Tavily timed out');
    } else {
      console.warn('[webSearch] Tavily error:', err?.message ?? err);
    }
    return [];
  }
}

// ── Public entry point ────────────────────────────────────────────────────────
/**
 * Run a web search, respecting the cache, the monthly quota and the per-user
 * rate limit. Returns an empty array (never throws) so the tutor always has
 * a fallback.
 *
 * @param userId   Used for per-user rate limiting. Never logged.
 * @param query    The search string the model generated.
 * @param maxResults  How many results to return (3-5 is enough for context).
 */
export async function webSearch(
  userId:     string,
  query:      string,
  maxResults = 5,
): Promise<SearchOutput> {
  const trimmed = query.trim();
  if (!trimmed) return { query: trimmed, results: [] };

  // 1. Cache hit — free and instant.
  const cached = cacheGet(trimmed);
  if (cached) {
    return { query: trimmed, results: cached, cached: true };
  }

  // 2. Guard: monthly quota.
  if (!incrementMonthly()) {
    console.warn('[webSearch] Monthly quota reached — falling back to no-search');
    return { query: trimmed, results: [], cached: false };
  }

  // 3. Guard: per-user rate limit.
  if (!checkUserRate(userId)) {
    console.warn(`[webSearch] User rate limit reached for user (redacted)`);
    // Roll back the monthly counter we just incremented.
    monthlyCounter.count = Math.max(0, monthlyCounter.count - 1);
    return { query: trimmed, results: [], cached: false };
  }

  const results = await tavilySearch(trimmed, maxResults);
  if (results.length > 0) cacheSet(trimmed, results);
  return { query: trimmed, results, cached: false };
}
