/**
 * Generates the PWA icons (PNG) from an inline SVG design using the Playwright Chromium that is
 * available in the development environment. Run with: npm run icons
 * The generated files are committed in public/icons, so this script is not needed for builds.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'public/icons');
mkdirSync(out, { recursive: true });

/** Road vanishing into fog with a hazard light; `safe` shrinks the art for maskable icons. */
function svg(size, safe) {
  const s = safe ? 0.72 : 1;
  const o = (1 - s) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#030405"/>
      <stop offset="0.55" stop-color="#121820"/>
      <stop offset="1" stop-color="#050607"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ffb35c" stop-opacity="0.95"/>
      <stop offset="0.3" stop-color="#ff8a1c" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#ff8a1c" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="road" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1a1f26" stop-opacity="0.2"/>
      <stop offset="1" stop-color="#0b0d10"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#sky)"/>
  <g transform="translate(${o * 512} ${o * 512}) scale(${s})">
    <path d="M150 512 L245 250 L267 250 L362 512 Z" fill="url(#road)"/>
    <path d="M253 270 h6 v26 h-6z M251 318 h10 v40 h-10z M248 384 h16 v62 h-16z M244 470 h24 v42 h-24z" fill="#c99a5b" opacity="0.9"/>
    <path d="M60 250 Q120 170 150 250 Q175 150 210 250 Z M300 250 Q340 160 370 250 Q400 175 452 250 Z" fill="#0a0d10"/>
    <circle cx="352" cy="300" r="58" fill="url(#glow)"/>
    <circle cx="352" cy="300" r="9" fill="#ffd29c"/>
    <text x="256" y="${safe ? 150 : 120}" text-anchor="middle" font-family="Arial Narrow, Arial, sans-serif" font-size="58" font-weight="300" letter-spacing="14" fill="#e6e8eb">LINHA</text>
    <text x="256" y="${safe ? 205 : 178}" text-anchor="middle" font-family="Arial Narrow, Arial, sans-serif" font-size="58" font-weight="300" letter-spacing="14" fill="#e6e8eb">MORTA</text>
  </g>
</svg>`;
}

const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, safe] of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:#000">${svg(size, safe)}</body></html>`);
  const buffer = await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size } });
  writeFileSync(resolve(out, name), buffer);
  console.log('wrote', name);
}
await browser.close();
