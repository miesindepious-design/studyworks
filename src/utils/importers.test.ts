/**
 * Tests for the importers.
 *
 * Each importer is tested against the shape the source actually produces,
 * because the whole point is that a student's existing deck does not have to
 * be retyped.
 */
import { describe, it, expect } from 'vitest';
import {
  parseDelimited,
  parseDocument,
  parseNotion,
  parseQuizlet,
  detectFormat,
  importCards,
  splitDelimited,
  guessDelimiter,
  type ImportPreview,
} from './importers';

const cardsOf = (p: ImportPreview) => p.cards.map(c => `${c.question} → ${c.answer}`);

describe('splitDelimited', () => {
  it('keeps a quoted comma inside one field', () => {
    expect(splitDelimited('a,"b,c",d', ',')).toEqual(['a', 'b,c', 'd']);
  });

  it('handles an escaped quote', () => {
    expect(splitDelimited('a,"say ""hi""",c', ',')).toEqual(['a', 'say "hi"', 'c']);
  });
});

describe('guessDelimiter', () => {
  it('picks tabs for a Quizlet export', () => {
    expect(guessDelimiter('term\tdefinition\nx\ty')).toBe('\t');
  });

  it('picks commas for a CSV', () => {
    expect(guessDelimiter('a,b,c\n1,2,3')).toBe(',');
  });
});

describe('parseQuizlet', () => {
  it('reads a Quizlet tab export', () => {
    const file = [
      'Term\tDefinition\tImage',
      'Mitochondrion\tThe powerhouse of the cell\timg1.png',
      'Ribosome\tWhere proteins are made\timg2.png',
    ].join('\n');
    const preview = parseQuizlet(file);
    expect(preview.format).toBe('quizlet');
    expect(cardsOf(preview)).toEqual([
      'Mitochondrion → The powerhouse of the cell',
      'Ribosome → Where proteins are made',
    ]);
  });

  it('drops the image column and says so', () => {
    const preview = parseQuizlet('Term\tDefinition\tImage\nX\tY\tz.png');
    expect(preview.cards[0].answer).toBe('Y');
    expect(preview.warnings.join(' ')).toContain('images are not imported');
  });

  it('reads a Quizlet export with no header row', () => {
    const preview = parseQuizlet('Alpha\tOne\nBeta\tTwo');
    expect(cardsOf(preview)).toEqual(['Alpha → One', 'Beta → Two']);
  });

  it('skips rows with an empty definition', () => {
    const preview = parseQuizlet('Term\tDefinition\nAlpha\t\nBeta\tTwo');
    expect(preview.cards).toHaveLength(1);
  });
});

describe('parseNotion', () => {
  it('reads a Notion CSV export', () => {
    const file = [
      'ID,Name,Tags,Created,Last edited,Content',
      'abc123,Cell Biology,biology,2026-01-01,2026-02-01,"The cell membrane controls what enters."',
      'def456,Photosynthesis,plants,2026-01-02,2026-02-02,"Plants turn light into sugar."',
    ].join('\n');
    const preview = parseNotion(file);
    expect(preview.format).toBe('notion');
    expect(cardsOf(preview)).toEqual([
      'Cell Biology → The cell membrane controls what enters.',
      'Photosynthesis → Plants turn light into sugar.',
    ]);
  });

  it('keeps the tags', () => {
    const file = 'ID,Name,Tags,Created\nx,Title,"bio, year 1",2026-01-01';
    const preview = parseNotion(file);
    expect(preview.cards[0].tags).toEqual(['bio', 'year 1']);
  });

  it('does not repeat the title in the answer', () => {
    const file = 'ID,Name,Tags,Created,Content\nx,Cell Biology,,2026-01-01,"Cell Biology is the study of cells."';
    const preview = parseNotion(file);
    expect(preview.cards[0].answer).toBe('is the study of cells.');
  });

  it('falls back to the document importer for a Markdown export', () => {
    const md = '# Mitochondrion\n\nThe powerhouse of the cell.\n\n# Ribosome\n\nWhere proteins are made.';
    const preview = parseNotion(md);
    expect(cardsOf(preview)).toEqual([
      'Mitochondrion → The powerhouse of the cell.',
      'Ribosome → Where proteins are made.',
    ]);
  });
});

