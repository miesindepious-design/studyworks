/**
 * extractText.ts — extract plain text from uploaded files.
 *
 * Currently supports:
 *   - PDF (via pdfjs-dist) — the highest-value case, since PDFs are
 *     textbook chapters, papers, and reference material.
 *   - PPTX (via jszip) — PowerPoint decks; slides are unzipped and the
 *     <a:t> text runs are pulled out per slide.
 *   - Text-based files (txt, md) — read as plain text.
 *
 * Not supported:
 *   - PPT (legacy binary .ppt) — a different, undocumented format. Only
 *     the modern Open XML .pptx is parsed.
 *   - Images — would need OCR. Skipping for now; users can paste the
 *     text into a note manually or add OCR as a server route later.
 *   - Audio — would need speech-to-text. Skipping for the same reason.
 *
 * The output is plain text with paragraphs separated by double newlines.
 * The cap is 100 KB of extracted text — large enough for a 50-page
 * chapter, small enough to keep the AI prompt under reasonable limits.
 */

const MAX_TEXT_BYTES = 100 * 1024;

// A page yielding fewer than this many characters of embedded text is treated
// as scanned/image-based and sent through OCR.
const OCR_MIN_CHARS_PER_PAGE = 20;
// Cap OCR to this many pages — OCR is slow (~2-5s/page) and we don't want to
// lock the browser on a 300-page scan.
const OCR_MAX_PAGES = 20;

export interface ExtractResult {
  text: string;
  pageCount?: number;
  truncated: boolean;
  ocrUsed?: boolean;
}

export async function extractTextFromFile(file: File): Promise<ExtractResult> {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    return extractFromPdf(file);
  }
  if (file.name.toLowerCase().endsWith('.pptx')) {
    return extractFromPptx(file);
  }
  if (file.type.startsWith('text/') || /\.(txt|md|csv|json|markdown)$/i.test(file.name)) {
    return extractFromText(file);
  }
  throw new Error(`Cannot extract text from ${file.type || file.name}. Use a PDF, PPTX, or text file.`);
}

// ── PDF ───────────────────────────────────────────────────────────────────────
// pdfjs-dist is a large dependency; we lazy-load it so the initial app
// bundle doesn't pay for users who never upload a PDF.
async function extractFromPdf(file: File): Promise<ExtractResult> {
  const pdfjs = await import('pdfjs-dist');
  // pdfjs needs a worker — point it at the bundled worker file. Vite's
  // `?url` import gives a stable URL in dev and prod.
  // @ts-ignore — vite's ?url suffix is not in the public types
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const pageCount = pdf.numPages;

  const parts: string[] = [];
  let totalLen = 0;
  let truncated = false;
  let ocrUsed = false;
  // Track pages that yielded almost no embedded text — candidates for OCR.
  const scannedPages: number[] = [];
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // Reconstruct lines from the y-coordinates of text items. pdfjs returns
    // items as a flat list of {str, transform}; lines are items with
    // similar y values.
    const lines: string[] = [];
    let currentY: number | null = null;
    let currentLine = '';
    for (const item of content.items as any[]) {
      if (!item.str) continue;
      const y = item.transform[5];
      if (currentY === null) {
        currentY = y;
        currentLine = item.str;
        continue;
      }
      // If y differs by more than 2, we're on a new line.
      if (Math.abs(y - currentY) > 2) {
        if (currentLine) lines.push(currentLine.trim());
        currentLine = item.str;
        currentY = y;
      } else {
        currentLine += (currentLine.endsWith(' ') || item.str.startsWith(' ') ? '' : ' ') + item.str;
      }
    }
    if (currentLine) lines.push(currentLine.trim());
    const pageText = lines.filter(Boolean).join('\n');

    // A page with almost no embedded text is likely a scan — mark for OCR.
    if (pageText.replace(/\s/g, '').length < OCR_MIN_CHARS_PER_PAGE) {
      scannedPages.push(i);
    }

    parts.push(pageText);
    totalLen += pageText.length;
    if (totalLen > MAX_TEXT_BYTES) {
      truncated = true;
      break;
    }
  }

  // ── OCR fallback for scanned pages ──────────────────────────────────────────
  // If a meaningful fraction of pages had no text, run OCR on those pages and
  // splice the recognized text into the right slots.
  if (scannedPages.length > 0 && !truncated) {
    const toOcr = scannedPages.slice(0, OCR_MAX_PAGES);
    try {
      const ocrTexts = await ocrPdfPages(pdf, toOcr);
      for (const [pageNum, text] of Object.entries(ocrTexts)) {
        const idx = Number(pageNum) - 1;
        if (text.trim() && idx < parts.length) {
          parts[idx] = text.trim();
          ocrUsed = true;
        }
      }
    } catch {
      // OCR failed (worker load, memory) — keep whatever embedded text we had.
    }
  }

  return { text: parts.join('\n\n'), pageCount, truncated, ocrUsed };
}

