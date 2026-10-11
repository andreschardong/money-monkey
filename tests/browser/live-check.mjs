// Anonymous check of a deployed site: stylesheet really applies, headers present, phone and desktop shots of the sign-in page.
// Usage: node live-check.mjs https://moneymonkey.example.com [outDir]
import { chromium } from 'playwright';
const base = process.argv[2] ?? 'https://moneymonkey.example.com';
const out = process.argv[3] ?? 'shots';
const browser = await chromium.launch({ channel: 'msedge' });
for (const [name, viewport, mobile] of [['phone', { width: 390, height: 844 }, true], ['desktop', { width: 1280, height: 800 }, false]]) {
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
  const page = await context.newPage();
  const response = await page.goto(`${base}/sign-in`);
  await page.getByRole('heading', { name: 'Sign in' }).waitFor();
  await page.waitForTimeout(800);
  const info = await page.evaluate(() => ({
    sheetMedia: [...document.styleSheets].filter(s => s.href).map(s => `${s.href.split('/').pop()} media=${s.media.mediaText || 'all'}`),
    font: getComputedStyle(document.body).fontFamily.split(',')[0],
    title: document.title,
  }));
  const h = response.headers();
  console.log(`${name}: ${JSON.stringify(info)} csp=${h['content-security-policy'] ? 'yes' : 'NO'} hsts=${h['strict-transport-security'] ?? 'NO'}`);
  await page.screenshot({ path: `${out}/live-${name}.png` });
  await context.close();
}
await browser.close();
