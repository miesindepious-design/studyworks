/**
 * aiText.tsx — make AI output readable.
 *
 * The tutor (and the notes Q&A) gets its answers from a language model, and
 * models answer in markdown + LaTeX by default. We used to dump that text
 * into a `white-space: pre-wrap` div, so every reply arrived full of raw
 * symbols: `##`, `**`, `|---|`, `$x^2$`, `\frac{a}{b}`, `\alpha`.
 *
 * This module is the single place that turns that machine output into
 * something a student can actually read:
 *
 *   normalizeMath()  — LaTeX / math → plain unicode text
 *   toPlainText()    — markdown → plain prose (used for speech + note saves)
 *   renderAiText()   — markdown → React elements (headings, lists, tables…)
 *
 * Everything is built as React elements — never `dangerouslySetInnerHTML` —
 * so model output can never inject markup into the page.
 */

import { Fragment, createElement, type ReactNode } from 'react';

/* ── Diagrams ─────────────────────────────────────────────────────────────── */

/**
 * Tags the tutor's SVG diagrams may use. Anything else — <script>,
 * <foreignObject>, <image>, <a>… — is dropped wholesale, so a
 * model can never smuggle markup into the page.
 */
const SVG_TAGS = new Set([
  'svg', 'g', 'defs', 'marker', 'clipPath', 'mask', 'use',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'title', 'desc',
  'linearGradient', 'radialGradient', 'stop', 'pattern',
  // Filter primitives — a soft drop shadow is common in a good diagram.
  'filter', 'feGaussianBlur', 'feDropShadow', 'feOffset', 'feBlend',
  'feColorMatrix', 'feMerge', 'feMergeNode', 'feFlood', 'feComposite',
  'feTurbulence', 'feDisplacementMap', 'feMorphology', 'feConvolveMatrix',
  'feTile', 'feComponentTransfer', 'feFuncR', 'feFuncG', 'feFuncB', 'feFuncA',
  'feDiffuseLighting', 'feSpecularLighting', 'fePointLight', 'feSpotLight',
  'feDistantLight',
]);

/**
 * Attributes those tags may carry, as JSX names (camelCase). Hyphenated
 * SVG names are converted; anything outside this list is stripped.
 *
 * `id` matters: markers, gradients and clip paths are all referenced by
 * `url(#name)`. Without it the diagram still draws, but every arrow loses
 * its head and every gradient fill collapses to flat black.
 */
const SVG_ATTRS = new Set([
  'viewBox', 'xmlns', 'width', 'height', 'preserveAspectRatio', 'fill', 'stroke',
  'strokeWidth', 'strokeLinecap', 'strokeLinejoin', 'strokeDasharray',
  'fillOpacity', 'strokeOpacity', 'opacity', 'd', 'x', 'y', 'x1', 'x2', 'y1', 'y2',
  'cx', 'cy', 'r', 'rx', 'ry', 'points', 'transform', 'dx', 'dy', 'textAnchor',
  'dominantBaseline', 'alignmentBaseline', 'baselineShift', 'fontFamily',
  'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'writingMode',
  'textDecoration', 'textLength', 'lengthAdjust', 'letterSpacing', 'wordSpacing',
  'fillRule', 'clipRule', 'gradientUnits', 'gradientTransform', 'spreadMethod',
  'offset', 'stopColor', 'stopOpacity', 'patternUnits', 'patternContentUnits',
  'patternTransform', 'markerWidth', 'markerHeight', 'refX', 'refY', 'orient',
  'markerUnits', 'markerEnd', 'markerStart', 'markerMid', 'clipPath', 'clipPathUnits',
  'mask', 'maskUnits', 'maskContentUnits', 'filter', 'filterUnits', 'primitiveUnits',
  'overflow', 'color', 'paintOrder', 'shapeRendering', 'imageRendering',
  'strokeMiterlimit', 'vectorEffect', 'display', 'rotate', 'startOffset',
  'side', 'spacing', 'textOverflow', 'whiteSpace', 'transformOrigin',
  // Filter primitive attributes.
  'stdDeviation', 'floodColor', 'floodOpacity', 'lightingColor', 'result', 'in2',
  'values', 'type', 'operator', 'k1', 'k2', 'k3', 'k4', 'scale', 'radius',
  'baseFrequency', 'numOctaves', 'seed', 'stitchTiles', 'tableValues',
  'slope', 'intercept', 'amplitude', 'exponent', 'azimuth', 'elevation',
  'surfaceScale', 'diffuseConstant', 'specularConstant', 'specularExponent',
  'pointsAtX', 'pointsAtY', 'limitingConeAngle',
]);

