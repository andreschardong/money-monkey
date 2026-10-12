// Renders the Android launcher icon's foreground layer (an adaptive icon: the background is a plain colour in
// res/values/themes.xml) from web/public/favicon.svg, at every screen density. Usage: node make-android-icons.mjs
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';

const favicon = readFileSync('../../web/public/favicon.svg', 'utf8');
// Drop the rounded dark square (Android supplies the background and the mask) and centre the monkey inside the
// 66 dp safe zone of the 108 dp canvas.
const inner = favicon.replace(/<svg[^>]*>/, '').replace('</svg>', '').replace(/<rect[^>]*\/>/, '');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108"><g transform="translate(22 22)">${inner}</g></svg>`;

const densities = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage();
for (const [density, size] of Object.entries(densities)) {
  const dir = `../../android/app/src/main/res/mipmap-${density}`;
  mkdirSync(dir, { recursive: true });
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
  await page.screenshot({ path: `${dir}/ic_launcher_foreground.png`, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log(`mipmap-${density}/ic_launcher_foreground.png (${size}px)`);
}
// A preview on the background colour with a circular mask, to check the safe zone by eye.
await page.setViewportSize({ width: 216, height: 216 });
await page.setContent(`<body style="margin:0"><div style="width:216px;height:216px;border-radius:50%;overflow:hidden;background:#172430">${svg.replace('<svg ', '<svg width="216" height="216" ')}</div></body>`);
await page.screenshot({ path: 'shots/android-icon-preview.png', omitBackground: true });
await browser.close();
