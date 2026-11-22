/**
 * docBuilders.ts — render a tutor document into a real file.
 *
 * Three writers, one model:
 *   • buildDocx  — Word handout (the `docx` package)
 *   • buildPptx  — slide deck (the `pptxgenjs` package)
 *   • buildPdf   — printable worksheet (the `pdf-lib` package we already had)
 *
 * The two big libraries are imported dynamically, so they land in their own
 * chunk and only download when a student actually saves a document.
 */
import type { DocBlock, TutorDocModel } from './tutorDoc';
import { parseInline, stripInline } from './tutorDoc';

const ACCENT = '6366F1';
const TEXT = '1E293B';
const MUTED = '64748B';
const LINE = 'E2E8F0';

export interface BuiltDocument {
  blob: Blob;
  fileName: string;
}

// ── SVG diagrams → PNG ──────────────────────────────────────────────────────
// A diagram the tutor drew is an SVG. Word, PowerPoint and PDF all want a
// raster image, so the SVG is drawn onto a canvas and kept as a PNG. If the
// browser refuses (a broken diagram, a locked-down environment) the diagram
// falls back to its text.

interface Rasterised {
  bytes: Uint8Array;
  dataUri: string;
  width: number;
  height: number;
}

/** Read the height out of a viewBox so the canvas keeps the right shape. */
function svgAspect(svg: string): { width: number; height: number } {
  const viewBox = svg.match(/viewBox\s*=\s*["']\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)/i);
  if (viewBox) {
    const w = Number(viewBox[3]);
    const h = Number(viewBox[4]);
    if (w > 0 && h > 0) return { width: w, height: h };
  }
  const wAttr = svg.match(/\bwidth\s*=\s*["']([\d.]+)/i);
  const hAttr = svg.match(/\bheight\s*=\s*["']([\d.]+)/i);
  if (wAttr && hAttr) return { width: Number(wAttr[1]), height: Number(hAttr[1]) };
  return { width: 680, height: 420 };
}

async function rasteriseSvg(svg: string, targetWidth = 1100): Promise<Rasterised | null> {
  try {
    const size = svgAspect(svg);
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('The diagram could not be rendered.'));
        img.src = url;
      });
      const width = targetWidth;
      const height = Math.max(240, Math.min(2200, Math.round((width * size.height) / size.width)));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      const png = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/png'));
      if (!png) return null;
      const bytes = new Uint8Array(await png.arrayBuffer());
      const dataUri = `data:image/png;base64,${arrayBufferToBase64(bytes)}`;
      return { bytes, dataUri, width, height };
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

function arrayBufferToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** A safe file name for the download. */
export function documentFileName(model: TutorDocModel, format: string): string {
  const slug = (model.topic || model.title || 'studyworks')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'studyworks';
  const day = model.generatedAt.toISOString().slice(0, 10);
  return `${slug}-${day}.${format}`;
}

// ── Word (.docx) ─────────────────────────────────────────────────────────────

export async function buildDocx(model: TutorDocModel): Promise<BuiltDocument> {
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
    ImageRun, AlignmentType, BorderStyle, WidthType, ShadingType,
  } = await import('docx');

  const children: any[] = [];

  // ── Title block ───────────────────────────────────────────────────────────
  children.push(new Paragraph({
    children: [new TextRun({ text: model.title, bold: true, size: 40, color: TEXT })],
    spacing: { after: 80 },
  }));
  if (model.subtitle && model.subtitle !== model.title) {
    children.push(new Paragraph({
      children: [new TextRun({ text: model.subtitle, size: 26, color: MUTED })],
      spacing: { after: 160 },
    }));
  }
  children.push(new Paragraph({
    children: [new TextRun({ text: model.meta.join('  ·  '), size: 18, color: MUTED })],
    spacing: { after: 320 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: LINE, space: 8 } },
  }));

  for (const block of model.blocks) {
    switch (block.kind) {
      case 'heading': {
        const level = block.level === 1 ? HeadingLevel.HEADING_1
          : block.level === 2 ? HeadingLevel.HEADING_2
          : HeadingLevel.HEADING_3;
        children.push(new Paragraph({
          children: [new TextRun({ text: block.text, bold: true })],
          heading: level,
          spacing: { before: block.level === 1 ? 320 : 240, after: 120 },
        }));
        break;
      }
      case 'paragraph': {
        children.push(new Paragraph({
          children: docxRuns(block.text, TextRun),
          spacing: { after: 140, line: 300 },
        }));
        break;
      }
      case 'bullets': {
        for (const item of block.items) {
          children.push(new Paragraph({
            children: docxRuns(item, TextRun),
            bullet: { level: 0 },
            spacing: { after: 80, line: 290 },
          }));
        }
        break;
      }
      case 'numbers': {
        block.items.forEach((item, index) => {
          children.push(new Paragraph({
            children: [new TextRun({ text: `${index + 1}. `, bold: true }), ...docxRuns(item, TextRun)],
            spacing: { after: 80, line: 290 },
          }));
        });
        break;
      }
      case 'table': {
        const rows = [block.header, ...block.rows].map((cells, rowIndex) =>
          new TableRow({
            children: cells.map(cell => new TableCell({
              children: [new Paragraph({
                children: [new TextRun({ text: stripInline(cell), bold: rowIndex === 0, size: 20 })],
              })],
              shading: rowIndex === 0
                ? { type: ShadingType.CLEAR, fill: 'F1F5F9' }
                : undefined,
            })),
          }));
        children.push(new Table({
          rows,
          width: { size: 100, type: WidthType.PERCENTAGE },
        }));
        children.push(new Paragraph({ text: '', spacing: { after: 160 } }));
        break;
      }
      case 'quote': {
        children.push(new Paragraph({
          children: [new TextRun({ text: block.text, italics: true, color: MUTED })],
          indent: { left: 360 },
          spacing: { after: 160, line: 290 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 10 } },
        }));
        break;
      }
      case 'code': {
        for (const line of block.text.split('\n')) {
          children.push(new Paragraph({
            children: [new TextRun({ text: line, font: 'Courier New', size: 18, color: TEXT })],
            spacing: { after: 0, line: 240 },
            shading: { type: ShadingType.CLEAR, fill: 'F8FAFC' },
          }));
        }
        children.push(new Paragraph({ text: '', spacing: { after: 160 } }));
        break;
      }
      case 'diagram': {
        const raster = await rasteriseSvg(block.svg);
        if (raster) {
          const maxWidth = 600;
          const scale = Math.min(1, maxWidth / raster.width);
          children.push(new Paragraph({
            children: [new ImageRun({
              type: 'png',
              data: raster.bytes,
              transformation: { width: Math.round(raster.width * scale), height: Math.round(raster.height * scale) },
            })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 160 },
          }));
        } else {
          children.push(new Paragraph({
            children: [new TextRun({ text: '[diagram]', italics: true, color: MUTED })],
            spacing: { after: 120 },
          }));
        }
        break;
      }
      case 'callout': {
        children.push(new Paragraph({
          children: [new TextRun({ text: `${block.title}`, bold: true, color: ACCENT })],
          spacing: { before: 120, after: 60 },
        }));
        for (const line of block.text.split('\n')) {
          children.push(new Paragraph({
            children: [new TextRun({ text: `• ${stripInline(line)}`, size: 20 })],
            spacing: { after: 60, line: 280 },
          }));
        }
        break;
      }
      case 'divider': {
        children.push(new Paragraph({
          text: '',
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 6 } },
          spacing: { after: 200 },
        }));
        break;
      }
    }
  }

  const doc = new Document({
    creator: 'StudyWorks AI Tutor',
    title: model.title,
    description: model.subtitle,
    sections: [{
      properties: {
        page: { margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 } },
      },
      children,
    }],
  });

  const blob = await Packer.toBlob(doc);
  return { blob, fileName: documentFileName(model, 'docx') };
}

