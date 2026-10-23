// The Account page's "Show gains and losses" switch hides every gain, loss and change figure on every page, and the
// choice is saved on the account. Also checks the loading states: the spinner in index.html before the app's code
// runs, the shell's spinner while the session is checked, a page's spinner while its data loads, and the progress
// bar while a page's code downloads.
// Usage: node gains-check.mjs [baseUrl] [mailpitUrl]   (registration open on the target; prices need the internet)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { seedPortfolio, signIn } from './session.mjs';

const base = process.argv[2] ?? 'http://localhost:8090';
const mailpit = process.argv[3] ?? 'http://localhost:8025';
mkdirSync('shots', { recursive: true });

const browser = await chromium.launch({ channel: 'msedge' });
let failures = 0;
const report = (ok, text) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`); if (!ok) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
/** True when the locator becomes visible within the time given. */
const seen = async (locator, timeout) => {
  try {
    await locator.waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
};
const json = async (response) => {
  if (!response.ok()) throw new Error(`${response.status()} ${await response.text()}`);
  return response.json();
};

// Labels that only ever head a gain, loss or change figure. The day-change label is "Today" or a weekday name.
const GAIN_LABELS = /^(Unrealized gain|Total return|Realized gain|Gain|Earned|Change|%|Change over the range|Per year, money-weighted|Today|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/;

/** Nothing red or green, no change component and no gain heading anywhere on the page. */
async function expectNoGains(page, name) {
  const changes = await page.locator('app-change').count();
  const coloured = await page.locator('.gain, .loss').count();
  const headings = (await page.locator('th, dt').allTextContents()).map(t => t.trim()).filter(t => GAIN_LABELS.test(t));
  report(changes === 0, `${name}: no change figures (${changes} app-change)`);
  report(coloured === 0, `${name}: nothing coloured as a gain or loss (${coloured})`);
  report(headings.length === 0, `${name}: no gain headings ${JSON.stringify(headings)}`);
}

const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
const page = await context.newPage();
page.on('pageerror', e => console.log(`[pageerror] ${e.message}`));
const email = await signIn(page, base, mailpit);
const api = context.request;
if ((await json(await api.get(`${base}/api/portfolios`))).length === 0) {
  await seedPortfolio(api, base);
}
const portfolios = await json(await api.get(`${base}/api/portfolios`));
const portfolio = portfolios[0];
const detail = await json(await api.get(`${base}/api/portfolios/${portfolio.id}`));
const holding = detail.holdings.find(h => h.securityId) ?? detail.holdings[0];

// ------------------------------------------------------------------ loading states
{
  const html = await (await api.get(`${base}/`)).text();
  report(/<app-root><div class="boot" role="status"/.test(html), 'index.html carries a spinner for the first paint');
  report(/boot-spin/.test(html) && !/<script>/.test(html), 'the boot spinner is pure CSS (no inline script, the policy forbids it)');

  // Requests are held back one at a time to watch each loading state. The service worker is kept out of this
  // context: it would answer from its cache, behind the back of the route handlers below.
  const quiet = await browser.newContext({
    viewport: { width: 1440, height: 900 }, colorScheme: 'light', storageState: await context.storageState(), serviceWorkers: 'block',
  });
  const slow = await quiet.newPage();
  await slow.route('**/api/auth/me', async route => { await sleep(1500); await route.continue(); });
  await slow.goto(`${base}/`);
  const shellBusy = slow.locator('app-busy', { hasText: 'Loading Money Monkey' });
  report(await seen(shellBusy, 1200), 'shell shows a spinner while the session is checked');
  await slow.screenshot({ path: 'shots/spinner-session.png' });
  await shellBusy.waitFor({ state: 'hidden', timeout: 10000 });
  report(true, 'the session spinner goes once the session is known');
  await slow.unroute('**/api/auth/me');

  // The overview's data is held back: the page's own spinner must show.
  await slow.route('**/api/overview?*', async route => { await sleep(1500); await route.continue(); });
  await slow.goto(`${base}/`);
  const pageBusy = slow.locator('app-busy', { hasText: 'Loading your portfolios' });
  report(await seen(pageBusy, 1200), 'overview shows a spinner while its data loads');
  await slow.screenshot({ path: 'shots/spinner-overview.png' });
  await pageBusy.waitFor({ state: 'hidden', timeout: 10000 });
  await slow.unroute('**/api/overview?*');

  // A page's code is held back: the progress bar shows while it downloads.
  await slow.route('**/chunk-*.js', async route => { await sleep(900); await route.continue(); });
  await slow.getByRole('link', { name: 'Quotes' }).click();
  const bar = slow.locator('mat-progress-bar.nav-progress');
  report(await seen(bar, 1500), 'a progress bar shows while a page\'s code downloads');
  await slow.getByRole('heading', { name: 'Quotes' }).waitFor();
  await bar.waitFor({ state: 'hidden', timeout: 5000 });
  await slow.unroute('**/chunk-*.js');
  await quiet.close();
}

// ------------------------------------------------------------------ gains shown by default
await page.goto(`${base}/`);
await page.getByRole('heading', { name: 'Net worth' }).waitFor();
report((await page.locator('app-change').count()) > 0, 'overview shows change figures by default');
report((await json(await api.get(`${base}/api/auth/me`))).hideGains === false, '/api/auth/me reports hideGains false by default');

// ------------------------------------------------------------------ the switch
await page.goto(`${base}/account`);
const toggle = page.getByRole('switch', { name: 'Show gains and losses' });
await toggle.waitFor();
report((await toggle.getAttribute('aria-checked')) === 'true', 'Account page: the switch starts on');
await toggle.click();
await page.getByText('Gains and losses are hidden on every page.').waitFor({ timeout: 10000 });
report((await json(await api.get(`${base}/api/auth/me`))).hideGains === true, 'the choice is saved on the account (/api/auth/me hideGains true)');
await page.locator('section.panel', { hasText: 'Display' }).screenshot({ path: 'shots/gains-account.png' });

await page.reload();
await toggle.waitFor();
report((await toggle.getAttribute('aria-checked')) === 'false', 'Account page: the switch is still off after a reload');

// ------------------------------------------------------------------ every page, gains hidden
await page.goto(`${base}/`);
await page.getByRole('heading', { name: 'Net worth' }).waitFor();
await page.locator('table.data tbody tr').first().waitFor();
await expectNoGains(page, 'overview');
report(!(await page.getByRole('heading', { name: 'Biggest moves' }).isVisible()), 'overview: the Biggest moves panel is gone');
await page.getByRole('button', { name: 'Table' }).click();
await page.locator('app-value-chart table').waitFor();
const chartHeads = await page.locator('app-value-chart th').allTextContents();
report(chartHeads.some(t => /Net deposits/.test(t)) && !chartHeads.some(t => /Earned/.test(t)), `overview chart table: Net deposits stays, Earned is gone ${JSON.stringify(chartHeads.map(t => t.trim()))}`);
await page.screenshot({ path: 'shots/gains-off-overview.png', fullPage: true });

await page.goto(`${base}/assets`);
await page.getByRole('heading', { name: 'All assets' }).waitFor();
await page.locator('table.data tbody tr').first().waitFor();
await expectNoGains(page, 'all assets');

await page.goto(`${base}/portfolios/${portfolio.id}`);
await page.locator('app-holdings-table table tbody tr').first().waitFor();
await expectNoGains(page, 'portfolio (holdings)');
const incomeTab = page.getByRole('tab', { name: /^Income/ });
report((await incomeTab.textContent())?.trim() === 'Income', `portfolio: the tab reads "Income" without "and gains" (${(await incomeTab.textContent())?.trim()})`);
await incomeTab.click();
await page.locator('app-income-panel table').first().waitFor();
await expectNoGains(page, 'portfolio (income)');
await page.screenshot({ path: 'shots/gains-off-income.png', fullPage: true });

await page.goto(`${base}/portfolios/${portfolio.id}/holdings/${holding.securityId}`);
await page.locator('dl.stats').waitFor();
await expectNoGains(page, 'holding');

await page.goto(`${base}/quotes?symbol=SHOP.TO`);
await page.locator('.quote .price').waitFor({ timeout: 30000 });
await page.locator('table.data tbody tr').first().waitFor({ timeout: 30000 });
await expectNoGains(page, 'quotes');

await page.goto(`${base}/market`);
await page.locator('table.data tbody tr').first().waitFor();
await expectNoGains(page, 'prices and rates');

// ------------------------------------------------------------------ back on
await page.goto(`${base}/account`);
await toggle.waitFor();
await toggle.click();
await page.getByText('Gains and losses are shown again.').waitFor({ timeout: 10000 });
await page.goto(`${base}/`);
await page.getByRole('heading', { name: 'Net worth' }).waitFor();
await page.locator('app-change').first().waitFor({ timeout: 10000 });
report((await page.locator('app-change').count()) > 0, 'overview shows change figures again once the switch is back on');
report((await json(await api.get(`${base}/api/auth/me`))).hideGains === false, '/api/auth/me reports hideGains false again');

await context.close();
await browser.close();
console.log(failures === 0 ? `\nAll checks passed for ${email}.` : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