// ── OCR ─────────────────────────────────────────────────────────────────────
// Render the given PDF pages to a canvas and run tesseract.js on each.
// tesseract.js is lazy-loaded (large: ~2MB + language data) so only users
// who upload a scanned PDF pay the cost.
async function ocrPdfPages(pdf: any, pageNums: number[]): Promise<Record<number, string>> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng');
  const results: Record<number, string> = {};
  try {
    for (const pageNum of pageNums) {
      const page = await pdf.getPage(pageNum);
      // Render at 2x scale for better OCR accuracy on small text.
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      await page.render({ canvasContext: ctx, viewport }).promise;
      const { data } = await worker.recognize(canvas);
      results[pageNum] = data.text;
      canvas.width = 0; canvas.height = 0; // free memory
    }
  } finally {
    await worker.terminate();
  }
  return results;
}

// ── Plain text ────────────────────────────────────────────────────────────────
async function extractFromText(file: File): Promise<ExtractResult> {
  const text = await file.text();
  const truncated = text.length > MAX_TEXT_BYTES;
  return { text: truncated ? text.slice(0, MAX_TEXT_BYTES) : text, truncated };
}

// ── PPTX (PowerPoint, Open XML) ───────────────────────────────────────────────
// A .pptx is a ZIP of XML. Each slide's text lives in `ppt/slides/slideN.xml`
// as <a:t>…</a:t> runs. We unzip with jszip (lazy-loaded so only PPTX
// uploaders pay for it), collect the <a:t> contents per slide, and join
// slides with double newlines. Notes pages (`ppt/notesSlides/…`) are
// included when present so presenter notes become study material too.
async function extractFromPptx(file: File): Promise<ExtractResult> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  // Collect slide XML entries, sorted by slide number (slide1, slide2, …).
  const slideEntries = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml$/i)?.[1] ?? 0);
      const nb = Number(b.match(/slide(\d+)\.xml$/i)?.[1] ?? 0);
      return na - nb;
    });

  const noteEntries = Object.keys(zip.files)
    .filter(name => /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const na = Number(a.match(/notesSlide(\d+)\.xml$/i)?.[1] ?? 0);
      const nb = Number(b.match(/notesSlide(\d+)\.xml$/i)?.[1] ?? 0);
      return na - nb;
    });

  const parts: string[] = [];
  let totalLen = 0;
  let truncated = false;

  const pullTextRuns = (xml: string): string[] =>
    [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi)]
      .map(m => decodeXmlEntities(m[1].trim()))
      .filter(Boolean);

  const decodeXmlEntities = (s: string) =>
    s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

  for (const name of slideEntries) {
    const xml = await zip.files[name].async('string');
    const runs = pullTextRuns(xml);
    let slideText = runs.join('\n');
    // Append notes for this slide if present (notesSlideN pairs with slideN).
    const slideNum = Number(name.match(/slide(\d+)\.xml$/i)?.[1] ?? 0);
    const noteXml = noteEntries.find(n => Number(n.match(/notesSlide(\d+)\.xml$/i)?.[1] ?? 0) === slideNum);
    if (noteXml) {
      const noteRuns = pullTextRuns(await zip.files[noteXml].async('string'));
      if (noteRuns.length) slideText += `\n\nNotes:\n${noteRuns.join('\n')}`;
    }
    parts.push(slideText);
    totalLen += slideText.length;
    if (totalLen > MAX_TEXT_BYTES) { truncated = true; break; }
  }

  if (parts.length === 0) {
    throw new Error('No text found in this PPTX. It may be image-only slides.');
  }

  return { text: parts.join('\n\n'), pageCount: slideEntries.length, truncated };
}
