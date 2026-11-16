/**
 * Tests for the "key points" parser.
 *
 * The tutor and the document analyzer both rely on this parser to pull a
 * structured list of important points out of a model reply, so it has to be
 * forgiving: models wrap the JSON in code fences, add trailing commas, or
 * fall back to a plain bullet list.
 */
import { describe, it, expect } from 'vitest';
import {
  extractKeyPointsBlock,
  parseKeyPoints,
  parseLoosePoints,
  normalizeImportance,
  KEY_POINTS_OPEN,
  KEY_POINTS_CLOSE,
} from '../lib/keyPoints.js';

describe('normalizeImportance', () => {
  it('maps the canonical values straight through', () => {
    expect(normalizeImportance('must-know')).toBe('must-know');
    expect(normalizeImportance('should-know')).toBe('should-know');
    expect(normalizeImportance('good-to-know')).toBe('good-to-know');
  });

  it('maps common synonyms', () => {
    expect(normalizeImportance('Essential')).toBe('must-know');
    expect(normalizeImportance('critical')).toBe('must-know');
    expect(normalizeImportance('Important')).toBe('should-know');
    expect(normalizeImportance('nice to know')).toBe('good-to-know');
    expect(normalizeImportance('optional')).toBe('good-to-know');
  });

  it('falls back to should-know for anything unknown', () => {
    expect(normalizeImportance('banana')).toBe('should-know');
    expect(normalizeImportance(undefined)).toBe('should-know');
    expect(normalizeImportance(42)).toBe('should-know');
  });
});

describe('parseKeyPoints', () => {
  it('parses an array of points', () => {
    const points = parseKeyPoints([
      { point: 'A', why: 'B', importance: 'must-know' },
      { point: 'C', why: 'D', importance: 'should-know' },
    ]);
    expect(points).toHaveLength(2);
    expect(points[0]).toEqual({ point: 'A', why: 'B', importance: 'must-know' });
    expect(points[1].importance).toBe('should-know');
  });

  it('parses a JSON string', () => {
    const points = parseKeyPoints('[{"point":"A","importance":"must-know"}]');
    expect(points).toHaveLength(1);
    expect(points[0].point).toBe('A');
  });

  it('unwraps a { keyPoints: [...] } object', () => {
    const points = parseKeyPoints({ keyPoints: [{ point: 'A', importance: 'must-know' }] });
    expect(points).toHaveLength(1);
    expect(points[0].point).toBe('A');
  });

  it('tolerates a code fence and a trailing comma', () => {
    const raw = '```json\n[{"point":"A","importance":"must-know"},]\n```';
    const points = parseKeyPoints(raw);
    expect(points).toHaveLength(1);
    expect(points[0].point).toBe('A');
  });

  it('accepts alternative field names', () => {
    const points = parseKeyPoints([{ text: 'A', reason: 'B', priority: 'critical' }]);
    expect(points[0]).toEqual({ point: 'A', why: 'B', importance: 'must-know' });
  });

  it('drops entries with no point text', () => {
    expect(parseKeyPoints([{ why: 'orphan' }, { point: '' }])).toHaveLength(0);
  });
});

describe('parseLoosePoints', () => {
  it('parses bullet lines with a labelled importance', () => {
    const points = parseLoosePoints([
      '- (must-know) Photosynthesis stores energy | It is the core of the chapter',
      '- should-know: Light-dependent reactions happen first',
    ].join('\n'));
    expect(points).toHaveLength(2);
    expect(points[0].importance).toBe('must-know');
    expect(points[0].point).toBe('Photosynthesis stores energy');
    expect(points[0].why).toBe('It is the core of the chapter');
    expect(points[1].importance).toBe('should-know');
    expect(points[1].point).toBe('Light-dependent reactions happen first');
  });
});

describe('extractKeyPointsBlock', () => {
  it('pulls the block out and returns the remaining text', () => {
    const raw = [
      '## Photosynthesis',
      'Plants convert light into chemical energy.',
      KEY_POINTS_OPEN,
      '[{"importance":"must-know","point":"Light becomes glucose","why":"Central to the chapter"}]',
      KEY_POINTS_CLOSE,
    ].join('\n');

    const out = extractKeyPointsBlock(raw);
    expect(out.found).toBe(true);
    expect(out.keyPoints).toHaveLength(1);
    expect(out.keyPoints[0].point).toBe('Light becomes glucose');
    expect(out.keyPoints[0].importance).toBe('must-know');
    // The marker text must never reach the user.
    expect(out.text).not.toContain('KEY_POINTS');
    expect(out.text).toContain('## Photosynthesis');
  });

  it('leaves a reply without the block untouched', () => {
    const out = extractKeyPointsBlock('Just a normal answer.');
    expect(out.found).toBe(false);
    expect(out.keyPoints).toHaveLength(0);
    expect(out.text).toBe('Just a normal answer.');
  });

  it('recovers points from a loosely formatted block', () => {
    const raw = [
      'Some teaching.',
      KEY_POINTS_OPEN,
      '- (must-know) The mitochondrion is the powerhouse — it makes ATP',
      KEY_POINTS_CLOSE,
    ].join('\n');
    const out = extractKeyPointsBlock(raw);
    expect(out.found).toBe(true);
    expect(out.keyPoints).toHaveLength(1);
    expect(out.keyPoints[0].point).toContain('mitochondrion');
  });

  it('reports found=true even when the payload is unparseable', () => {
    const out = extractKeyPointsBlock(`hello ${KEY_POINTS_OPEN} garbage ${KEY_POINTS_CLOSE}`);
    expect(out.found).toBe(true);
    expect(out.keyPoints).toHaveLength(0);
    expect(out.text).toBe('hello');
  });

  it('handles an unterminated block without hanging', () => {
    const out = extractKeyPointsBlock(`text ${KEY_POINTS_OPEN} [{"point":"A"}]`);
    expect(out.found).toBe(true);
    expect(out.keyPoints).toHaveLength(1);
  });

  it('returns empty results for empty input', () => {
    const out = extractKeyPointsBlock('');
    expect(out.text).toBe('');
    expect(out.keyPoints).toHaveLength(0);
  });
});
