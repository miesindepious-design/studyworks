/**
 * Student profile → prompt context.
 *
 * The signup flow captures the student's exact education stage (primary /
 * secondary class or university year). AI features (tutor, flashcards,
 * quiz battles) use this helper to tailor vocabulary, depth, curriculum
 * coverage and exam style to that exact level.
 */
export interface StudentProfileUser {
  schoolStage?:    string | null;
  schoolClass?:    string | null;
  universityYear?: string | null;
  educationLevel?: string | null;
}

/** Human-readable description of the student, e.g. "a secondary school student in SS 2". */
export function studentProfileBits(user: StudentProfileUser): string[] {
  const bits: string[] = [];
  if (user.schoolStage === 'primary' && user.schoolClass) {
    bits.push(`a primary school pupil in ${user.schoolClass}`);
  } else if (user.schoolStage === 'secondary' && user.schoolClass) {
    bits.push(`a secondary school student in ${user.schoolClass}`);
  } else if (user.schoolStage === 'university' && user.universityYear) {
    bits.push(`a university student in ${user.universityYear}`);
  } else if (user.educationLevel) {
    bits.push(`a ${user.educationLevel}-level student`);
  }
  return bits;
}

/**
 * Appended to a system prompt to make generation level-aware.
 * Empty string when the student has no profile captured.
 */
export function studentPromptContext(bits: string[]): string {
  if (bits.length === 0) return '';
  const audience = bits.join(', ');
  return ` The student you are creating this content for is ${audience}. Tailor vocabulary, depth, curriculum coverage and exam style to that exact class/year (align with what is taught at that stage, not above it).`;
}
