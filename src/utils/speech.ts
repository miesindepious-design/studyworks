/**
 * speech.ts — making the AI Tutor actually sound good.
 *
 * The Web Speech API is only as good as the voice you hand it, and how you
 * feed it text. Two things went wrong before:
 *
 *   1. Voice choice — `getVoices()` was scanned for "any English voice", so
 *      Windows handed back "Microsoft George", a legacy desktop voice that
 *      sounds flat and robotic. The modern voices (Microsoft Aria / Jenny /
 *      Guy / Emma, Google US English, Apple Samantha) sound like a person.
 *
 *   2. Delivery — the whole reply was pushed into one utterance. Chrome cuts
 *      off utterances longer than ~15 seconds, and a single long utterance
 *      has no natural pauses. Speaking sentence by sentence fixes both.
 *
 * Everything here is pure and testable; the component only wires it up.
 */

/** Voices that sound like a person, best first. */
const VOICE_TIERS: { pattern: RegExp; score: number }[] = [
  // Neural / natural synthesis — the best available everywhere.
  { pattern: /(natural|neural|premium|enhanced)/i,        score: 100 },
  // Named voices that are consistently clear and warm.
  { pattern: /Microsoft (Aria|Jenny|Emma|Libby|Sonia|Ava|Ryan|Guy|Michelle|Andrew)/i, score: 80 },
  { pattern: /Google (US|UK) English/i,                     score: 80 },
  { pattern: /(Samantha|Serena|Tessa|Fiona|Allison|Karen|Moira|Vicki|Nicky|Rishi)/i, score: 65 },
  // Legacy desktop voices — usable, but only as a last resort.
  { pattern: /Microsoft (Zira|Hazel|Sonia)/i,               score: 45 },
];

/** Legacy voices that sound noticeably robotic — penalised, never chosen. */
const VOICE_AVOID = /(David|George|Mark|Ricardo|Fred|Ralph|Albert|Lucas)/i;

/**
 * Score every voice and return the best one.
 *
 * Quality dominates; the browser locale then breaks ties, so a British
 * student gets a British voice when one exists.
 */
export function pickBestVoice(
  voices: SpeechSynthesisVoice[],
  preferredLang = 'en-US',
): SpeechSynthesisVoice | null {
  if (!voices || !voices.length) return null;

  const english = voices.filter(v => /^en(-|_|$)/i.test(v.lang || ''));
  const pool = english.length ? english : voices;

  const pref = (preferredLang || 'en-US').toLowerCase();
  const region = pref.split('-')[1] ?? '';

  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -Infinity;

  for (const voice of pool) {
    const name = voice.name || '';
    const lang = (voice.lang || '').toLowerCase();

    let score = 0;
    for (const tier of VOICE_TIERS) {
      if (tier.pattern.test(name)) { score += tier.score; break; }
    }
    if (VOICE_AVOID.test(name)) score -= 60;
    if (/desktop/i.test(name)) score -= 10;

    if (lang === pref) score += 25;
    else if (region && lang.includes(region)) score += 12;
    if (voice.localService) score += 6;

    if (score > bestScore) { bestScore = score; best = voice; }
  }

  return best;
}

/** Reading speeds offered in the tutor. */
export const SPEECH_RATES = {
  slower: 0.88,
  normal: 0.97,
  lively: 1.06,
} as const;

export type SpeechSpeed = keyof typeof SPEECH_RATES;

export const SPEECH_SPEED_LABELS: Record<SpeechSpeed, string> = {
  slower: 'Slower',
  normal: 'Natural',
  lively: 'Lively',
};

/**
 * Split a reply into speakable chunks.
 *
 * One utterance per sentence gives the voice natural pauses, and keeps every
 * utterance well under Chrome's ~15 second truncation limit. Sentences that
 * are still very long get broken at clause boundaries.
 */
export function splitForSpeech(text: string, maxLength = 260): string[] {
  if (!text) return [];

  const out: string[] = [];

  for (const paragraph of text.split(/\n+/)) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    const sentences = trimmed.split(/(?<=[.!?…])\s+/).filter(Boolean);

    for (const sentence of sentences) {
      if (sentence.length <= maxLength) { out.push(sentence); continue; }

      // Too long for one breath — break on clause boundaries.
      let buffer = '';
      for (const clause of sentence.split(/(?<=[,;:])\s+/)) {
        if (buffer && (buffer + ' ' + clause).length > maxLength) {
          out.push(buffer.trim());
          buffer = clause;
        } else {
          buffer = buffer ? `${buffer} ${clause}` : clause;
        }
      }
      if (buffer.trim()) out.push(buffer.trim());
    }
  }

  return dropRepeatedHeads(out.filter(s => s.length > 0));
}

/**
 * Drop a chunk that just repeats the next one — e.g. a heading saying
 * "Photosynthesis" followed by a sentence starting with "Photosynthesis".
 * The tutor would otherwise say the topic twice in a row.
 */
export function dropRepeatedHeads(chunks: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const current = chunks[i];
    const next = chunks[i + 1];
    if (next) {
      const head = current.split(/\s+/)[0]?.toLowerCase();
      const nextHead = next.split(/\s+/)[0]?.toLowerCase();
      const currentIsShort = current.split(/\s+/).length <= 3;
      if (head && head === nextHead && currentIsShort) continue;
    }
    out.push(current);
  }
  return out;
}

/** Emoji and pictographs the voice engine would either skip or mangle. */
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu;

/**
 * Clean a reply for speaking: drop emoji, control characters and the
 * leftover punctuation runs that make a voice stumble.
 */
export function stripEmoji(text: string): string {
  return text
    .replace(EMOJI_RE, ' ')
    // Control characters — but newlines and tabs are structure, keep them.
    .replace(/[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/[!]{3,}/g, '!')
    .replace(/[?]{3,}/g, '?')
    // Horizontal runs only — paragraph breaks must survive so the chunker
    // can pause where the answer pauses.
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
