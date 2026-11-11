/**
 * Data export — one implementation for the sidebar button and Settings.
 *
 * The Settings page used to write empty arrays for notes / contacts /
 * flashcards and a printable document that said "open the Notes view to see
 * your data". Both now export the real library through these helpers.
 */

import type { Note, Contact, Flashcard, Folder, PracticeQuestion, SavedSearch } from '../types';

export interface ExportBundle {
  notes: Note[];
  contacts: Contact[];
  flashcards: Flashcard[];
  folders: Folder[];
  practiceQuestions: PracticeQuestion[];
  savedSearches: SavedSearch[];
}

export interface ExportPayload extends ExportBundle {
  exportedAt: string;
  app: string;
  version: number;
}

export function buildExportPayload(bundle: ExportBundle): ExportPayload {
  return {
    app: 'StudyWorks',
    version: 1,
    ...bundle,
    exportedAt: new Date().toISOString(),
  };
}

/** Trigger a JSON download of the payload. */
export function downloadJSON(payload: unknown, filename?: string) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename ?? `studyworks-export-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fmtDate = (d?: Date | string | null): string => {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString();
};

const truncate = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n)}…` : s);

function table(headers: string[], rows: string[][], emptyMessage: string): string {
  if (rows.length === 0) {
    return `<p class="empty">${esc(emptyMessage)}</p>`;
  }
  return `<table>
    <thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
  </table>`;
}

/**
 * Build a printable HTML document containing the real library, and open it in
 * a new window ready for "Save as PDF".
 */
export function openPrintableExport(bundle: ExportBundle, tier: string) {
  const exportDate = new Date().toLocaleString();
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) return false;

  const notesRows = bundle.notes.map(n => [
    esc(n.title),
    esc(n.type),
    esc((n.tags ?? []).join(', ')),
    esc(truncate(n.summary || n.content || '')),
    esc(fmtDate(n.updatedAt)),
  ]);

  const contactRows = bundle.contacts.map(c => [
    esc(c.name),
    esc(c.role),
    esc(c.email ?? '—'),
    esc(c.phone ?? '—'),
    esc(fmtDate(c.lastContacted)),
  ]);

  const cardRows = bundle.flashcards.map(c => [
    esc(truncate(c.question, 90)),
    esc(truncate(c.answer, 90)),
    esc(c.difficulty ?? 'medium'),
    esc(String(c.repetitions ?? 0)),
  ]);

  const practiceRows = bundle.practiceQuestions.map(q => [
    esc(truncate(q.question, 90)),
    esc(truncate(q.answer, 90)),
    esc(q.type),
  ]);

  const html = `<!DOCTYPE html>
<html><head><title>StudyWorks Export — ${esc(exportDate)}</title>
<style>
  body { font-family: 'Segoe UI', system-ui, sans-serif; padding: 2.5rem; color: #111; max-width: 800px; margin: 0 auto; }
  h1 { font-size: 1.5rem; border-bottom: 2px solid #0d9488; padding-bottom: 0.5rem; }
  h2 { font-size: 1.1rem; margin-top: 1.75rem; color: #0f766e; }
  table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; font-size: 0.8rem; }
  th { background: #f0fdfa; text-align: left; padding: 0.4rem 0.5rem; border: 1px solid #ccfbf1; color: #0f766e; }
  td { padding: 0.4rem 0.5rem; border: 1px solid #e5e7eb; vertical-align: top; }
  .meta { color: #6b7280; font-size: 0.8rem; margin-bottom: 1.5rem; }
  .empty { color: #9ca3af; font-size: 0.85rem; font-style: italic; }
  .counts { display: flex; gap: 1rem; flex-wrap: wrap; margin: 1rem 0 0; }
  .count { border: 1px solid #ccfbf1; background: #f0fdfa; border-radius: 8px; padding: 0.4rem 0.7rem; font-size: 0.8rem; }
  @media print { body { padding: 0; } }
</style></head><body>
<h1>📚 StudyWorks Data Export</h1>
<p class="meta">Exported ${esc(exportDate)} · Plan: ${tier === 'pro' ? '⭐ Pro' : '🆓 Free'}</p>
<div class="counts">
  <span class="count">${bundle.notes.length} notes</span>
  <span class="count">${bundle.contacts.length} contacts</span>
  <span class="count">${bundle.flashcards.length} flashcards</span>
  <span class="count">${bundle.practiceQuestions.length} practice questions</span>
  <span class="count">${bundle.folders.length} folders</span>
</div>
<h2>📝 Notes</h2>
${table(['Title', 'Type', 'Tags', 'Preview', 'Updated'], notesRows, 'No notes yet.')}
<h2>👥 Contacts</h2>
${table(['Name', 'Role', 'Email', 'Phone', 'Last contact'], contactRows, 'No contacts yet.')}
<h2>💡 Flashcards</h2>
${table(['Question', 'Answer', 'Difficulty', 'Reviews'], cardRows, 'No flashcards yet.')}
<h2>❓ Practice Questions</h2>
${table(['Question', 'Answer', 'Type'], practiceRows, 'No practice questions yet.')}
<script>window.onload = () => { setTimeout(() => window.print(), 300); };</script>
</body></html>`;

  win.document.write(html);
  win.document.close();
  return true;
}
