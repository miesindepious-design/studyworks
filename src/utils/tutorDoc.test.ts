import { describe, it, expect } from 'vitest';
import {
  parseMarkdownBlocks, parseInline, stripInline,
  buildTutorDoc, chooseDocFormat, describeContext,
} from './tutorDoc';
import { buildPdf, buildDocx, buildPptx, documentFileName } from './docBuilders';

describe('parseMarkdownBlocks', () => {
  it('reads the shapes the tutor writes', () => {
    const md = [
      '## Photosynthesis',
      '',
      'Plants turn light into sugar.',
      '',
      '- Light is absorbed by chlorophyll',
      '- Carbon dioxide comes from the air',
      '',
      '| Stage | Where |',
      '| --- | --- |',
      '| Light reactions | Thylakoid |',
      '',
      '```diagram',
      'light → ATP',
      '```',
    ].join('\n');

    const blocks = parseMarkdownBlocks(md);
    const kinds = blocks.map(b => b.kind);

    expect(kinds).toContain('heading');
    expect(kinds).toContain('bullets');
    expect(kinds).toContain('table');
    expect(kinds).toContain('code');

    const table = blocks.find(b => b.kind === 'table');
    expect(table && table.kind === 'table' && table.header).toEqual(['Stage', 'Where']);
    expect(table && table.kind === 'table' && table.rows[0]).toEqual(['Light reactions', 'Thylakoid']);
  });

  it('keeps an SVG block as a diagram', () => {
    const blocks = parseMarkdownBlocks('```svg\n<svg viewBox="0 0 680 300"></svg>\n```');
    expect(blocks[0].kind).toBe('diagram');
  });

  it('reads numbered lists and quotes', () => {
    const blocks = parseMarkdownBlocks('1. First step\n2. Second step\n\n> remember this');
    expect(blocks.find(b => b.kind === 'numbers')).toMatchObject({ items: ['First step', 'Second step'] });
    expect(blocks.find(b => b.kind === 'quote')).toMatchObject({ text: 'remember this' });
  });
});

describe('inline formatting', () => {
  it('keeps bold, italic and code apart', () => {
    const runs = parseInline('a **b** c *d* e `f`');
    expect(runs.find(r => r.bold)?.text).toBe('b');
    expect(runs.find(r => r.italic)?.text).toBe('d');
    expect(runs.find(r => r.code)?.text).toBe('f');
  });

  it('strips the markers for the plain writer', () => {
    expect(stripInline('a **b** c')).toBe('a b c');
  });
});

describe('chooseDocFormat', () => {
  const base = { modes: ['lesson'] as const, hasBriefing: false, hasOutline: false, hasQuestions: false, length: 2000, headingCount: 2 };

  it('gives a quiz-shaped session a worksheet', () => {
    const choice = chooseDocFormat({
      ...base,
      modes: ['quiz', 'quiz'],
      hasQuestions: true,
    } as any);
    expect(choice.format).toBe('pdf');
  });

  it('gives a structured lesson a deck', () => {
    const choice = chooseDocFormat({
      ...base,
      modes: ['lesson'],
      hasOutline: true,
      headingCount: 5,
    } as any);
    expect(choice.format).toBe('pptx');
  });

  it('gives an ordinary lesson a handout', () => {
    const choice = chooseDocFormat({ ...base, modes: ['lesson'] } as any);
    expect(choice.format).toBe('docx');
  });
});

describe('buildTutorDoc', () => {
  it('collects the turns, the key points and the analysis', () => {
    const model = buildTutorDoc({
      topic: 'Photosynthesis',
      turns: [{
        mode: 'lesson',
        response: '## Photosynthesis\n\nPlants make sugar from light.',
        keyPoints: [{ point: 'Chlorophyll absorbs light', why: 'It starts the reaction', importance: 'must-know' }],
        analysis: {
          title: 'Photosynthesis',
          overview: 'How plants make food.',
          keyPoints: [],
          outline: [{ heading: 'Inputs', detail: 'light, CO2' }],
          glossary: [{ term: 'ATP', meaning: 'energy store' }],
          questions: ['What is chlorophyll?'],
        },
      }],
    });

    const kinds = model.blocks.map(b => b.kind);
    expect(kinds).toContain('heading');
    expect(kinds).toContain('callout');
    expect(kinds).toContain('table');
    expect(kinds).toContain('numbers');
    expect(model.meta.join(' ')).toContain('Photosynthesis');
  });

  it('describes the context of a session', () => {
    const ctx = describeContext({
      topic: 'Photosynthesis',
      turns: [{ mode: 'lesson', response: '## A\n\ntext\n\n## B\n\nmore' }],
    });
    expect(ctx.headingCount).toBe(2);
    expect(ctx.length).toBeGreaterThan(0);
  });
});

describe('document writers', () => {
  const model = buildTutorDoc({
    topic: 'Photosynthesis',
    turns: [{
      mode: 'lesson',
      response: '## Photosynthesis\n\nPlants make sugar from light.\n\n- Light is absorbed\n- CO2 comes from the air',
      keyPoints: [{ point: 'Chlorophyll absorbs light', why: 'It starts the reaction', importance: 'must-know' }],
    }],
  });

  it('writes a real PDF', async () => {
    const built = await buildPdf(model);
    expect(built.blob.size).toBeGreaterThan(500);
    expect(built.blob.type).toBe('application/pdf');
    expect(built.fileName.endsWith('.pdf')).toBe(true);
  }, 30_000);

  it('writes a real Word document', async () => {
    const built = await buildDocx(model);
    expect(built.blob.size).toBeGreaterThan(500);
    expect(built.fileName.endsWith('.docx')).toBe(true);
  }, 30_000);

  it('writes a real slide deck', async () => {
    const built = await buildPptx(model);
    expect(built.blob.size).toBeGreaterThan(1000);
    expect(built.fileName.endsWith('.pptx')).toBe(true);
  }, 30_000);

  it('names the file after the topic', () => {
    expect(documentFileName(model, 'pdf')).toMatch(/photosynthesis-\d{4}-\d{2}-\d{2}\.pdf$/);
  });
});
