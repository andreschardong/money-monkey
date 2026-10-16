// The charts fit their vertical axis to the data instead of starting at zero, and the value chart leaves out the
// net-deposits line while a portfolio has no deposit recorded (a flat zero line would pin the axis to zero).
// Signs in as the demo account (deposits recorded) and as a fresh account with a buy-only portfolio, reads the
// rendered axis labels, and saves a screenshot of each chart.
// Usage: node chart-check.mjs [baseUrl] [mailpitUrl]   (registration open on the target; prices need the internet)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { seedPortfolio, signIn } from './session.mjs';

const base = process.argv[2] ?? 'http://localhost:8090';
const mailpit = process.argv[3] ?? 'http://localhost:8025';
mkdirSync('shots', { recursive: true });

const browser = await chromium.launch({ channel: 'msedge' });
let failures = 0;
const report = (ok, text) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`); if (!ok) failures++; };

const MONEY = /^(-?)[^\d\s-]+([\d.,]+)\s*([KMB])?$/;

/** Money labels on the vertical axis of the first chart matching the selector, as printed ("$50K", "$1.16M"). */
async function axisLabels(page, selector) {
  const svg = page.locator(`${selector} svg`).first();
  await svg.waitFor({ timeout: 20000 });
  await page.waitForTimeout(800); // animation
  return (await svg.locator('text').allTextContents()).map(t => t.trim()).filter(t => MONEY.test(t));
}

/** The same labels as numbers ("$50K" -> 50000). */
const toValues = labels => labels.map(t => MONEY.exec(t)).map(m =>
  (m[1] ? -1 : 1) * parseFloat(m[2].replace(/,/g, '')) * ({ K: 1e3, M: 1e6, B: 1e9 }[m[3]] ?? 1));
async function axisValues(page, selector) { return toValues(await axisLabels(page, selector)); }

/** Every tick prints differently: the label precision follows the tick spacing ("$1.16M", not "$1.2M" thrice). */
async function expectDistinct(page, name, selector) {
  const labels = await axisLabels(page, selector);
  report(labels.length >= 2 && new Set(labels).size === labels.length, `${name}: labels distinct ${JSON.stringify(labels)}`);
  return labels;
}

/** The axis has labels and its lowest one sits above zero: the chart is zoomed to the data, not anchored at $0. */
async function expectFitted(page, name, url, selector, shot) {
  await page.goto(`${base}${url}`);
  const labels = await expectDistinct(page, name, selector);
  const values = toValues(labels);
  report(values.length >= 2 && Math.min(...values) > 0, `${name}: axis fits the data ${JSON.stringify(values)}`);
  await page.locator(selector).first().screenshot({ path: `shots/${shot}.png` });
}

const json = async (response) => {
  if (!response.ok()) throw new Error(`${response.status()} ${await response.text()}`);
  return response.json();
};

// ------------------------------------------------------------------ deposits recorded: both lines, fitted axis
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  const page = await context.newPage();
  page.on('pageerror', e => console.log(`[pageerror] ${e.message}`));
  await signIn(page, base, mailpit, process.env.CHART_EMAIL ?? 'demo@moneymonkey.example');
  const api = context.request;
  if ((await json(await api.get(`${base}/api/portfolios`))).length === 0) {
    await seedPortfolio(api, base);
  }
  await expectFitted(page, 'overview value chart', '/', 'app-value-chart', 'chart-overview');
  report(await page.locator('app-value-chart .legend').getByText('Net deposits').isVisible(), 'overview legend shows Net deposits (deposits recorded)');
  await page.getByRole('radio', { name: 'All' }).click();
  const all = await axisValues(page, 'app-value-chart');
  report(all.length >= 2 && Math.min(...all) >= 0, `overview value chart, All range: axis labels ${JSON.stringify(all)}`);

  const portfolios = await json(await api.get(`${base}/api/portfolios`));
  const detail = await json(await api.get(`${base}/api/portfolios/${portfolios[0].id}`));
  await expectFitted(page, 'portfolio value chart', `/portfolios/${portfolios[0].id}`, 'app-value-chart', 'chart-portfolio');
  const holding = detail.holdings.find(h => h.securityId) ?? detail.holdings[0];
  await expectFitted(page, 'holding price chart', `/portfolios/${portfolios[0].id}/holdings/${holding.securityId}`, 'app-price-chart', 'chart-holding');
  await expectFitted(page, 'quotes price chart', '/quotes?symbol=SHOP.TO', 'app-price-chart', 'chart-quotes');
  await context.close();
}

// ------------------------------------------------------------------ no deposit recorded: value line only, fitted axis
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  const page = await context.newPage();
  page.on('pageerror', e => console.log(`[pageerror] ${e.message}`));
  await signIn(page, base, mailpit);
  const api = context.request;
  const post = async (path, data) => json(await api.post(`${base}${path}`, { data }));
  const portfolio = await post('/api/portfolios', { name: 'Buys only', baseCurrency: 'CAD', description: 'No deposit recorded' });
  const ry = await post('/api/securities', { symbol: 'RY.TO', historyFrom: '2025-10-01' });
  const { close } = await json(await api.get(`${base}/api/securities/${ry.id}/price-on?date=2025-10-01`));
  // 4,000 shares: a value around $1.1M whose one-month moves are a few thousand dollars, so the ticks need two decimals.
  await post(`/api/portfolios/${portfolio.id}/transactions`, { type: 'Buy', date: '2025-10-01', securityId: ry.id, quantity: 4000, price: close, fee: 9.99 });

  await expectFitted(page, 'buys-only portfolio value chart', `/portfolios/${portfolio.id}`, 'app-value-chart', 'chart-no-deposits');
  report((await page.locator('app-value-chart .legend').getByText('Net deposits').count()) === 0, 'buys-only legend hides Net deposits');
  await page.getByRole('radio', { name: '1M' }).click();
  await page.waitForTimeout(400);
  await expectDistinct(page, 'buys-only portfolio, 1M range (zoomed-in ticks)', 'app-value-chart');
  await page.locator('app-value-chart').screenshot({ path: 'shots/chart-no-deposits-1m.png' });
  await page.getByRole('button', { name: 'Table' }).click();
  await page.locator('app-value-chart table th').first().waitFor();
  const headers = await page.locator('app-value-chart table th').allTextContents();
  report(!headers.some(h => /Net deposits|Earned/.test(h)), `buys-only table columns: ${JSON.stringify(headers.map(h => h.trim()))}`);
  await page.locator('app-value-chart').screenshot({ path: 'shots/chart-no-deposits-table.png' });
  await context.close();
}

await browser.close();
if (failures) {
  console.log(`${failures} chart check(s) failed`);
  process.exit(1);
}
console.log('charts fit their data');
