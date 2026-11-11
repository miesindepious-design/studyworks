/**
 * Student profile options — shared by signup and Settings.
 *
 * The lists used to live only inside AuthPage, so the Settings page had to
 * re-declare them (and did so inconsistently). Now both surfaces import the
 * same definitions and a profile saved in Settings looks exactly like one
 * captured at signup.
 */

export type SchoolStage = 'primary' | 'secondary' | 'university';

export const PRIMARY_CLASSES = ['Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6'];

export const SECONDARY_CLASSES = ['JSS 1', 'JSS 2', 'JSS 3', 'SS 1', 'SS 2', 'SS 3'];

export const UNIVERSITY_YEARS = ['Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Postgraduate'];

export const UNIVERSITY_DEPARTMENTS = [
  'Accounting', 'Agriculture', 'Anatomy', 'Architecture', 'Banking & Finance',
  'Biochemistry', 'Biology', 'Business Administration', 'Chemistry',
  'Computer Science', 'Dentistry', 'Economics', 'Education', 'Engineering',
  'English & Literary Studies', 'Estate Management', 'History',
  'International Relations', 'Law', 'Linguistics', 'Mass Communication',
  'Mathematics', 'Medicine & Surgery', 'Microbiology', 'Nursing Science',
  'Pharmacy', 'Physics', 'Physiology', 'Political Science', 'Psychology',
  'Sociology', 'Statistics', 'Other',
];

/** Generic study level — the knob the AI tutor uses when no stage is set. */
export interface EducationLevelOption { value: string; label: string; }

export const EDUCATION_LEVELS: EducationLevelOption[] = [
  { value: 'high-school',       label: 'High School' },
  { value: 'college-freshman',  label: 'College Freshman' },
  { value: 'college-sophomore', label: 'College Sophomore' },
  { value: 'college-junior',    label: 'College Junior' },
  { value: 'college-senior',    label: 'College Senior / Final Year' },
  { value: 'university',        label: 'University' },
  { value: 'graduate',          label: 'Graduate' },
  { value: 'phd',               label: 'PhD / Research' },
];

export const SCHOOL_STAGES: { value: SchoolStage; label: string; hint: string }[] = [
  { value: 'primary',   label: 'Primary school',   hint: 'Primary 1 – Primary 6' },
  { value: 'secondary', label: 'Secondary school', hint: 'JSS 1 – SS 3' },
  { value: 'university', label: 'University',       hint: 'Year 1 – Postgraduate' },
];

/** The exact class list for a stage (empty for university). */
export function classesForStage(stage: SchoolStage | '' | null): string[] {
  if (stage === 'primary') return PRIMARY_CLASSES;
  if (stage === 'secondary') return SECONDARY_CLASSES;
  return [];
}

/**
 * Default study level implied by a school stage.
 * Mirrors the server-side derivation in server/src/routes/ai.ts.
 */
export function levelForStage(stage: SchoolStage | '' | null): string {
  if (stage === 'primary' || stage === 'secondary') return 'high-school';
  if (stage === 'university') return 'university';
  return 'university';
}

/** One-line human summary of a profile, used in the Settings preview. */
export function describeProfile(p: {
  schoolStage?: string | null;
  schoolClass?: string | null;
  universityYear?: string | null;
  department?: string | null;
}): string {
  if (p.schoolStage === 'primary' && p.schoolClass)   return `Primary school · ${p.schoolClass}`;
  if (p.schoolStage === 'secondary' && p.schoolClass) return `Secondary school · ${p.schoolClass}`;
  if (p.schoolStage === 'university' && p.universityYear) {
    return `University · ${p.universityYear}${p.department ? ` · ${p.department}` : ''}`;
  }
  if (p.department) return `${p.department}`;
  return 'Not set yet';
}