describe('parseDelimited', () => {
  it('reads a spreadsheet with a Front/Back header', () => {
    const file = 'Front,Back\nWhat is ATP?,Adenosine triphosphate';
    const preview = parseDelimited(file);
    expect(cardsOf(preview)).toEqual(['What is ATP? → Adenosine triphosphate']);
  });

  it('reads a spreadsheet with no header', () => {
    const preview = parseDelimited('What is ATP?,Adenosine triphosphate');
    expect(cardsOf(preview)).toEqual(['What is ATP? → Adenosine triphosphate']);
  });
});

describe('parseDocument', () => {
  it('reads Q:/A: pairs', () => {
    const doc = [
      'Q: What is the powerhouse of the cell?',
      'A: The mitochondrion.',
      '',
      'Q: What is ATP?',
      'A: Adenosine triphosphate.',
    ].join('\n');
    const preview = parseDocument(doc);
    expect(cardsOf(preview)).toEqual([
      'What is the powerhouse of the cell? → The mitochondrion.',
      'What is ATP? → Adenosine triphosphate.',
    ]);
  });

  it('keeps a multi-line answer together', () => {
    const doc = [
      'Q: What is diffusion?',
      'A: The movement of particles.',
      'It needs no energy.',
    ].join('\n');
    const preview = parseDocument(doc);
    expect(preview.cards[0].answer).toContain('It needs no energy.');
  });

  it('reads Term:/Definition: pairs', () => {
    const doc = 'Term: Mitochondrion\nDefinition: The powerhouse of the cell';
    const preview = parseDocument(doc);
    expect(cardsOf(preview)).toEqual(['Mitochondrion → The powerhouse of the cell']);
  });

  it('reads a markdown heading and the text under it', () => {
    const doc = [
      '# Mitochondrion',
      '',
      'The powerhouse of the cell.',
      '',
      '# Ribosome',
      '',
      'Where proteins are made.',
    ].join('\n');
    const preview = parseDocument(doc);
    expect(cardsOf(preview)).toEqual([
      'Mitochondrion → The powerhouse of the cell.',
      'Ribosome → Where proteins are made.',
    ]);
  });

  it('reads a markdown table', () => {
    const doc = [
      '| Question | Answer |',
      '| --- | --- |',
      '| What is ATP? | Adenosine triphosphate |',
      '| What is DNA? | Deoxyribonucleic acid |',
    ].join('\n');
    const preview = parseDocument(doc);
    expect(cardsOf(preview)).toEqual([
      'What is ATP? → Adenosine triphosphate',
      'What is DNA? → Deoxyribonucleic acid',
    ]);
  });

  it('pairs blocks in order when there are no markers', () => {
    const doc = 'What is ATP?\n\nAdenosine triphosphate.\n\nWhat is DNA?\n\nDeoxyribonucleic acid.';
    const preview = parseDocument(doc);
    expect(cardsOf(preview)).toEqual([
      'What is ATP? → Adenosine triphosphate.',
      'What is DNA? → Deoxyribonucleic acid.',
    ]);
    expect(preview.warnings.join(' ')).toContain('Check the preview');
  });

  it('says so when nothing could be found', () => {
    const preview = parseDocument('Just one lonely sentence.');
    expect(preview.cards).toHaveLength(0);
    expect(preview.warnings.join(' ')).toContain('No questions');
  });
});

describe('detectFormat', () => {
  it('recognises a Quizlet export by its header', () => {
    expect(detectFormat('cards.txt', 'Term\tDefinition\nx\ty')).toBe('quizlet');
  });

  it('recognises a Notion CSV by its header', () => {
    expect(detectFormat('export.csv', 'ID,Name,Created,Last edited')).toBe('notion');
  });

  it('treats a .docx as a document', () => {
    expect(detectFormat('Lecture 3.docx', 'anything')).toBe('document');
  });

  it('treats an unknown file as a document', () => {
    expect(detectFormat('notes.txt', 'Q: a\nA: b')).toBe('document');
  });
});

describe('importCards', () => {
  it('routes a Quizlet file to the Quizlet importer', () => {
    const preview = importCards('cards.txt', 'Term\tDefinition\nMitochondrion\tPowerhouse');
    expect(preview.format).toBe('quizlet');
    expect(preview.cards).toHaveLength(1);
  });

  it('routes a document to the document importer', () => {
    const preview = importCards('Lecture.docx', 'Q: What is ATP?\nA: Energy.');
    expect(preview.format).toBe('document');
    expect(preview.cards[0].answer).toBe('Energy.');
  });
});
