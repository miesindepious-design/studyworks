/**
 * utils/mastery.ts — turn a pile of cards into a picture of what the student
 * actually knows.
 *
 * The Mastery Map groups cards by topic and scores each topic from the
 * spaced-repetition state that is already on every card: how many times it
 * has been reviewed, how easy it has become (the SM-2 easiness factor) and
 * how it has been going (the review trail).
 *
 * A card counts as mastered once it has been seen a few times *and* its ease
 * factor says the student finds it easy — a card that keeps being answered
 * "again" is not mastered no matter how many times it has come round.
 */
import type { Flashcard, Note, PracticeQuestion } from '../types';

export type MasteryStage = 'new' | 'learning' | 'mastered';

export interface TopicMastery {
  topic: string;
  total: number;
  new: number;
  learning: number;
  mastered: number;
  due: number;
  /** 0-100 — how well this topic is known. */
  masteryPct: number;
  /** 0-100 — share of reviews that were not "Again". */
  accuracyPct: number;
  /** Cards that keep failing — the ones to fix next. */
  leeches: number;
}

export const UNTITLED_TOPIC = 'General';

/** A card is mastered after this many successful repetitions... */
const MASTERED_REPETITIONS = 3;
/** ...and an ease factor this high. */
const MASTERED_EF = 2.3;

function stageOf(card: Flashcard): MasteryStage {
  const reps = card.repetitions ?? 0;
  const ef = card.ef ?? 2.5;
  if (reps === 0) return 'new';
  if (reps >= MASTERED_REPETITIONS && ef >= MASTERED_EF) return 'mastered';
  return 'learning';
}

function isDue(card: Flashcard, now = new Date()): boolean {
  if (!card.nextReview) return true;
  return new Date(card.nextReview).getTime() <= now.getTime();
}

export function topicOf(card: { topic?: string | null }): string {
  const topic = (card.topic ?? '').trim();
  return topic || UNTITLED_TOPIC;
}

/**
 * Build the mastery map. Cards without a topic are grouped under "General"
 * rather than dropped — an untagged card is still a card the student owns.
 */
export function computeMastery(
  flashcards: Flashcard[],
  practiceQuestions: PracticeQuestion[] = [],
  now = new Date(),
  notes: Note[] = [],
): TopicMastery[] {
  const map = new Map<string, TopicMastery>();

  const ensure = (topic: string): TopicMastery => {
    let entry = map.get(topic);
    if (!entry) {
      entry = {
        topic,
        total: 0,
        new: 0,
        learning: 0,
        mastered: 0,
        due: 0,
        masteryPct: 0,
        accuracyPct: 0,
        leeches: 0,
      };
      map.set(topic, entry);
    }
    return entry;
  };

  // Rating tally per topic, used for accuracy.
  const good = new Map<string, number>();
  const total = new Map<string, number>();

  for (const card of flashcards) {
    const topic = topicOf(card);
    const entry = ensure(topic);
    entry.total += 1;

    const stage = stageOf(card);
    if (stage === 'new') entry.new += 1;
    else if (stage === 'learning') entry.learning += 1;
    else entry.mastered += 1;

    if (isDue(card, now)) entry.due += 1;
    if ((card.leechCount ?? 0) >= 3) entry.leeches += 1;

    const history = card.reviewHistory ?? [];
    if (history.length > 0) {
      let g = good.get(topic) ?? 0;
      let t = total.get(topic) ?? 0;
      for (const h of history) {
        if (h.quality >= 2) g += 1;
        t += 1;
      }
      good.set(topic, g);
      total.set(topic, t);
    }
  }

  // Practice questions count towards the topic's workload but not its
  // spaced-repetition stage — they are not yet a deck.
  for (const q of practiceQuestions) {
    const topic = topicOf(q);
    const entry = ensure(topic);
    entry.total += 1;
    if (!q.nextReview || new Date(q.nextReview) <= now) entry.due += 1;
  }

  // Notes count towards the topic too. A note is not a card, but it is
  // material the student is meant to know, and it is now scheduled on the
  // same curve — so it belongs on the map.
  for (const note of notes) {
    // A note's topic is the subject it was tagged with; an untagged note
    // lands under "General" rather than being dropped from the map.
    const topic = topicOf(note);
    const entry = ensure(topic);
    entry.total += 1;

    const reps = note.repetitions ?? 0;
    const ef = note.ef ?? 2.5;
    if (reps === 0) entry.new += 1;
    else if (reps >= MASTERED_REPETITIONS && ef >= MASTERED_EF) entry.mastered += 1;
    else entry.learning += 1;

    if (note.nextReview && new Date(note.nextReview) <= now) entry.due += 1;
    if ((note.leechCount ?? 0) >= 3) entry.leeches += 1;

    const history = note.reviewHistory ?? [];
    if (history.length > 0) {
      let g = good.get(topic) ?? 0;
      let t = total.get(topic) ?? 0;
      for (const h of history) {
        if (h.quality >= 2) g += 1;
        t += 1;
      }
      good.set(topic, g);
      total.set(topic, t);
    }
  }

  const out: TopicMastery[] = [];
  for (const [topic, entry] of map) {
    const t = total.get(topic) ?? 0;
    const g = good.get(topic) ?? 0;
    entry.accuracyPct = t > 0 ? Math.round((g / t) * 100) : 0;
    // Mastery is the share of the topic that is truly known, softened so a
    // large deck with one mastered card does not read as 100%.
    const raw = entry.total > 0 ? (entry.mastered / entry.total) * 100 : 0;
    const learningCredit = entry.total > 0 ? (entry.learning / entry.total) * 40 : 0;
    entry.masteryPct = Math.round(Math.min(100, raw + learningCredit));
    out.push(entry);
  }

  // Biggest gap first, then by size — that is what the student should study.
  out.sort((a, b) => (a.masteryPct - b.masteryPct) || (b.total - a.total));
  return out;
}

/** The topics that most need attention. */
export function weakestTopics(mastery: TopicMastery[], count = 3): TopicMastery[] {
  return [...mastery]
    .filter(m => m.masteryPct < 70)
    .sort((a, b) => (a.masteryPct - b.masteryPct) || (b.total - a.total))
    .slice(0, count);
}
