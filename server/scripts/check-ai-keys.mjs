// Check every server-managed AI key and report which ones are usable.
//
// Run it after adding keys to server/.env (or the shell):
//   npm run keys:check --prefix server
//
// It makes one tiny call per key — a few tokens each — and says plainly
// which keys are good, which are out of quota, and which are invalid.
// Keys are never printed: each one is identified by a short fingerprint,
// the same one the server logs use.
//
// Exit code is 1 if any key is unusable, so it can gate a deploy.

import 'dotenv/config';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';

const serverDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
dotenv.config({ path: path.join(serverDir, '.env') });

const MODEL = process.env.AI_MODEL?.trim() || 'gemini-4-hydrogen';
const PROVIDER = (process.env.AI_PROVIDER || 'gemini').trim();

/** Short, non-reversible id — the key itself never reaches the screen. */
function fingerprint(key) {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

function readKeys() {
  const list = (process.env.AI_API_KEYS || '')
    .split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
  const single = (process.env.AI_API_KEY || '').trim();
  const seen = new Set();
  const keys = [];
  for (const k of [...list, ...(single ? [single] : [])]) {
    if (!k || seen.has(k)) continue;
    seen.add(k);
    keys.push(k);
  }
  return keys;
}

function classify(status, message) {
  const lower = (message || '').toLowerCase();
  if (status === 429) {
    if (lower.includes('quota') || lower.includes('exhausted')) return 'OUT OF QUOTA';
    return 'RATE LIMITED';
  }
  if (status === 503) return 'MODEL OVERLOADED';
  if (status === 500 || status === 502 || status === 504) return 'TEMPORARY ERROR';
  if (status === 401 || status === 403) return 'INVALID KEY';
  if (status === 400) {
    if (lower.includes('api key')) return 'INVALID KEY';
    return 'BAD REQUEST';
  }
  return `ERROR ${status}`;
}

async function checkKey(key) {
  if (PROVIDER !== 'gemini') {
    return { state: 'SKIPPED', detail: `no probe for provider "${PROVIDER}"` };
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Reply with exactly: OK' }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 32,
          ...(/^gemini-4/i.test(MODEL) ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
        },
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      return { state: 'OK', detail: text.slice(0, 40) };
    }
    const body = await res.json().catch(() => ({}));
    return { state: classify(res.status, body?.error?.message), detail: (body?.error?.message ?? res.statusText).slice(0, 90) };
  } catch (err) {
    return { state: 'NETWORK ERROR', detail: String(err?.message ?? err).slice(0, 90) };
  }
}

const keys = readKeys();

if (!keys.length) {
  console.log('No keys found. Set AI_API_KEYS (comma separated) in server/.env or the shell.');
  process.exit(1);
}

console.log(`Checking ${keys.length} key${keys.length === 1 ? '' : 's'} against ${PROVIDER} / ${MODEL}\n`);

const results = [];
for (const key of keys) {
  const res = await checkKey(key);
  results.push({ fp: fingerprint(key), ...res });
  const line = `${res.state.padEnd(16)} ${fingerprint(key)}  ${res.detail}`;
  console.log(line);
}

const good = results.filter(r => r.state === 'OK').length;
console.log(`\n${good}/${results.length} key(s) usable right now.`);

if (good === 0) {
  console.log('No working key — the AI features will fail until at least one is usable.');
  process.exit(1);
}
if (good < results.length) {
  console.log('The pool will use the working key(s) and skip the rest until they recover.');
}
