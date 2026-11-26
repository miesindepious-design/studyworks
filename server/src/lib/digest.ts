/**
 * digest.ts — builds the weekly email digest.
 *
 * This file is pure: it takes the week's numbers and returns a subject, a
 * plain-text body and an HTML body. The route does the gathering and the
 * sending; the wording lives here so it can be tested without a mailbox.
 *
 * Two rules shaped the content:
 *
 *   - it must be worth opening. A wall of zeros is worse than no email, so
 *     a quiet week says so plainly and points at what is due instead;
 *   - it must not be a guilt trip. The tone is a report, not a scolding.
 *
 * The HTML is tables and inline styles because that is what email clients
 * still agree on.
 */

/** Everything the digest needs to know about one student's week. */
export interface DigestInput {
  /** The student's name, if they gave one. */
  name?: string | null;
  /** The range covered, YYYY-MM-DD. */
  rangeStart: string;
  rangeEnd: string;
  /** Cards reviewed during the week. */
  cardsReviewed: number;
  /** Notes written during the week. */
  notesCreated: number;
  /** Cards added during the week. */
  cardsCreated: number;
  /** XP earned during the week. */
  xpEarned: number;
  /** The level the student is on. */
  level: number;
  /** Consecutive days of study. */
  currentStreak: number;
  /** Their best run. */
  longestStreak: number;
  /** Cards waiting to be reviewed right now. */
  cardsDue: number;
  /** Notes waiting to be recalled right now. */
  notesDue: number;
  /** Where the student can turn the email off. */
  settingsUrl: string;
}

export interface DigestContent {
  subject: string;
  text: string;
  html: string;
}

/** How a number reads in a sentence — "1 card", "12 cards". */
function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The one-line summary that goes in the subject line.
 *
 * It is deliberately about the week's headline, not a count of everything —
 * "You reviewed 42 cards" is interesting, "Your week in StudyWorks" is not.
 */
export function digestSubject(input: DigestInput): string {
  if (input.cardsReviewed > 0) {
    return `${plural(input.cardsReviewed, 'card')} reviewed — your week in StudyWorks`;
  }
  if (input.notesCreated > 0) {
    return `${plural(input.notesCreated, 'note')} written — your week in StudyWorks`;
  }
  if (input.xpEarned > 0) {
    return `+${input.xpEarned} XP — your week in StudyWorks`;
  }
  return 'Your week in StudyWorks — nothing due, nothing missed';
}

/** The body of the digest, as plain text. */
export function digestText(input: DigestInput): string {
  const lines: string[] = [];

  const greeting = input.name ? `Hi ${input.name},` : 'Hi,';
  lines.push(greeting);
  lines.push('');
  lines.push(`Here is your week: ${input.rangeStart} to ${input.rangeEnd}.`);
  lines.push('');

  lines.push('WHAT YOU DID');
  if (input.cardsReviewed > 0) lines.push(`  • ${plural(input.cardsReviewed, 'card')} reviewed`);
  if (input.cardsCreated > 0) lines.push(`  • ${plural(input.cardsCreated, 'card')} added`);
  if (input.notesCreated > 0) lines.push(`  • ${plural(input.notesCreated, 'note')} written`);
  if (input.xpEarned > 0) lines.push(`  • ${input.xpEarned} XP earned`);
  if (input.currentStreak > 0) lines.push(`  • ${input.currentStreak}-day streak`);

  if (input.cardsReviewed === 0 && input.notesCreated === 0 && input.cardsCreated === 0 && input.xpEarned === 0) {
    lines.push('  • Nothing yet this week.');
  }
  lines.push('');

  if (input.cardsDue > 0 || input.notesDue > 0) {
    lines.push('WHAT IS WAITING');
    if (input.cardsDue > 0) lines.push(`  • ${plural(input.cardsDue, 'card')} due for review`);
    if (input.notesDue > 0) lines.push(`  • ${plural(input.notesDue, 'note')} due for recall`);
    lines.push('');
  }

  lines.push(`You are on level ${input.level}.`);
  if (input.longestStreak > input.currentStreak) {
    lines.push(`Your best run so far is ${input.longestStreak} days.`);
  }
  lines.push('');
  lines.push(`Open StudyWorks: ${input.settingsUrl}`);
  lines.push('');
  lines.push('Turn this email off in Settings → Weekly digest.');
  lines.push('— StudyWorks');

  return lines.join('\n');
}

