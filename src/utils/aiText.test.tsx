/**
 * AI output formatting.
 *
 * The tutor used to dump raw model output into a `pre-wrap` div, so replies
 * arrived full of LaTeX and markdown symbols ($x^2$, \frac{a}{b}, ##, **, |---|)
 * and were hard to read. These tests lock in the cleanup: maths becomes
 * unicode, markdown becomes structure, and speech never reads a symbol.
 */

import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';

import { normalizeMath, toPlainText, renderAiText } from './aiText';

const html = (md: string) => renderToString(createElement('div', null, renderAiText(md)));

describe('normalizeMath', () => {
  it('strips inline math delimiters', () => {
    expect(normalizeMath('The value is $x$ here')).toBe('The value is x here');
  });

  it('keeps currency amounts readable', () => {
    expect(normalizeMath('It costs $15 and $20 in total')).toContain('$15');
  });

  it('turns a fraction into readable form', () => {
    expect(normalizeMath('\\frac{a}{b}')).toBe('(a)/(b)');
  });

  it('turns a square root into a readable symbol', () => {
    expect(normalizeMath('\\sqrt{x + 1}')).toBe('√(x + 1)');
  });

  it('converts greek letters', () => {
    expect(normalizeMath('\\alpha and \\beta')).toBe('α and β');
  });

  it('converts operators', () => {
    expect(normalizeMath('a \\times b \\leq c')).toBe('a × b ≤ c');
  });

  it('converts superscripts and subscripts', () => {
    expect(normalizeMath('E = mc^2')).toBe('E = mc²');
    expect(normalizeMath('H_2O')).toBe('H₂O');
  });

  it('drops display-math delimiters', () => {
    expect(normalizeMath('\\[ x = 1 \\]')).toContain('x = 1');
    expect(normalizeMath('$$x = 1$$')).toContain('x = 1');
  });

  it('never rewrites maths inside code', () => {
    expect(normalizeMath('`$x$`')).toBe('`$x$`');
    expect(normalizeMath('```\n$y$\n```')).toContain('$y$');
  });

  it('keeps function names readable', () => {
    expect(normalizeMath('\\sin(x)')).toBe('sin(x)');
  });
});

describe('toPlainText', () => {
  it('removes markdown markers', () => {
    const out = toPlainText('## Heading\n\n**bold** and *italic* and `code`');
    expect(out).toBe('Heading bold and italic and code');
  });

  it('removes bullet and numbered markers', () => {
    const out = toPlainText('- one\n- two\n1. three');
    expect(out).not.toMatch(/^[-*\d]/m);
    expect(out).toContain('one');
    expect(out).toContain('three');
  });

  it('spells out symbols so speech sounds natural', () => {
    expect(toPlainText('2 × 3 = 6')).toContain('times');
    expect(toPlainText('a ≤ b')).toContain('less than or equal to');
  });

  it('leaves no raw dollar signs from maths', () => {
    expect(toPlainText('the value is $x$')).not.toContain('$');
  });
});

describe('renderAiText', () => {
  it('renders headings as real headings', () => {
    const out = html('## Photosynthesis');
    expect(out).toContain('<h3');
    expect(out).toContain('Photosynthesis');
    expect(out).not.toContain('##');
  });

  it('renders bold as strong', () => {
    const out = html('The **key idea** matters');
    expect(out).toContain('<strong>key idea</strong>');
  });

  it('renders bullet lists', () => {
    const out = html('- first point\n- second point');
    expect(out).toContain('<ul');
    expect(out).toContain('<li>first point</li>');
  });

  it('renders numbered lists', () => {
    const out = html('1. step one\n2. step two');
    expect(out).toContain('<ol');
    expect(out).toContain('<li>step one</li>');
  });

  it('renders markdown tables', () => {
    const out = html('| Term | Meaning |\n| --- | --- |\n| ATP | energy |');
    expect(out).toContain('<table');
    expect(out).toContain('<th');
    expect(out).toContain('ATP');
  });

  it('renders code blocks', () => {
    const out = html('```js\nconst a = 1;\n```');
    expect(out).toContain('<pre');
    expect(out).toContain('const a = 1;');
  });

  it('renders blockquotes', () => {
    const out = html('> remember this');
    expect(out).toContain('<blockquote');
  });

  it('never emits raw latex into the page', () => {
    const out = html('Energy is $\\frac{mc^2}{2}$ in the equation.');
    expect(out).not.toContain('\\frac');
    expect(out).not.toContain('$');
    expect(out).toContain('(mc²)/(2)');
  });

  it('never injects html from the model', () => {
    const out = html('<img src=x onerror="alert(1)">');
    expect(out).toContain('&lt;img');
    expect(out).not.toContain('<img');
  });

  it('returns nothing for empty input', () => {
    expect(renderAiText('')).toBeNull();
    expect(renderAiText('   ')).toBeNull();
  });
});