/** Inline runs → Word runs. */
function docxRuns(text: string, TextRun: any): any[] {
  return parseInline(text).map(run => new TextRun({
    text: run.text,
    bold: run.bold,
    italics: run.italic,
    font: run.code ? 'Courier New' : undefined,
    size: run.code ? 18 : undefined,
  }));
}

// ── PowerPoint (.pptx) ───────────────────────────────────────────────────────

export async function buildPptx(model: TutorDocModel): Promise<BuiltDocument> {
  const { default: PptxGenJS } = await import('pptxgenjs');

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'StudyWorks AI Tutor';
  pptx.title = model.title;

  // ── Title slide ──────────────────────────────────────────────────────────
  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: 'FFFFFF' };
  titleSlide.addText(model.title, {
    x: 0.6, y: 1.7, w: 8.8, h: 1.2,
    fontSize: 34, bold: true, color: TEXT, align: 'left',
  });
  titleSlide.addText(model.subtitle && model.subtitle !== model.title ? model.subtitle : model.meta.join('  ·  '), {
    x: 0.6, y: 2.9, w: 8.8, h: 0.6,
    fontSize: 16, color: MUTED,
  });
  titleSlide.addText(model.meta.join('  ·  '), {
    x: 0.6, y: 4.6, w: 8.8, h: 0.4,
    fontSize: 11, color: MUTED,
  });

  // ── One slide per section ────────────────────────────────────────────────
  // A heading starts a new slide; everything until the next heading belongs
  // to it. Content that is not under a heading goes on a "Overview" slide.
  const sections = groupIntoSections(model.blocks);
  for (const section of sections) {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addText(section.heading, {
      x: 0.5, y: 0.35, w: 9, h: 0.6,
      fontSize: 24, bold: true, color: ACCENT,
    });

    const body = section.blocks;
    const bullets: any[] = [];
    const notes: string[] = [];

    for (const block of body) {
      if (block.kind === 'bullets' || block.kind === 'numbers') {
        for (const item of block.items) {
          bullets.push({ text: stripInline(item), options: { bullet: true, breakLine: true } });
        }
      } else if (block.kind === 'paragraph') {
        bullets.push({ text: stripInline(block.text), options: { breakLine: true } });
      } else if (block.kind === 'callout') {
        bullets.push({ text: `${block.title}`, options: { bold: true, breakLine: true } });
        for (const line of block.text.split('\n')) {
          bullets.push({ text: stripInline(line), options: { bullet: true, breakLine: true } });
        }
      } else if (block.kind === 'table') {
        const rows = [block.header, ...block.rows]
          .map(r => r.map(stripInline).join('   ·   '))
          .join('\n');
        bullets.push({ text: rows, options: { breakLine: true, fontSize: 12 } });
      } else if (block.kind === 'quote') {
        bullets.push({ text: `“${stripInline(block.text)}”`, options: { italic: true, breakLine: true } });
      } else if (block.kind === 'code' || block.kind === 'diagram') {
        notes.push(block.kind === 'code' ? block.text : '[diagram]');
      }
    }

    if (bullets.length > 0) {
      slide.addText(bullets, {
        x: 0.6, y: 1.15, w: 8.8, h: 3.9,
        fontSize: 16, color: TEXT, valign: 'top', lineSpacingMultiple: 1.15,
      });
    }

    // A diagram gets its own slide — it is the picture, not a bullet.
    const diagram = body.find(b => b.kind === 'diagram');
    if (diagram && diagram.kind === 'diagram') {
      const raster = await rasteriseSvg(diagram.svg);
      if (raster) {
        const slide2 = pptx.addSlide();
        slide2.background = { color: 'FFFFFF' };
        slide2.addText(section.heading, { x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 20, bold: true, color: TEXT });
        const maxW = 8.4;
        const maxH = 4.6;
        const scale = Math.min(maxW / raster.width, maxH / raster.height);
        slide2.addImage({
          data: raster.dataUri,
          x: 0.8, y: 1.0,
          w: raster.width * scale,
          h: raster.height * scale,
        });
      }
    }

    if (notes.length > 0) {
      slide.addNotes?.(notes.join('\n\n'));
    }
  }

  const blob = (await pptx.write({ outputType: 'blob' })) as Blob;
  return { blob, fileName: documentFileName(model, 'pptx') };
}

