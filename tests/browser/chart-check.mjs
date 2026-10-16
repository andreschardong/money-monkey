// The value and price charts start their vertical axis at zero. Signs in as the demo account (or a fresh one with
// the smoke-test portfolio), reads the rendered axis labels of each chart, and saves a screenshot of each.
// Usage: node chart-check.mjs [baseUrl] [mailpitUrl]   (registration open on the target)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { seedPortfolio, signIn } from './session.mjs';

const base = process.argv[2] ?? 'http://localhost:8090';
const mailpit = process.argv[3] ?? 'http://localhost:8025';
mkdirSync('shots', { recursive: true });

const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
const page = await context.newPage();
page.on('pageerror', e => console.log(`[pageerror] ${e.message}`));
await signIn(page, base, mailpit, process.env.CHART_EMAIL ?? 'demo@moneymonkey.example');
const api = context.request;
if ((await (await api.get(`${base}/api/portfolios`)).json()).length === 0) {
  await seedPortfolio(api, base);
}

/** Money labels on the vertical axis of the first chart on the page, as numbers (compact: "$50K" -> 50000). */
async function axisValues(selector) {
  const svg = page.locator(`${selector} svg`).first();
  await svg.waitFor({ timeout: 20000 });
  await page.waitForTimeout(800); // animation
  const labels = await svg.locator('text').allTextContents();
  const scale = { K: 1e3, M: 1e6, B: 1e9 };
  return labels
    .map(t => /^(-?)[^\d\s-]+([\d.,]+)\s*([KMB])?$/.exec(t.trim()))
    .filter(Boolean)
    .map(m => (m[1] ? -1 : 1) * parseFloat(m[2].replace(/,/g, '')) * (scale[m[3]] ?? 1));
}

let failures = 0;
async function check(name, url, selector, shot) {
  await page.goto(`${base}${url}`);
  const values = await axisValues(selector);
  const min = Math.min(...values);
  const ok = values.length >= 2 && min === 0;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: axis labels ${JSON.stringify(values)}`);
  if (!ok) failures++;
  await page.locator(selector).first().screenshot({ path: `shots/${shot}.png` });
}

await check('overview value chart', '/', 'app-value-chart', 'chart-overview');
await page.getByRole('radio', { name: 'All' }).click();
{
  const values = await axisValues('app-value-chart');
  const ok = values.length >= 2 && Math.min(...values) === 0;
  console.log(`${ok ? 'ok  ' : 'FAIL'} overview value chart, All range: axis labels ${JSON.stringify(values)}`);
  if (!ok) failures++;
}

const portfolios = await (await api.get(`${base}/api/portfolios`)).json();
const detail = await (await api.get(`${base}/api/portfolios/${portfolios[0].id}`)).json();
await check('portfolio value chart', `/portfolios/${portfolios[0].id}`, 'app-value-chart', 'chart-portfolio');
const holding = detail.holdings.find(h => h.securityId) ?? detail.holdings[0];
await check('holding price chart', `/portfolios/${portfolios[0].id}/holdings/${holding.securityId}`, 'app-price-chart', 'chart-holding');
await check('quotes price chart', '/quotes?symbol=SHOP.TO', 'app-price-chart', 'chart-quotes');

await browser.close();
if (failures) {
  console.log(`${failures} chart(s) do not start at zero`);
  process.exit(1);
}
console.log('every chart starts at zero');
