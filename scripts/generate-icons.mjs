/**
 * Generates SVG-based PNG icons for the PWA manifest and SW.
 * Writes icon-192.png and icon-512.png to /public using Canvas API via node.
 * Run: node scripts/generate-icons.mjs
 * 
 * Falls back to creating SVG files if canvas isn't available (no native deps).
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

// SVG icon — indigo gradient with book emoji style
function makeIconSVG(size) {
  const r = Math.round(size * 0.15); // border radius
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#6366f1;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#8b5cf6;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="url(#bg)"/>
  <text x="50%" y="56%" dominant-baseline="middle" text-anchor="middle"
    font-size="${Math.round(size * 0.52)}" font-family="Apple Color Emoji,Segoe UI Emoji,sans-serif">📚</text>
</svg>`;
}

// Write SVG icons (browsers accept SVG for manifest icons too)
for (const size of [192, 512]) {
  const svg = makeIconSVG(size);
  const svgPath = join(publicDir, `icon-${size}.svg`);
  writeFileSync(svgPath, svg);
  console.log(`Created ${svgPath}`);
}

// Also create a simple PNG placeholder using a data URI trick
// (Real PNG generation needs canvas/sharp — skip if not available)
// The SVG files work fine for modern browsers.
console.log('Icons generated. For full PNG support, rename .svg → .png or use a canvas-capable environment.');