/** Escape text for safe interpolation into HTML. */
function esc(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The body of the digest, as HTML. */
export function digestHtml(input: DigestInput): string {
  const accent = '#FF5136';
  const ink = '#1A1A18';
  const muted = '#6B6A63';

  const did: string[] = [];
  if (input.cardsReviewed > 0) did.push(`${plural(input.cardsReviewed, 'card')} reviewed`);
  if (input.cardsCreated > 0) did.push(`${plural(input.cardsCreated, 'card')} added`);
  if (input.notesCreated > 0) did.push(`${plural(input.notesCreated, 'note')} written`);
  if (input.xpEarned > 0) did.push(`${input.xpEarned} XP earned`);
  if (input.currentStreak > 0) did.push(`${input.currentStreak}-day streak`);

  const rows = did.length > 0
    ? did.map(d => `<tr><td style="padding:4px 0;color:${muted};font-size:14px;">${esc(d)}</td></tr>`).join('')
    : `<tr><td style="padding:4px 0;color:${muted};font-size:14px;">Nothing yet this week.</td></tr>`;

  const waiting: string[] = [];
  if (input.cardsDue > 0) waiting.push(`${plural(input.cardsDue, 'card')} due for review`);
  if (input.notesDue > 0) waiting.push(`${plural(input.notesDue, 'note')} due for recall`);

  const waitingBlock = waiting.length > 0
    ? `<tr><td style="padding:0 0 8px 0;">
         <p style="margin:0 0 6px 0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${muted};">What is waiting</p>
         ${waiting.map(w => `<p style="margin:0 0 4px 0;color:${ink};font-size:14px;">• ${esc(w)}</p>`).join('')}
       </td></tr>`
    : '';

  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#F6F4EE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#FFFFFF;border-radius:16px;border:1px solid #E4E1D6;">
    <tr><td style="padding:28px 28px 8px 28px;">
      <p style="margin:0 0 6px 0;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:${accent};font-weight:700;">StudyWorks</p>
      ${input.name ? `<p style="margin:0 0 4px 0;font-size:14px;color:${ink};">Hi ${esc(input.name)},</p>` : ''}
      <h1 style="margin:0 0 6px 0;font-size:22px;color:${ink};font-weight:700;">Your week</h1>
      <p style="margin:0;color:${muted};font-size:13px;">${esc(input.rangeStart)} to ${esc(input.rangeEnd)}</p>
    </td></tr>
    <tr><td style="padding:16px 28px 0 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:0 0 8px 0;">
          <p style="margin:0 0 6px 0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${muted};">What you did</p>
          ${rows}
        </td></tr>
        ${waitingBlock}
        <tr><td style="padding:12px 0 0 0;">
          <p style="margin:0;color:${muted};font-size:13px;">You are on level ${esc(input.level)}${input.longestStreak > input.currentStreak ? ` — your best run so far is ${esc(input.longestStreak)} days.` : '.'}</p>
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:22px 28px 26px 28px;">
      <a href="${esc(input.settingsUrl)}" style="display:inline-block;background:${accent};color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:600;padding:11px 20px;border-radius:9999px;">Open StudyWorks</a>
      <p style="margin:16px 0 0 0;color:${muted};font-size:12px;">Turn this email off in Settings → Weekly digest.</p>
    </td></tr>
  </table>
</body></html>`;
}

/** The whole digest: subject, text and HTML together. */
export function buildDigest(input: DigestInput): DigestContent {
  return {
    subject: digestSubject(input),
    text: digestText(input),
    html: digestHtml(input),
  };
}
