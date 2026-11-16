/**
 * Tests for the upload → text pipeline.
 *
 * The AI Tutor reads files in the browser (PDF, DOCX, PPTX, images via OCR,
 * HTML, plain text) before anything is sent to the model, so the extractor
 * has to handle real-world file shapes — including the Open XML inside a
 * .docx.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { extractTextFromFile } from './extractText';

function makeFile(parts: (string | Uint8Array)[], name: string, type: string): File {
  return new File(parts as any, name, { type });
}

/** Build a minimal .docx (an Open XML zip) with the given paragraphs. */
async function makeDocx(paragraphs: string[]): Promise<File> {
  const zip = new JSZip();
  const body = paragraphs
    .map(p => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`)
    .join('');
  zip.file(
    'word/document.xml',
    `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`,
  );
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return makeFile([bytes], 'chapter.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}

describe('extractTextFromFile — plain text', () => {
  it('reads a .txt file', async () => {
    const file = makeFile(['Photosynthesis converts light into glucose.'], 'notes.txt', 'text/plain');
    const res = await extractTextFromFile(file);
    expect(res.text).toBe('Photosynthesis converts light into glucose.');
    expect(res.truncated).toBe(false);
    expect(res.kind).toBe('text');
  });

  it('reads a .md file', async () => {
    const file = makeFile(['# Heading\n\nBody text.'], 'notes.md', '');
    const res = await extractTextFromFile(file);
    expect(res.text).toContain('# Heading');
    expect(res.kind).toBe('text');
  });

  it('truncates at the requested cap and flags it', async () => {
    const file = makeFile(['x'.repeat(500)], 'big.txt', 'text/plain');
    const res = await extractTextFromFile(file, { maxBytes: 100 });
    expect(res.text).toHaveLength(100);
    expect(res.truncated).toBe(true);
  });
});

describe('extractTextFromFile — DOCX', () => {
  it('pulls the paragraph text out of a Word document', async () => {
    const file = await makeDocx([
      'Light-dependent reactions',
      'The Calvin cycle fixes carbon dioxide',
    ]);
    const res = await extractTextFromFile(file);
    expect(res.kind).toBe('docx');
    expect(res.text).toContain('Light-dependent reactions');
    expect(res.text).toContain('The Calvin cycle fixes carbon dioxide');
    // Paragraphs are separated, not glued together.
    expect(res.text).toContain('\n\n');
  });

  it('decodes XML entities in the document text', async () => {
    const file = await makeDocx(['A &amp; B &lt;x&gt;']);
    const res = await extractTextFromFile(file);
    expect(res.text).toContain('A & B <x>');
  });

  it('rejects a DOCX with no body', async () => {
    const zip = new JSZip();
    zip.file('word/styles.xml', '<x/>');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const file = makeFile([bytes], 'empty.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    await expect(extractTextFromFile(file)).rejects.toThrow(/no readable body/i);
  });
});

describe('extractTextFromFile — HTML', () => {
  it('strips the markup and keeps the text', async () => {
    const file = makeFile(
      ['<html><body><h1>Title</h1><p>First para</p><script>bad()</script><p>Second para</p></body></html>'],
      'page.html',
      'text/html',
    );
    const res = await extractTextFromFile(file);
    expect(res.kind).toBe('html');
    expect(res.text).toContain('Title');
    expect(res.text).toContain('First para');
    expect(res.text).toContain('Second para');
    expect(res.text).not.toContain('bad()');
    expect(res.text).not.toContain('<h1>');
  });
});

describe('extractTextFromFile — unsupported files', () => {
  it('explains what is supported instead of failing silently', async () => {
    const file = makeFile([new Uint8Array([1, 2, 3])], 'archive.zip', 'application/zip');
    await expect(extractTextFromFile(file)).rejects.toThrow(/Supported: PDF, DOCX, PPTX/);
  });
});
