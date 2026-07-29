/**
 * product.ts — product identity for THIS app.
 *
 * This app is the STUDENT version of StudyWorks (gamified study, Quiz Battle,
 * streaks, flashcards, exam prep). The adult/research app is a SEPARATE,
 * standalone follow-up build — intentionally NOT an in-repo fork or config
 * flag here. Keeping this module to a single student profile avoids implying
 * a fork that won't exist.
 */

export interface ProductProfile {
  /** Wordmark shown in the opening sequence + sidebar. */
  name: string;
  /** Short tagline under the mark. */
  tagline: string;
  /** Emphasis label used in onboarding / empty states. */
  audience: string;
}

export const productProfile: ProductProfile = {
  name: 'StudyWorks',
  tagline: 'Your study companion',
  audience: 'students',
};