/** Hyphenated SVG attribute → JSX name ('stroke-width' → 'strokeWidth'). */
function toJsxAttr(name: string): string | null {
  if (name === 'class') return 'className';
  if (name === 'style') return null;             // inline styles are not worth the risk
  if (name.startsWith('on')) return null;        // event handlers, always
  if (name.includes('href')) return null;        // external / xlink references
  const camel = name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  return SVG_ATTRS.has(camel) ? camel : null;
}

/**
 * Close any element the model left open.
 *
 * A reply that was cut off mid-diagram (the token budget ran out) leaves
 * tags unclosed, which makes the whole SVG unparseable — the student then
 * sees raw markup instead of a picture. Closing the open tags gives back
 * a diagram that is missing only its tail.
 */
function closeOpenTags(svg: string): string {
  const stack: string[] = [];
  const tag = /<\/?([A-Za-z][\w:-]*)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(svg)) !== null) {
    const raw = m[0];
    const name = m[1];
    if (raw.startsWith('</')) {
      const idx = stack.lastIndexOf(name);
      if (idx !== -1) stack.length = idx;
      continue;
    }
    if (raw.endsWith('/>')) continue;             // self-closing
    stack.push(name);
  }
  if (stack.length === 0) return svg;
  return svg + stack.reverse().map(n => `</${n}>`).join('');
}

/**
 * Pull the <svg> element out of whatever the model wrapped it in.
 *
 * Replies often carry an XML prolog, a comment or a sentence of prose
 * around the diagram — any of which makes DOMParser reject the whole
 * block and leave the student with a code dump.
 */
function extractSvgSource(text: string): string | null {
  const start = text.search(/<svg[\s>]/i);
  if (start === -1) return null;
  const rest = text.slice(start);
  const closeIdx = rest.search(/<\/svg\s*>/i);
  const svg = closeIdx === -1 ? rest : rest.slice(0, closeIdx + 6);
  return closeOpenTags(svg);
}

/**
 * Parse a model-produced SVG string and rebuild it as a React element tree,
 * keeping only whitelisted tags and attributes. Unsafe nodes (and their
 * children) disappear entirely.
 */
export function svgToReact(svgText: string): ReactNode | null {
  const source = extractSvgSource(svgText);
  if (!source) return null;

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  } catch {
    return null;
  }
  const root = doc.documentElement;
  // XML parse errors surface as a <parsererror> element (Chrome/Firefox).
  if (!root || root.getElementsByTagName('parsererror').length > 0
      || (root.tagName.toLowerCase() === 'parsererror')) {
    return null;
  }

  // Ids are namespaced per render, so a diagram can never collide with the
  // page around it (or with another diagram on the same page).
  const idMap = new Map<string, string>();
  let uid = 0;
  const mapId = (id: string): string => {
    let mapped = idMap.get(id);
    if (!mapped) {
      mapped = `sw-svg-${uid++}`;
      idMap.set(id, mapped);
    }
    return mapped;
  };
  /** Rewrite `url(#name)` so it points at the namespaced id. */
  const mapRefs = (value: string): string =>
    value.replace(/url\(\s*#([^)\s]+)\s*\)/g, (_m, name: string) => `url(#${mapId(name)})`);

  const build = (node: Element, depth: number, key: string): ReactNode | null => {
    const tag = node.tagName;
    if (!SVG_TAGS.has(tag) || depth > 12) return null;

    const props: Record<string, unknown> = { key };
    for (const attr of Array.from(node.attributes)) {
      if (attr.name === 'id') {
        props.id = mapId(attr.value);
        continue;
      }
      if (attr.name === 'href') {
        // A <use> may only point at a fragment inside this same diagram.
        if (tag === 'use' && /^#[A-Za-z][\w:.-]*$/.test(attr.value)) {
          props.href = `#${mapId(attr.value.slice(1))}`;
        }
        continue;
      }
      const jsx = toJsxAttr(attr.name);
      if (!jsx) continue;
      props[jsx] = mapRefs(attr.value);
    }

    const children: ReactNode[] = [];
    let ci = 0;
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const t = child.textContent ?? '';
        if (t.trim()) children.push(t);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = build(child as Element, depth + 1, `${key}-${ci++}`);
        if (el !== null) children.push(el);
      }
    }

    return createElement(tag, props, children.length > 0 ? children : undefined);
  };

  return build(root, 0, 'svg');
}