/** Split a flat block list into sections, one per heading. */
function groupIntoSections(blocks: DocBlock[]): { heading: string; blocks: DocBlock[] }[] {
  const sections: { heading: string; blocks: DocBlock[] }[] = [];
  let current: { heading: string; blocks: DocBlock[] } | null = null;

  for (const block of blocks) {
    if (block.kind === 'heading' && block.level <= 2) {
      current = { heading: block.text, blocks: [] };
      sections.push(current);
      continue;
    }
    if (!current) {
      current = { heading: 'Overview', blocks: [] };
      sections.push(current);
    }
    current.blocks.push(block);
  }

  return sections.length ? sections : [{ heading: 'Overview', blocks }];
}

// ── PDF (printable worksheet) ───────────────────────────────────────────────

const PDF_W = 595.28;
const PDF_H = 841.89;
const PDF_MARGIN = 52;
const PDF_CONTENT_W = PDF_W - PDF_MARGIN * 2;

export async function buildPdf(model: TutorDocModel): Promise<BuiltDocument> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');

  const pdf = await PDFDocument.create();
  pdf.setTitle(model.title);
  pdf.setAuthor('StudyWorks AI Tutor');

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const mono = await pdf.embedFont(StandardFonts.Courier);

  const colText = rgb(0.118, 0.161, 0.231);
  const colMuted = rgb(0.392, 0.455, 0.545);
  const colAccent = rgb(0.388, 0.4, 0.945);
  const colLine = rgb(0.89, 0.906, 0.941);

  let page = pdf.addPage([PDF_W, PDF_H]);
  let y = PDF_H - PDF_MARGIN;

  const newPage = () => {
    page = pdf.addPage([PDF_W, PDF_H]);
    y = PDF_H - PDF_MARGIN;
  };
  const ensure = (needed: number) => {
    if (y - needed < PDF_MARGIN) newPage();
  };
  const wrap = (text: string, font: any, size: number, maxWidth: number): string[] => {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
      } else {
        if (line) lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  };
  const drawLines = (
    text: string,
    font: any,
    size: number,
    color: any,
    lineHeight = size * 1.45,
    indent = 0,
  ) => {
    for (const line of wrap(text, font, size, PDF_CONTENT_W - indent)) {
      ensure(lineHeight);
      page.drawText(line, { x: PDF_MARGIN + indent, y: y - size, size, font, color });
      y -= lineHeight;
    }
  };

  // ── Title block ──────────────────────────────────────────────────────────
  for (const line of wrap(model.title, bold, 22, PDF_CONTENT_W)) {
    ensure(28);
    page.drawText(line, { x: PDF_MARGIN, y: y - 22, size: 22, font: bold, color: colText });
    y -= 28;
  }
  if (model.subtitle && model.subtitle !== model.title) {
    y -= 4;
    for (const line of wrap(model.subtitle, regular, 12, PDF_CONTENT_W)) {
      ensure(18);
      page.drawText(line, { x: PDF_MARGIN, y: y - 12, size: 12, font: regular, color: colMuted });
      y -= 18;
    }
  }
  y -= 8;
  for (const line of wrap(model.meta.join('  ·  '), regular, 9, PDF_CONTENT_W)) {
    ensure(14);
    page.drawText(line, { x: PDF_MARGIN, y: y - 9, size: 9, font: regular, color: colMuted });
    y -= 14;
  }
  y -= 6;
  page.drawLine({
    start: { x: PDF_MARGIN, y },
    end: { x: PDF_W - PDF_MARGIN, y },
    thickness: 0.8,
    color: colLine,
  });
  y -= 18;

  // ── Body ─────────────────────────────────────────────────────────────────
  for (const block of model.blocks) {
    switch (block.kind) {
      case 'heading': {
        y -= block.level === 1 ? 8 : 4;
        const size = block.level === 1 ? 16 : block.level === 2 ? 13 : 11;
        for (const line of wrap(block.text, bold, size, PDF_CONTENT_W)) {
          ensure(size * 1.5);
          page.drawText(line, { x: PDF_MARGIN, y: y - size, size, font: bold, color: colText });
          y -= size * 1.45;
        }
        y -= 4;
        break;
      }
      case 'paragraph':
        drawLines(block.text, regular, 10, colText);
        y -= 6;
        break;
      case 'bullets':
        for (const item of block.items) {
          for (const [index, line] of wrap(`• ${stripInline(item)}`, regular, 10, PDF_CONTENT_W - 12).entries()) {
            ensure(15);
            page.drawText(line, { x: PDF_MARGIN + 12, y: y - 10, size: 10, font: regular, color: colText });
            y -= 15;
            if (index === 0) continue;
          }
        }
        y -= 6;
        break;
      case 'numbers':
        block.items.forEach((item, index) => {
          for (const [lineIndex, line] of wrap(`${index + 1}. ${stripInline(item)}`, regular, 10, PDF_CONTENT_W - 16).entries()) {
            ensure(15);
            page.drawText(line, { x: PDF_MARGIN + 16, y: y - 10, size: 10, font: regular, color: colText });
            y -= 15;
            if (lineIndex === 0) continue;
          }
        });
        y -= 6;
        break;
      case 'table': {
        const columns = Math.max(block.header.length, ...block.rows.map(r => r.length), 1);
        const colWidth = PDF_CONTENT_W / columns;
        const drawRow = (cells: string[], isHeader: boolean) => {
          const font = isHeader ? bold : regular;
          const size = 9;
          const cellLines = Array.from({ length: columns }, (_, c) =>
            wrap(stripInline(cells[c] ?? ''), font, size, colWidth - 8));
          const height = Math.max(...cellLines.map(l => l.length)) * (size * 1.35) + 6;
          ensure(height);
          const top = y;
          cellLines.forEach((lines, c) => {
            lines.forEach((line, li) => {
              page.drawText(line, {
                x: PDF_MARGIN + c * colWidth + 4,
                y: top - size - li * size * 1.35,
                size, font,
                color: isHeader ? colText : colMuted,
              });
            });
          });
          y -= height;
          page.drawLine({
            start: { x: PDF_MARGIN, y: y + 4 },
            end: { x: PDF_W - PDF_MARGIN, y: y + 4 },
            thickness: 0.5,
            color: colLine,
          });
        };
        drawRow(block.header, true);
        for (const row of block.rows) drawRow(row, false);
        y -= 8;
        break;
      }
      case 'quote':
        for (const line of wrap(block.text, italic, 10, PDF_CONTENT_W - 20)) {
          ensure(15);
          page.drawText(line, { x: PDF_MARGIN + 20, y: y - 10, size: 10, font: italic, color: colMuted });
          y -= 15;
        }
        y -= 6;
        break;
      case 'code':
        for (const line of block.text.split('\n')) {
          ensure(13);
          page.drawText(line, { x: PDF_MARGIN + 12, y: y - 9, size: 9, font: mono, color: colText });
          y -= 13;
        }
        y -= 6;
        break;
      case 'diagram': {
        const raster = await rasteriseSvg(block.svg);
        if (raster) {
          const maxW = PDF_CONTENT_W;
          const maxH = 320;
          const scale = Math.min(maxW / raster.width, maxH / raster.height);
          const w = raster.width * scale;
          const h = raster.height * scale;
          ensure(h + 10);
          const png = await pdf.embedPng(raster.bytes);
          page.drawImage(png, { x: PDF_MARGIN, y: y - h, width: w, height: h });
          y -= h + 12;
        } else {
          drawLines('[diagram]', italic, 9, colMuted);
        }
        break;
      }
      case 'callout': {
        ensure(16);
        page.drawText(block.title, { x: PDF_MARGIN, y: y - 10, size: 10, font: bold, color: colAccent });
        y -= 16;
        for (const line of block.text.split('\n')) {
          for (const wrapped of wrap(`• ${stripInline(line)}`, regular, 10, PDF_CONTENT_W - 12)) {
            ensure(15);
            page.drawText(wrapped, { x: PDF_MARGIN + 12, y: y - 10, size: 10, font: regular, color: colText });
            y -= 15;
          }
        }
        y -= 6;
        break;
      }
      case 'divider':
        ensure(14);
        page.drawLine({
          start: { x: PDF_MARGIN, y },
          end: { x: PDF_W - PDF_MARGIN, y },
          thickness: 0.5,
          color: colLine,
        });
        y -= 14;
        break;
    }
  }

  // ── Page numbers ─────────────────────────────────────────────────────────
  const pages = pdf.getPages();
  pages.forEach((p, index) => {
    const label = `${index + 1} / ${pages.length}`;
    p.drawText(label, {
      x: PDF_W - PDF_MARGIN - regular.widthOfTextAtSize(label, 8),
      y: PDF_MARGIN - 18,
      size: 8,
      font: regular,
      color: colMuted,
    });
  });

  const bytes = await pdf.save();
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
  return { blob, fileName: documentFileName(model, 'pdf') };
}

// ── One entry point ─────────────────────────────────────────────────────────

/** Build the document in the requested format. */
export async function buildDocument(
  model: TutorDocModel,
  format: 'docx' | 'pdf' | 'pptx',
): Promise<BuiltDocument> {
  if (format === 'pdf') return buildPdf(model);
  if (format === 'pptx') return buildPptx(model);
  return buildDocx(model);
}

/** Save a blob to the user's machine. */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
