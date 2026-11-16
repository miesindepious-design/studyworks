/**
 * extractText.ts — extract plain text from uploaded files.
 *
 * Currently supports:
 *   - PDF (via pdfjs-dist) — the highest-value case, since PDFs are
 *     textbook chapters, papers, and reference material. Scanned pages
 *     automatically fall back to OCR.
 *   - DOCX (via jszip) — Word documents; paragraphs, headings and tables
 *     are reconstructed from the Open XML.
 *   - PPTX (via jszip) — PowerPoint decks; slides are unzipped and the
 *     <a:t> text runs are pulled out per slide.
 *   - Images (via tesseract.js OCR) — photos of notes, whiteboards and
 *     handwritten pages.
 *   - HTML — tags are stripped, text kept.
 *   - Text-based files (txt, md, csv, json) — read as plain text.
 *
 * Not supported:
 *   - DOC / PPT (legacy binary formats) — undocumented binary layouts.
 *     Only the modern Open XML formats are parsed.
 *   - Audio — would need speech-to-text.
 *
 * The output is plain text with paragraphs separated by double newlines.
 * The default cap is 120 KB of extracted text — large enough for a
 * textbook chapter, small enough to keep the AI prompt under reasonable
 * limits. Callers that need more (the document analyzer) can raise it.
 */

const DEFAULT_MAX_TEXT_BYTES = 120 * 1024;

// A page yielding fewer than this many characters of embedded text is treated
// as scanned/image-based and sent through OCR.
const OCR_MIN_CHARS_PER_PAGE = 20;
// Cap OCR to this many pages — OCR is slow (~2-5s/page) and we don't want to
// lock the browser on a 300-page scan.
const OCR_MAX_PAGES = 20;
// Images are downscaled to this width before OCR — big enough to read, small
// enough to keep the worker fast.
const OCR_MAX_IMAGE_WIDTH = 2200;

export interface ExtractOptions {
  /** Hard cap on extracted characters. Defaults to 120 KB of text. */
  maxBytes?: number;
  /** Set false to skip OCR entirely (much faster, empty for scans). */
  ocr?: boolean;
}

export interface ExtractResult {
  text: string;
  pageCount?: number;
  truncated: boolean;
  ocrUsed?: boolean;
  /** Which parser handled the file — shown in the UI. */
  kind?: 'pdf' | 'docx' | 'pptx' | 'image' | 'html' | 'text';
}

export async function extractTextFromFile(
  file: File,
  options: ExtractOptions = {},
): Promise<ExtractResult> {
  const name = file.name.toLowerCase();

  if (file.type === 'application/pdf' || name.endsWith('.pdf')) {
    return extractFromPdf(file, options);
  }
  if (name.endsWith('.docx')) {
    return extractFromDocx(file, options);
  }
  if (name.endsWith('.pptx')) {
    return extractFromPptx(file, options);
  }
  if (file.type.startsWith('image/')) {
    return extractFromImage(file, options);
  }
  if (file.type === 'text/html' || name.endsWith('.html') || name.endsWith('.htm')) {
    return extractFromHtml(file, options);
  }
  if (file.type.startsWith('text/') || /\.(txt|md|csv|json|markdown|rtf)$/i.test(name)) {
    return extractFromText(file, options);
  }
  throw new Error(
    `Cannot read ${file.type || file.name}. Supported: PDF, DOCX, PPTX, images (OCR), HTML and text files.`,
  );
}

// ── Shared helpers ───────────────────────────────────────────────────────────

function clamp(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (text.length <= maxBytes) return { text, truncated: false };
  return { text: text.slice(0, maxBytes), truncated: true };
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

// ── PDF ───────────────────────────────────────────────────────────────────────
// pdfjs-dist is a large dependency; we lazy-load it so the initial app
// bundle doesn't pay for users who never upload a PDF.
async function extractFromPdf(file: File, options: ExtractOptions): Promise<ExtractResult> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_TEXT_BYTES;
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
    if (totalLen > maxBytes) {
      truncated = true;
      break;
    }
  }

  // ── OCR fallback for scanned pages ──────────────────────────────────────────
  // If a meaningful fraction of pages had no text, run OCR on those pages and
  // splice the recognized text into the right slots.
  if (scannedPages.length > 0 && !truncated && options.ocr !== false) {
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

  return { text: parts.join('\n\n'), pageCount, truncated, ocrUsed, kind: 'pdf' };
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

// ── Images (OCR) ─────────────────────────────────────────────────────────────
// A photo of a whiteboard or a handwritten page has no embedded text, so the
// only way to read it is OCR.
async function extractFromImage(file: File, options: ExtractOptions): Promise<ExtractResult> {
  if (options.ocr === false) {
    throw new Error('OCR is disabled for image uploads.');
  }
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng');
  try {
    const canvas = await imageToCanvas(file);
    const { data } = await worker.recognize(canvas);
    const text = (data.text || '').trim();
    if (!text) {
      throw new Error('No text recognised in this image. Try a sharper photo or a PDF scan.');
    }
    const { text: clipped, truncated } = clamp(text, options.maxBytes ?? DEFAULT_MAX_TEXT_BYTES);
    return { text: clipped, truncated, ocrUsed: true, pageCount: 1, kind: 'image' };
  } finally {
    await worker.terminate();
  }
}

/** Load an image file into a canvas, downscaled to a sane OCR width. */
async function imageToCanvas(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not read this image file.'));
      el.src = url;
    });
    const scale = Math.min(1, OCR_MAX_IMAGE_WIDTH / (img.naturalWidth || OCR_MAX_IMAGE_WIDTH));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
    canvas.height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not prepare the image for reading.');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ── Plain text ───────────────────────────────────────────────────────────────
