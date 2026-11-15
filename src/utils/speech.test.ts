/**
 * Speech quality.
 *
 * The tutor used to grab "any English voice", which on Windows meant the
 * legacy "Microsoft George" — flat and robotic — and it pushed whole replies
 * into a single utterance, so long answers were truncated by Chrome and
 * sounded like one breathless monologue.
 *
 * These tests lock in the voice ranking and the sentence-level chunking.
 */

import { describe, it, expect } from 'vitest';
import { pickBestVoice, splitForSpeech, stripEmoji, dropRepeatedHeads, SPEECH_RATES } from './speech';

/** Minimal stand-in for SpeechSynthesisVoice. */
function voice(name: string, lang: string, localService = true): SpeechSynthesisVoice {
  return { name, lang, localService, voiceURI: `${name}|${lang}`, default: false } as SpeechSynthesisVoice;
}

describe('pickBestVoice', () => {
  it('prefers a neural voice over a legacy desktop one', () => {
    const picked = pickBestVoice([
      voice('Microsoft David Desktop', 'en-US'),
      voice('Microsoft Jenny Online (Natural) - English (United States)', 'en-US', false),
    ]);
    expect(picked?.name).toContain('Jenny');
  });

  it('prefers Microsoft Aria/Jenny/Emma over robotic voices', () => {
    const picked = pickBestVoice([
      voice('Microsoft George', 'en-GB'),
      voice('Microsoft Aria', 'en-US'),
    ]);
    expect(picked?.name).toContain('Aria');
  });

  it('prefers Google English voices', () => {
    const picked = pickBestVoice([
      voice('Microsoft David Desktop', 'en-US'),
      voice('Google UK English Female', 'en-GB', false),
    ]);
    expect(picked?.name).toContain('Google');
  });

  it('falls back to a clear legacy voice rather than a robotic one', () => {
    const picked = pickBestVoice([
      voice('Microsoft David Desktop', 'en-US'),
      voice('Microsoft Hazel', 'en-GB'),
    ]);
    expect(picked?.name).toContain('Hazel');
  });

  it('respects the browser locale when the quality is equal', () => {
    const picked = pickBestVoice([
      voice('Microsoft Aria', 'en-US'),
      voice('Microsoft Libby', 'en-GB'),
    ], 'en-GB');
    expect(picked?.name).toContain('Libby');
  });

  it('ignores non-English voices when English ones exist', () => {
    const picked = pickBestVoice([
      voice('Microsoft Yuna', 'ko-KR'),
      voice('Microsoft Zira', 'en-US'),
    ]);
    expect(picked?.name).toContain('Zira');
  });

  it('returns null when there are no voices at all', () => {
    expect(pickBestVoice([])).toBeNull();
  });
});

describe('splitForSpeech', () => {
  it('splits a reply into sentences', () => {
    const chunks = splitForSpeech('First point here. Second point here. Third point here.');
    expect(chunks).toHaveLength(3);
  });

  it('keeps every chunk short enough for the browser to finish', () => {
    const long = 'This is a long sentence that keeps going and going without stopping. '.repeat(12);
    for (const chunk of splitForSpeech(long)) {
      expect(chunk.length).toBeLessThanOrEqual(300);
    }
  });

  it('never drops text', () => {
    const text = 'Alpha beta gamma. Delta epsilon zeta.';
    const joined = splitForSpeech(text).join(' ').replace(/\s+/g, ' ').trim();
    expect(joined).toBe(text);
  });

  it('pauses at paragraph breaks', () => {
    const chunks = splitForSpeech('First line.\n\nSecond line.\n\nThird line.');
    expect(chunks.length).toBeGreaterThanOrEqual(3);
  });

  it('does not say a heading and the sentence that repeats it', () => {
    const chunks = splitForSpeech('Photosynthesis\nPhotosynthesis is how plants make sugar.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('is how plants make sugar');
  });

  it('handles empty input', () => {
    expect(splitForSpeech('')).toEqual([]);
    expect(splitForSpeech('   ')).toEqual([]);
  });
});

describe('dropRepeatedHeads', () => {
  it('drops a short chunk that repeats the next one', () => {
    expect(dropRepeatedHeads(['Photosynthesis', 'Photosynthesis is how it works.'])).toEqual([
      'Photosynthesis is how it works.',
    ]);
  });

  it('keeps chunks that do not repeat', () => {
    expect(dropRepeatedHeads(['One', 'Two'])).toEqual(['One', 'Two']);
  });
});

describe('stripEmoji', () => {
  it('removes emoji the voice would mangle', () => {
    expect(stripEmoji('Great 🎓 work 💡 here')).toBe('Great work here');
  });

  it('keeps ordinary punctuation', () => {
    expect(stripEmoji('Wait... really?')).toBe('Wait... really?');
  });

  it('keeps paragraph breaks — they drive the speaking pauses', () => {
    expect(stripEmoji('First line.\n\nSecond line.')).toBe('First line.\n\nSecond line.');
  });
});

describe('speech rates', () => {
  it('offers three sensible speeds', () => {
    expect(Object.keys(SPEECH_RATES)).toEqual(['slower', 'normal', 'lively']);
    expect(SPEECH_RATES.slower).toBeLessThan(SPEECH_RATES.normal);
    expect(SPEECH_RATES.normal).toBeLessThan(SPEECH_RATES.lively);
  });
});
