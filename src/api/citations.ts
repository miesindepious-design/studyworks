/**
 * /api/citations — the bibliography's API.
 *
 * The server stores the facts of a source; the formatting into APA, MLA,
 * Harvard or Chicago happens on the client, so switching style re-renders
 * the whole reference list without a single write.
 */
import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import type { SourceType } from '../utils/citations';

/**
 * What the server sends back.
 *
 * The server stores empty fields as NULL, so every optional fact arrives as
 * `string | null` — not as `undefined`. Keeping that distinction here means
 * the view can tell "no publisher" apart from "we never asked".
 */
export interface CitationDTO {
  id: string;
  /** The note this source was used in, if any. */
  noteId: string | null;
  type: SourceType;
  authors: string[];
  editor: string | null;
  year: string;
  title: string;
  container: string | null;
  publisher: string | null;
  place: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  url: string | null;
  doi: string | null;
  accessed: string | null;
  createdAt: string;
  updatedAt: string;
}

export function listCitations(noteId?: string): Promise<CitationDTO[]> {
  const query = noteId ? `?noteId=${encodeURIComponent(noteId)}` : '';
  return apiGet<CitationDTO[]>(`/api/citations${query}`);
}

export function createCitation(body: {
  /** The note this source was used in, if any. */
  noteId?: string | null;
  type: SourceType;
  authors: string[];
  editor?: string | null;
  year: string;
  title: string;
  container?: string | null;
  publisher?: string | null;
  place?: string | null;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  url?: string | null;
  doi?: string | null;
  accessed?: string | null;
}): Promise<CitationDTO> {
  return apiPost<CitationDTO>('/api/citations', body);
}

export function updateCitation(
  id: string,
  body: Partial<{
    noteId: string | null;
    type: SourceType;
    authors: string[];
    editor: string | null;
    year: string;
    title: string;
    container: string | null;
    publisher: string | null;
    place: string | null;
    volume: string | null;
    issue: string | null;
    pages: string | null;
    url: string | null;
    doi: string | null;
    accessed: string | null;
  }>,
): Promise<CitationDTO> {
  return apiPatch<CitationDTO>(`/api/citations/${encodeURIComponent(id)}`, body);
}

export function deleteCitation(id: string): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(`/api/citations/${encodeURIComponent(id)}`);
}
