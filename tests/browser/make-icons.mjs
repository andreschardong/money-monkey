// Renders the monkey icon (web/public/favicon.svg) into the PNG sizes the web app manifest and iOS need.
// Usage: node make-icons.mjs
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
const svg = readFileSync('../../web/public/favicon.svg', 'utf8');
// The maskable variant fills the whole square (no rounded corners) and keeps the face inside the safe zone.
const maskable = svg.replace('rx="14"', 'rx="0"').replace('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#172430"/><g transform="translate(8 8) scale(0.75)">').replace('</svg>', '</g></svg>');
mkdirSync('../../web/public/icons', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
async function render(markup, size, file) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;background:transparent">${markup.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
  await page.screenshot({ path: `../../web/public/icons/${file}`, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log(`icons/${file}`);
}
for (const size of [72, 96, 128, 144, 152, 192, 384, 512]) await render(svg, size, `icon-${size}x${size}.png`);
for (const size of [192, 512]) await render(maskable, size, `icon-maskable-${size}x${size}.png`);
await render(svg, 180, 'apple-touch-icon.png');
await browser.close();
