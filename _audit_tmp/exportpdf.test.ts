import { describe, it, expect } from 'vitest';
import { exportNotesToPDF, exportFullLibraryToPDF } from '../src/utils/exportPDF';

const notes: any[] = [
  { id: '1', title: 'Test Note', content: '<p>Hello <b>world</b></p>', type: 'note',
    tags: ['a'], folderId: 'default', createdAt: new Date(), updatedAt: new Date(),
    files: [], highlights: [], personalNotes: [] },
];

describe('exportPDF', () => {
  it('exports notes to PDF', async () => {
    await expect(exportNotesToPDF(notes)).resolves.toBeUndefined();
  });
  it('exports full library to PDF', async () => {
    await expect(exportFullLibraryToPDF(notes, [], [])).resolves.toBeUndefined();
  });
});
