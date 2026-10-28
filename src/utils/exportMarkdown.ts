/**
 * exportMarkdown.ts — Export notes as Markdown or plain text.
 */

import type { Note } from '../types';
import { toPlainText } from './text';

export function noteToMarkdown(note: Note): string {
  const lines: string[] = [];
  lines.push(`# ${note.title}`);
  lines.push('');
  if (note.tags.length) {
    lines.push(`Tags: ${note.tags.map(t => `#${t}`).join(' ')}`);
    lines.push('');
  }
  lines.push(`> Created: ${new Date(note.createdAt).toLocaleString()}`);
  lines.push(`> Updated: ${new Date(note.updatedAt).toLocaleString()}`);
  lines.push('');

  // Convert HTML content to lightweight markdown
  const md = htmlToMarkdown(note.content);
  lines.push(md);
  lines.push('');

  if (note.summary) {
    lines.push('---');
    lines.push('');
    lines.push('## AI Summary');
    lines.push('');
    lines.push(note.summary);
  }

  return lines.join('\n');
}

function htmlToMarkdown(html: string): string {
  let text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/blockquote>/gi, '\n\n')
    .replace(/<hr\s*\/?>/gi, '\n---\n')
    .replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b>(.*?)<\/b>/gi, '**$1**')
    .replace(/<em>(.*?)<\/em>/gi, '*$1*')
    .replace(/<i>(.*?)<\/i>/gi, '*$1*')
    .replace(/<u>(.*?)<\/u>/gi, '$1')
    .replace(/<s>(.*?)<\/s>/gi, '~~$1~~')
    .replace(/<code>(.*?)<\/code>/gi, '`$1`')
    .replace(/<pre>(.*?)<\/pre>/gi, '```\n$1\n```')
    .replace(/<blockquote>(.*?)<\/blockquote>/gi, (_, inner) => {
      return inner.split('\n').map((l: string) => `> ${l}`).join('\n');
    })
    .replace(/<a\s+href="([^"]+)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
    .replace(/<img\s+src="([^"]+)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)')
    .replace(/<li>(.*?)/gi, '- $1')
    .replace(/<h([1-6])>(.*?)<\/h[1-6]>/gi, (_, level, text) => {
      const hashes = '#'.repeat(parseInt(level));
      return `\n${hashes} ${text.trim()}\n`;
    })
    .replace(/<[^>]+>/g, '');

  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');

  // Clean up excessive blank lines
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

export function noteToPlainText(note: Note): string {
  const lines: string[] = [];
  lines.push(note.title.toUpperCase());
  lines.push('='.repeat(note.title.length));
  lines.push('');
  if (note.tags.length) {
    lines.push(`Tags: ${note.tags.join(', ')}`);
    lines.push('');
  }
  lines.push(`Created: ${new Date(note.createdAt).toLocaleString()}`);
  lines.push(`Updated: ${new Date(note.updatedAt).toLocaleString()}`);
  lines.push('');
  lines.push(toPlainText(note.content));
  lines.push('');
  if (note.summary) {
    lines.push('--- AI SUMMARY ---');
    lines.push(note.summary);
  }
  return lines.join('\n');
}

export function downloadTextFile(text: string, filename: string, mimeType: string): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