/* ── LaTeX → unicode ──────────────────────────────────────────────────────── */

const LATEX_SYMBOLS: Record<string, string> = {
  // Greek
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ',
  eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ',
  nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', rho: 'ρ', sigma: 'σ',
  tau: 'τ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  // Operators
  times: '×', div: '÷', pm: '±', mp: '∓', cdot: '·', ast: '*', star: '★',
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈',
  equiv: '≡', sim: '∼', propto: '∝', ll: '≪', gg: '≫',
  infty: '∞', partial: '∂', nabla: '∇', forall: '∀', exists: '∃',
  neg: '¬', land: '∧', lor: '∨', wedge: '∧', vee: '∨',
  sum: '∑', prod: '∏', int: '∫', iint: '∬', oint: '∮',
  sqrt: '√', angle: '∠', perp: '⊥', parallel: '∥',
  in: '∈', notin: '∉', subset: '⊂', supset: '⊃', subseteq: '⊆',
  cup: '∪', cap: '∩', emptyset: '∅', varnothing: '∅',
  rightarrow: '→', to: '→', leftarrow: '←', gets: '←',
  leftrightarrow: '↔', Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔',
  mapsto: '↦', therefore: '∴', because: '∵', circ: '°',
  degree: '°', prime: '′', ldots: '…', dots: '…', cdots: '⋯',
  vdots: '⋮', ddots: '⋱', hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ',
  // Spacing / sizing
  quad: ' ', qquad: '  ', ',': ' ', ';': ' ', ':': ' ', '!': '',
  left: '', right: '', big: '', Big: '', bigl: '', bigr: '', bigg: '', Bigg: '',
  ' ': ' ',
};

/** Commands whose braces wrap ordinary prose — the wrapper is dropped. */
const WRAPPER_CMDS = new Set([
  'text', 'textrm', 'mathrm', 'mathbf', 'mathit', 'mathcal', 'mathbb',
  'mathsf', 'mathtt', 'mbox', 'operatorname', 'underline', 'textbf',
  'textit', 'emph', 'url', 'href', 'label', 'ref', 'cite',
]);

const SUPERSCRIPTS: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
  n: 'ⁿ', i: 'ⁱ', a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ',
  k: 'ᵏ', m: 'ᵐ', p: 'ᵖ', s: 'ˢ', t: 'ᵗ', x: 'ˣ',
};

const SUBSCRIPTS: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
  a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ',
  m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ',
  u: 'ᵤ', v: 'ᵥ', x: 'ₓ',
};

/** Read a `{...}` group starting at `start` (which must point at the brace). */
function readGroup(src: string, start: number): { content: string; end: number } {
  if (src[start] !== '{') {
    // LaTeX allows a single token as an argument: \frac12 → 1/2
    const m = /^\s*(\\[a-zA-Z]+|.)/.exec(src.slice(start));
    if (!m) return { content: '', end: start };
    return { content: m[1], end: start + m[0].length };
  }
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return { content: src.slice(start + 1, i), end: i + 1 };
    }
  }
  return { content: src.slice(start + 1), end: src.length };
}

/** Convert every LaTeX command in `src` into readable unicode. */
function latexToText(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch !== '\\') { out += ch; i++; continue; }

    const m = /^\\([a-zA-Z]+|.)/.exec(src.slice(i));
    if (!m) { i++; continue; }
    const cmd = m[1];
    i += m[0].length;

    if (cmd === '\\') { out += '\n'; continue; }

    if (cmd === 'frac' || cmd === 'dfrac' || cmd === 'tfrac' || cmd === 'cfrac') {
      const a = readGroup(src, i); i = a.end;
      const b = readGroup(src, i); i = b.end;
      out += `(${a.content.trim()})/(${b.content.trim()})`;
      continue;
    }

    if (cmd === 'sqrt') {
      if (src[i] === '[') {
        const close = src.indexOf(']', i);
        if (close > -1) i = close + 1;
      }
      const a = readGroup(src, i); i = a.end;
      out += `√(${a.content.trim()})`;
      continue;
    }

    if (WRAPPER_CMDS.has(cmd)) {
      const a = readGroup(src, i); i = a.end;
      out += a.content;
      continue;
    }

    if (cmd === 'begin' || cmd === 'end') {
      const a = readGroup(src, i); i = a.end;
      out += ' ';
      continue;
    }

    if (cmd in LATEX_SYMBOLS) { out += LATEX_SYMBOLS[cmd]; continue; }

    // Unknown command (\sin, \log, \lim …) — keep the word, drop the slash.
    out += cmd;
  }
  return out;
}

