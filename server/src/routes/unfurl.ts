/**
 * /api/unfurl — fetch a URL server-side and extract metadata for "Save from URL".
 *
 * The client can't fetch arbitrary pages (CORS), so the server does it and
 * returns { title, description, image, siteName, url, kind }.
 *
 * kind is detected for special sources:
 *   - youtube: uses the oEmbed endpoint (no API key needed)
 *   - twitter/x: uses the public syndication oEmbed (best effort)
 *   - generic: parses OpenGraph/meta tags out of the HTML
 *
 * SSRF guard: only http/https, no localhost/private-IP hosts.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../lib/session.js';

export const unfurlRouter = new Hono();
unfurlRouter.use('*', requireAuth);

const Body = z.object({ url: z.string().url().max(2048) });

const PRIVATE_HOST = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.0\.0\.0|\[::1\]|169\.254\.)/i;

function extractMeta(html: string, name: string): string | null {
  // property="og:title" content="..."  OR  name="twitter:title" content="..."
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i');
  const alt = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${name}["']`, 'i');
  return html.match(re)?.[1] ?? html.match(alt)?.[1] ?? null;
}

function decodeEntities(s: string | null): string | null {
  if (!s) return s;
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");
}

unfurlRouter.post('/', zValidator('json', Body), async c => {
  const { url } = c.req.valid('json');
  const parsed = new URL(url);

  if (!/^https?:$/.test(parsed.protocol)) return c.json({ error: 'Only http/https URLs' }, 400);
  if (PRIVATE_HOST.test(parsed.hostname))  return c.json({ error: 'Host not allowed' }, 400);

  const host = parsed.hostname.replace(/^www\./, '');

  try {
    // ── YouTube: oEmbed (no key, reliable) ──────────────────────────────────
    if (host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com') {
      const oembed = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
        { signal: AbortSignal.timeout(8000) });
      if (oembed.ok) {
        const d = await oembed.json() as any;
        return c.json({
          kind: 'youtube', url,
          title: d.title ?? 'YouTube video',
          description: `Video by ${d.author_name ?? 'unknown'}`,
          image: d.thumbnail_url ?? null,
          siteName: 'YouTube',
        });
      }
    }

    // ── Twitter/X: syndication oEmbed (best effort, no key) ─────────────────
    if (host === 'twitter.com' || host === 'x.com') {
      const oembed = await fetch(
        `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=1`,
        { signal: AbortSignal.timeout(8000) });
      if (oembed.ok) {
        const d = await oembed.json() as any;
        // html is a blockquote; strip tags for description
        const text = (d.html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return c.json({
          kind: 'twitter', url,
          title: `Post by ${d.author_name ?? 'unknown'}`,
          description: text.slice(0, 500) || null,
          image: null,
          siteName: 'X (Twitter)',
        });
      }
    }

    // ── Generic: fetch page, parse OG tags ──────────────────────────────────
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'StudyWorksBot/1.0 (+https://studyworks.app)' },
      redirect: 'follow',
    });
    if (!res.ok) return c.json({ error: `Fetch failed (${res.status})` }, 502);

    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('text/html')) {
      return c.json({ kind: 'file', url, title: parsed.pathname.split('/').pop() || url, description: ct, image: null, siteName: host });
    }

    // Read at most 512KB — OG tags live in <head>
    const html = (await res.text()).slice(0, 512 * 1024);

    const title = decodeEntities(
      extractMeta(html, 'og:title') ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? null);
    const description = decodeEntities(
      extractMeta(html, 'og:description') ?? extractMeta(html, 'description'));
    const image    = extractMeta(html, 'og:image');
    const siteName = decodeEntities(extractMeta(html, 'og:site_name')) ?? host;

    return c.json({ kind: 'article', url, title: title ?? url, description, image, siteName });
  } catch (err: any) {
    const msg = err?.name === 'TimeoutError' ? 'Fetch timed out' : 'Could not fetch URL';
    return c.json({ error: msg }, 502);
  }
});