async function extractFromText(file: File, options: ExtractOptions): Promise<ExtractResult> {
  const text = await file.text();
  const { text: clipped, truncated } = clamp(text, options.maxBytes ?? DEFAULT_MAX_TEXT_BYTES);
  return { text: clipped, truncated, kind: 'text' };
}

// ── HTML ─────────────────────────────────────────────────────────────────────
// Strip the markup, keep the readable text, and turn block-level tags into
// line breaks so the result still reads like a document.
async function extractFromHtml(file: File, options: ExtractOptions): Promise<ExtractResult> {
  const html = await file.text();
  const text = decodeXmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<\/(p|div|section|article|h[1-6]|li|tr|br|blockquote|pre)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const { text: clipped, truncated } = clamp(text, options.maxBytes ?? DEFAULT_MAX_TEXT_BYTES);
  return { text: clipped, truncated, kind: 'html' };
}

// ── DOCX (Word, Open XML) ───────────────────────────────────────────────────
// A .docx is a ZIP of XML. The body lives in `word/document.xml` as a series
// of <w:p> paragraphs, each holding <w:t> text runs. Tables are <w:tbl> with
// <w:tr> rows, so a cell boundary becomes a separator inside the paragraph
// flow.
async function extractFromDocx(file: File, options: ExtractOptions): Promise<ExtractResult> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  const docEntry = zip.files['word/document.xml'];
  if (!docEntry) {
    throw new Error('This DOCX has no readable body — it may be empty or protected.');
  }
  const xml = await docEntry.async('string');

  // Paragraphs and table rows become separate blocks.
  const blocks = xml.split(/<\/w:(?:p|tr)>/i);

  const parts: string[] = [];
  let totalLen = 0;
  let truncated = false;

  for (const block of blocks) {
    // Runs inside a paragraph; <w:tab/> and <w:br/> become whitespace.
    const runs = [...block.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gi)]
      .map(m => decodeXmlEntities(m[1]))
      .join('');
    const text = runs
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    parts.push(text);
    totalLen += text.length;
    if (totalLen > (options.maxBytes ?? DEFAULT_MAX_TEXT_BYTES)) {
      truncated = true;
      break;
    }
  }

  if (parts.length === 0) {
    throw new Error('No text found in this DOCX — it may contain only images.');
  }

  const { text: clipped, truncated: clipTruncated } = clamp(
    parts.join('\n\n'),
    options.maxBytes ?? DEFAULT_MAX_TEXT_BYTES,
  );
  return { text: clipped, truncated: truncated || clipTruncated, pageCount: parts.length, kind: 'docx' };
}

// ── PPTX (PowerPoint, Open XML) ───────────────────────────────────────────────
// A .pptx is a ZIP of XML. Each slide's text lives in `ppt/slides/slideN.xml`
// as <a:t>…</a:t> runs. We unzip with jszip (lazy-loaded so only PPTX
// uploaders pay for it), collect the <a:t> contents per slide, and join
// slides with double newlines. Notes pages (`ppt/notesSlides/…`) are
// included when present so presenter notes become study material too.
async function extractFromPptx(file: File, options: ExtractOptions): Promise<ExtractResult> {
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
    if (totalLen > (options.maxBytes ?? DEFAULT_MAX_TEXT_BYTES)) { truncated = true; break; }
  }

  if (parts.length === 0) {
    throw new Error('No text found in this PPTX. It may be image-only slides.');
  }

  const { text: clipped, truncated: clipTruncated } = clamp(
    parts.join('\n\n'),
    options.maxBytes ?? DEFAULT_MAX_TEXT_BYTES,
  );
  return {
    text: clipped,
    truncated: truncated || clipTruncated,
    pageCount: slideEntries.length,
    kind: 'pptx',
  };
}