/** `x^2` / `x^{12}` → `x²` / `x¹²`. Only applied to a single-char base. */
function superscript(base: string, exp: string): string {
  const chars = [...exp];
  if (chars.every(c => c in SUPERSCRIPTS)) {
    return base + chars.map(c => SUPERSCRIPTS[c]).join('');
  }
  return `${base}^(${exp})`;
}

/** `H_2O` → `H₂O`; `a_{i}` → `aᵢ`. */
function subscript(base: string, sub: string): string {
  const chars = [...sub];
  if (chars.every(c => c in SUBSCRIPTS)) {
    return base + chars.map(c => SUBSCRIPTS[c]).join('');
  }
  return `${base}_(${sub})`;
}

const MATHY = /[\\^_{}]/;

/**
 * Does this `$…$` span look like maths, or like a currency amount?
 * "$5 and $10" is money; "$E = mc^2$" is maths.
 */
function looksLikeMath(inner: string): boolean {
  const t = inner.trim();
  if (!t) return false;
  if (MATHY.test(t)) return true;
  // A bare symbol or a short equation with no space: $x$, $2x$, $a+b$
  if (t.length <= 12 && !/\s/.test(t) && /[A-Za-z0-9]/.test(t)) return true;
  return false;
}

/**
 * Turn LaTeX / raw math into plain readable text.
 * Safe to run on any string; returns the input unchanged if there is no math.
 */
