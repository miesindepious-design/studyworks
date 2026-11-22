/**
 * generatedDocs.ts — storage for the documents the AI tutor produces.
 *
 * A generated document (a Word handout, a PDF worksheet, a slide deck) is a
 * real file, so it lives in IndexedDB as a Blob. The note that produced it
 * keeps only a reference — a card with the format, the file name and the
 * size — instead of a wall of text.
 */

import { getDB } from './schema';
import type { GeneratedDocument } from '../types';

export const generatedDocsDB = {
  async getAll(): Promise<GeneratedDocument[]> {
    const db = await getDB();
    return db.getAll('generated_docs');
  },

  async get(id: string): Promise<GeneratedDocument | undefined> {
    const db = await getDB();
    return db.get('generated_docs', id);
  },

  async put(doc: GeneratedDocument): Promise<void> {
    const db = await getDB();
    await db.put('generated_docs', doc);
  },

  async delete(id: string): Promise<void> {
    const db = await getDB();
    await db.delete('generated_docs', id);
  },

  async clear(): Promise<void> {
    const db = await getDB();
    await db.clear('generated_docs');
  },
};
