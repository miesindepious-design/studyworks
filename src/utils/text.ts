/**
 * Text utility helpers used across the app.
 */

/** Strip HTML tags — used to get plain text from RichTextEditor content for search / AI */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/** Strip [[Note Title]] wiki-link syntax */
export function stripWikiLinks(text: string): string {
  return text.replace(/\[\[([^\]]+)\]\]/g, '$1');
}

/** Strip both HTML and wiki links — use for AI/search/export plain text */
export function toPlainText(content: string): string {
  return stripWikiLinks(stripHtml(content));
}

/** Word count on plain text */
export function wordCount(content: string): number {
  return toPlainText(content).trim().split(/\s+/).filter(Boolean).length;
}

/** Estimated reading time in minutes */
export function readingTime(content: string): number {
  return Math.max(1, Math.round(wordCount(content) / 200));
}