export function normalizeMath(input: string): string {
  if (!input) return '';
  let text = input;

  // Protect code — never rewrite maths inside a code block.
  const code: string[] = [];
  text = text.replace(/```[\s\S]*?```|`[^`\n]*`/g, (m) => {
    code.push(m);
    return `\u0000C${code.length - 1}\u0000`;
  });

  // Display maths → its own paragraph.
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, inner: string) => `\n\n${inner}\n\n`);
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, inner: string) => `\n\n${inner}\n\n`);
  // Inline maths delimiters.
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, '$1');
  text = text.replace(/\$([^$\n]{1,160}?)\$/g, (match, inner: string) =>
    looksLikeMath(inner) ? inner : match,
  );

  // Alignment markers inside align/matrix environments.
  if (/\\begin\{(align|matrix|array|cases|pmatrix|bmatrix)/.test(text)) {
    text = text.replace(/&/g, ' ');
  }

  // LaTeX commands → unicode.
  text = latexToText(text);

  // Escaped punctuation.
  text = text
    .replace(/\\%/g, '%')
    .replace(/\\\$/g, '$')
    .replace(/\\&/g, '&')
    .replace(/\\_/g, '_')
    .replace(/\\#/g, '#')
    .replace(/\\\{/g, '{')
    .replace(/\\\}/g, '}')
    .replace(/\\\\/g, '\n');

  // Braced exponents / subscripts.
  text = text.replace(/([A-Za-z0-9)\]])(\^|_)\{([^{}]*)\}/g, (_m, base, kind, body) =>
    kind === '^' ? superscript(base, body) : subscript(base, body),
  );
  // Single-char exponents: x^2 — only after a single alphanumeric base.
  text = text.replace(/([A-Za-z0-9])\^(\d{1,2})(?![A-Za-z0-9])/g, (_m, base, exp) =>
    superscript(base, exp),
  );
  // Numeric subscripts: H_2O → H₂O, CO_2 → CO₂ — digits only, and never
  // inside an identifier like `user_2`.
  text = text.replace(/([A-Za-z0-9])_(\d{1,2})/g, (match, base: string, sub: string, offset: number) => {
    const before = offset > 0 ? text[offset - 1] : '';
    if (/[a-z]/.test(base) && /[a-z]/.test(before)) return match;
    return subscript(base, sub);
  });

  // Any leftover backslash is noise.
  text = text.replace(/\\(?=[^\s])/g, '');

  // Restore code.
  text = text.replace(/\u0000C(\d+)\u0000/g, (_m, i: string) => code[Number(i)] ?? '');

  return text;
}

/* ── Markdown → plain prose ───────────────────────────────────────────────── */

/**
 * Markdown (and maths) → plain sentences. Used for text-to-speech and for
 * the note export, where formatting characters would be noise.
 */
export function toPlainText(input: string): string {
  if (!input) return '';
  let text = normalizeMath(input);

  text = text
    .replace(/```[\s\S]*?```/g, ' ')            // code blocks
    .replace(/`([^`]*)`/g, '$1')                 // inline code
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')         // headings
    .replace(/^\s{0,3}>\s?/gm, '')              // quotes
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s*/gm, '')  // task boxes
    .replace(/^\s*[-*+]\s+/gm, '')              // bullets
    .replace(/^\s*\d+[.)]\s+/gm, '')            // numbered lists
    .replace(/^\s*\|?[\s:-]*-{2,}[\s:|-]*\|?\s*$/gm, ' ') // table rules
    .replace(/^\s*[-*_]{3,}\s*$/gm, ' ')        // rules
    .replace(/\|/g, ' ')                        // table pipes
    .replace(/\*\*([^*]+)\*\*/g, '$1')          // bold
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')            // italic
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, '$1$2') // _italic_
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')    // links
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Symbols the voice would read out badly.
  text = text
    .replace(/×/g, ' times ')
    .replace(/÷/g, ' divided by ')
    .replace(/±/g, ' plus or minus ')
    .replace(/∓/g, ' minus or plus ')
    .replace(/≠/g, ' not equal to ')
    .replace(/≤/g, ' less than or equal to ')
    .replace(/≥/g, ' greater than or equal to ')
    .replace(/≈/g, ' approximately ')
    .replace(/≡/g, ' is identical to ')
    .replace(/∞/g, ' infinity ')
    .replace(/√/g, ' the square root of ')
    .replace(/∑/g, ' the sum of ')
    .replace(/∫/g, ' the integral of ')
    .replace(/→/g, ' then ')
    .replace(/⇒/g, ' therefore ')
    .replace(/↔/g, ' is linked to ')
    .replace(/°/g, ' degrees ')
    .replace(/²/g, ' squared ')
    .replace(/³/g, ' cubed ')
    .replace(/[₀-₉]/g, c => String('₀₁₂₃₄₅₆₇₈₉'.indexOf(c)))
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, c => String('⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(c)))
    // Collapse horizontal runs only — paragraph breaks are kept so the
    // speech chunker can pause at the right places.
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

/* ── Markdown → React elements ────────────────────────────────────────────── */

const INLINE_RE =
  /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|`[^`\n]+`|\*[^*\n]+\*|\[[^\]\n]+\]\([^)\s]+\)|_[^_\n]+_)/g;

function renderInline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;

  INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    const id = `${key}-i${n++}`;

    if (token.startsWith('**') || token.startsWith('__')) {
      out.push(<strong key={id}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      out.push(<code key={id}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('*')) {
      out.push(<em key={id}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      const label = link?.[1] ?? token;
      const href = link?.[2] ?? '';
      const safe = /^https?:\/\//i.test(href);
      out.push(
        safe
          ? <a key={id} href={href} target="_blank" rel="noopener noreferrer">{label}</a>
          : <span key={id}>{label}</span>,
      );
    } else if (token.startsWith('_')) {
      // `_italic_` only when it isn't part of an identifier like `snake_case`.
      const before = m.index > 0 ? text[m.index - 1] : ' ';
      const after = text[m.index + token.length] ?? ' ';
      if (/[\w]/.test(before) || /[\w]/.test(after)) {
        out.push(token);
      } else {
        out.push(<em key={id}>{token.slice(1, -1)}</em>);
      }
    }

    last = m.index + token.length;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

function splitTableRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map(c => c.trim());
}

const isTableSeparator = (line: string) =>
  /^\s*\|?[\s:-]*-{2,}[\s:|-]*\|?\s*$/.test(line) && line.includes('-');

/**
 * Render AI output as structured React elements.
 *
 * Headings, bold, lists, tables, code and quotes all become real elements —
 * so the reply reads like study notes instead of a wall of raw markdown.
 */
export function renderAiText(input: string): ReactNode {
  const text = normalizeMath(input || '');
  if (!text.trim()) return null;

  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let key = 0;
  let i = 0;

  const para: string[] = [];
  const flushPara = () => {
    if (!para.length) return;
    const body = para.join(' ').trim();
    para.length = 0;
    if (body) blocks.push(<p key={`p${key++}`}>{renderInline(body, `p${key}`)}</p>);
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Fenced code
    if (/^```/.test(trimmed)) {
      flushPara();
      const lang = trimmed.slice(3).trim().toLowerCase();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) body.push(lines[i++]);
      // Step over the closing fence. When the reply was cut short there is
      // none, and the loop simply ends — the body still renders.
      if (i < lines.length) i++;

      const source = body.join('\n');

      // A plain-text line diagram — the cheap tier. Box-drawing characters
      // keep their spacing, so it needs a monospace block of its own.
      if (lang === 'diagram' || lang === 'ascii') {
        blocks.push(
          <figure key={`ld${key++}`} className="sw-ai-diagram-text">
            <pre><code>{source}</code></pre>
          </figure>,
        );
        continue;
      }

      // An SVG diagram from the tutor — sanitize and render it inline as a
      // figure instead of showing the raw source as a code block. The fence
      // is tagged ```svg, but the model sometimes writes ```svg diagram or
      // forgets the tag entirely, so fall back to sniffing the body.
      const looksLikeSvg =
        lang === 'svg' || lang.startsWith('svg ') || /<svg[\s>]/i.test(source);
      if (looksLikeSvg) {
        const svgNode = svgToReact(source);
        if (svgNode !== null) {
          blocks.push(
            <figure key={`d${key++}`} className="sw-ai-diagram">
              {svgNode}
            </figure>,
          );
          continue;
        }
      }

      blocks.push(
        <pre key={`c${key++}`} data-lang={lang || undefined}>
          <code>{source}</code>
        </pre>,
      );
      continue;
    }

    // Horizontal rule
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushPara();
      blocks.push(<hr key={`h${key++}`} />);
      i++;
      continue;
    }

    // Heading
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushPara();
      const level = heading[1].length;
      const content = heading[2].trim();
      const Tag = (level <= 2 ? 'h3' : level === 3 ? 'h4' : 'h5') as 'h3' | 'h4' | 'h5';
      blocks.push(<Tag key={`hd${key++}`}>{renderInline(content, `hd${key}`)}</Tag>);
      i++;
      continue;
    }

    // Table — header + separator + body
    if (trimmed.startsWith('|') && isTableSeparator(lines[i + 1] ?? '')) {
      flushPara();
      const head = splitTableRow(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitTableRow(lines[i].trim()));
        i++;
      }
      blocks.push(
        <div key={`t${key++}`} className="sw-ai-table-wrap">
          <table className="sw-ai-table">
            <thead>
              <tr>{head.map((h, ci) => <th key={ci}>{renderInline(h, `th${ci}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => <td key={ci}>{renderInline(c, `td${ri}-${ci}`)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Bullet list
    if (/^\s*[-*+]\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={`ul${key++}`}>
          {items.map((it, ii) => (
            <li key={ii}>
              {/^\[[ xX]\]\s*/.test(it)
                ? (() => {
                    const done = /^\[[xX]\]\s*/.test(it);
                    return (
                      <>
                        <span className="sw-ai-check">{done ? '☑' : '☐'}</span>
                        {renderInline(it.replace(/^\[[ xX]\]\s*/, ''), `li${ii}`)}
                      </>
                    );
                  })()
                : renderInline(it, `li${ii}`)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // Numbered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
        i++;
      }
      blocks.push(
        <ol key={`ol${key++}`}>
          {items.map((it, ii) => <li key={ii}>{renderInline(it, `ol${ii}`)}</li>)}
        </ol>,
      );
      continue;
    }

    // Quote
    if (/^\s*>\s?/.test(line)) {
      flushPara();
      const body: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push(
        <blockquote key={`bq${key++}`}>{renderInline(body.join(' '), `bq${key}`)}</blockquote>,
      );
      continue;
    }

    // Blank line ends the paragraph.
    if (!trimmed) {
      flushPara();
      i++;
      continue;
    }

    para.push(trimmed);
    i++;
  }

  flushPara();

  return <div className="sw-ai-text">{blocks.map((b, bi) => <Fragment key={bi}>{b}</Fragment>)}</div>;
}
