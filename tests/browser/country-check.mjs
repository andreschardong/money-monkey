// A portfolio can be given a country when it is created or edited, the portfolio page shows it, and the overview
// sums the portfolios by country next to the splits by currency and by type.
// Usage: node country-check.mjs [baseUrl] [mailpitUrl]   (registration open on the target; prices need the internet)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { seedPortfolio, signIn } from './session.mjs';

const base = process.argv[2] ?? 'http://localhost:8090';
const mailpit = process.argv[3] ?? 'http://localhost:8025';
mkdirSync('shots', { recursive: true });

const browser = await chromium.launch({ channel: 'msedge' });
let failures = 0;
const report = (ok, text) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`); if (!ok) failures++; };
const json = async (response) => {
  if (!response.ok()) throw new Error(`${response.status()} ${await response.text()}`);
  return response.json();
};

const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
const page = await context.newPage();
page.on('pageerror', e => console.log(`[pageerror] ${e.message}`));
const email = await signIn(page, base, mailpit);
const api = context.request;
if ((await json(await api.get(`${base}/api/portfolios`))).length === 0) {
  await seedPortfolio(api, base);
}
const [first] = await json(await api.get(`${base}/api/portfolios`));

/** The open portfolio dialog; the overview behind it has its own USD radio, so everything is scoped to the dialog. */
const dialog = page.getByRole('dialog');

/** Picks a country in the open portfolio dialog (the options render in an overlay outside it). */
async function chooseCountry(name) {
  await dialog.getByRole('combobox', { name: 'Country (optional)' }).click();
  await page.getByRole('option', { name, exact: true }).click();
}

// ------------------------------------------------------------------ nothing placed yet
await page.goto(`${base}/`);
await page.getByRole('heading', { name: 'By country' }).waitFor();
report(await page.getByText('Give a portfolio a country').isVisible(), 'overview: By country explains itself while no portfolio has a country');

// ------------------------------------------------------------------ a new portfolio with a country
await page.getByRole('button', { name: 'New portfolio' }).click();
await dialog.getByLabel('Name').fill('US brokerage');
await dialog.getByRole('radio', { name: 'USD' }).click();
await chooseCountry('United States');
await dialog.getByRole('button', { name: 'Create portfolio' }).click();
await page.waitForURL(/\/portfolios\/[0-9a-f-]+$/, { timeout: 15000 });
const brokerageId = new URL(page.url()).pathname.split('/').pop();
await page.getByTestId('country').waitFor();
report((await page.getByTestId('country').textContent())?.trim() === 'United States', 'portfolio page shows the country it was created with');
report((await json(await api.get(`${base}/api/portfolios/${brokerageId}`))).summary.country === 'US', 'the API stores the code (US)');
await json(await api.put(`${base}/api/portfolios/${brokerageId}/cash`, { data: { currency: 'USD', balance: 1000, date: null, note: null } }));

// ------------------------------------------------------------------ an existing portfolio gets one through Edit
await page.goto(`${base}/portfolios/${first.id}`);
await page.getByRole('button', { name: 'Portfolio options' }).click();
await page.getByRole('menuitem', { name: 'Edit portfolio' }).click();
await chooseCountry('Canada');
await dialog.getByRole('button', { name: 'Save changes' }).click();
await page.getByTestId('country').waitFor({ timeout: 10000 });
report((await page.getByTestId('country').textContent())?.trim() === 'Canada', 'editing a portfolio sets its country');

// Clearing works too: back to None, then Canada again so the overview has two countries.
await page.getByRole('button', { name: 'Portfolio options' }).click();
await page.getByRole('menuitem', { name: 'Edit portfolio' }).click();
await chooseCountry('None');
await dialog.getByRole('button', { name: 'Save changes' }).click();
await page.getByTestId('country').waitFor({ state: 'hidden', timeout: 10000 });
report((await json(await api.get(`${base}/api/portfolios/${first.id}`))).summary.country === null, 'the country can be cleared again');
await json(await api.put(`${base}/api/portfolios/${first.id}`, { data: { name: first.name, baseCurrency: first.baseCurrency, description: first.description, country: 'CA' } }));

// ------------------------------------------------------------------ the overview sums by country
await page.goto(`${base}/`);
await page.getByRole('heading', { name: 'By country' }).waitFor();
const panel = page.locator('section.panel', { has: page.getByRole('heading', { name: 'By country' }) });
await panel.locator('app-allocation-bar').waitFor({ timeout: 10000 });
const rows = await panel.locator('.legend tr').allTextContents();
report(rows.some(r => r.includes('Canada')) && rows.some(r => r.includes('United States')), `overview: By country lists both countries ${JSON.stringify(rows.map(r => r.replace(/\s+/g, ' ').trim()))}`);
const percents = (await panel.locator('.legend .share').allTextContents()).map(t => parseFloat(t.replace('%', '').trim()));
report(percents.every(p => !Number.isNaN(p)) && Math.abs(percents.reduce((a, b) => a + b, 0) - 100) < 0.2, `overview: the shares add up to 100 % (${percents.join(' + ')})`);
const overview = await json(await api.get(`${base}/api/overview?currency=CAD`));
report(overview.byCountry.find(a => a.key === 'US')?.value > 0 && overview.byCountry.find(a => a.key === 'CA')?.value > 0, 'the API reports byCountry with both codes');
report((await page.locator('table.data tbody').first().textContent())?.includes('Canada') === true, 'overview: the portfolio table names the country under the portfolio');
await page.locator('.split').screenshot({ path: 'shots/country-panels.png' });
await page.screenshot({ path: 'shots/country-overview.png', fullPage: true });

const exported = await json(await api.get(`${base}/api/export`));
report(exported.portfolios.some(p => p.country === 'CA') && exported.portfolios.some(p => p.country === 'US'), 'the export carries each portfolio\'s country');

await context.close();
await browser.close();
console.log(failures === 0 ? `\nAll checks passed for ${email}.` : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
