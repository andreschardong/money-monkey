// A portfolio can be a real-estate account: it is marked as such, By type shows it as its own slice, and the overview's
// "Include real estate" switch leaves it out of every figure, remembered in the browser.
// Usage: node realestate-check.mjs [baseUrl] [mailpitUrl]   (registration open on the target; prices need the internet)
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
const money = text => parseFloat((text ?? '').replace(/[^\d.-]/g, ''));

const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
const page = await context.newPage();
page.on('pageerror', e => console.log(`[pageerror] ${e.message}`));
const email = await signIn(page, base, mailpit);
const api = context.request;
if ((await json(await api.get(`${base}/api/portfolios`))).length === 0) {
  await seedPortfolio(api, base);
}
const dialog = page.getByRole('dialog');
const hero = page.locator('app-hero-figure .figure').first();
const heroValue = async () => money(await hero.getAttribute('aria-label'));
const typeRows = async () => (await page.locator('section.panel', { has: page.getByRole('heading', { name: 'By type' }) }).locator('.legend tr').allTextContents()).map(r => r.replace(/\s+/g, ' ').trim());

// ------------------------------------------------------------------ no real estate yet: no switch
await page.goto(`${base}/`);
await page.getByRole('heading', { name: 'Net worth' }).waitFor();
report(!(await page.getByRole('switch', { name: 'Include real estate' }).isVisible()), 'overview: no real-estate switch while there is nothing to leave out');

// ------------------------------------------------------------------ a real-estate portfolio
await page.getByRole('button', { name: 'New portfolio' }).click();
await dialog.getByLabel('Name').fill('Apartment');
await dialog.getByRole('radio', { name: 'Real estate' }).click();
await dialog.getByRole('combobox', { name: 'Country (optional)' }).click();
await page.getByRole('option', { name: 'Brazil', exact: true }).click();
await dialog.getByRole('button', { name: 'Create portfolio' }).click();
await page.waitForURL(/\/portfolios\/[0-9a-f-]+$/, { timeout: 15000 });
const apartmentId = new URL(page.url()).pathname.split('/').pop();
await page.getByTestId('kind').waitFor();
report((await page.getByTestId('kind').textContent())?.trim() === 'Real estate', 'portfolio page marks the account as real estate');
report((await json(await api.get(`${base}/api/portfolios/${apartmentId}`))).summary.kind === 'RealEstate', 'the API stores the kind (RealEstate)');

// The property itself: a manually priced holding worth $500,000.
const security = await json(await api.post(`${base}/api/securities/manual`,
  { data: { symbol: 'APT-SP', name: 'Apartment in São Paulo', currency: 'CAD', assetType: 'Other', price: 500000, date: '2026-10-01' } }))
  .catch(async () => (await json(await api.get(`${base}/api/securities`))).find(s => s.symbol === 'APT-SP'));
await json(await api.post(`${base}/api/portfolios/${apartmentId}/transactions`,
  { data: { type: 'Buy', date: '2026-10-01', securityId: security.id, quantity: 1, price: 500000 } }));

// ------------------------------------------------------------------ the overview counts it, then leaves it out
await page.goto(`${base}/`);
await page.getByRole('heading', { name: 'Net worth' }).waitFor();
const toggle = page.getByRole('switch', { name: 'Include real estate' });
await toggle.waitFor();
report((await toggle.getAttribute('aria-checked')) === 'true', 'overview: the switch appears, on by default');
const all = await json(await api.get(`${base}/api/overview?currency=CAD`));
const liquid = await json(await api.get(`${base}/api/overview?currency=CAD&excludeRealEstate=true`));
report(Math.abs(all.totalValue - liquid.totalValue - 500000) < 1, `API: the property is worth $500,000 of the total (${all.totalValue} vs ${liquid.totalValue})`);
await page.locator('table.data tbody tr', { hasText: 'Apartment' }).waitFor();
report(Math.abs((await heroValue()) - all.totalValue) < 1, `overview: net worth includes the property (${await heroValue()})`);
report((await typeRows()).some(r => r.startsWith('Real estate')), `overview: By type has a Real estate slice ${JSON.stringify(await typeRows())}`);
report((await page.locator('table.data tbody tr', { hasText: 'Apartment' }).textContent())?.includes('Real estate') === true, 'overview: the portfolio row is tagged Real estate');
await page.locator('.hero').screenshot({ path: 'shots/realestate-hero.png' });

await toggle.click();
await page.waitForFunction(expected => {
  const label = document.querySelector('app-hero-figure .figure')?.getAttribute('aria-label') ?? '';
  return Math.abs(parseFloat(label.replace(/[^\d.-]/g, '')) - expected) < 1;
}, liquid.totalValue, { timeout: 15000 });
report(true, `overview: net worth drops to the liquid total once real estate is left out (${await heroValue()})`);
report(await page.getByText('without real estate').isVisible(), 'overview: the title says "without real estate"');
await page.locator('table.data tbody tr', { hasText: 'Apartment' }).waitFor({ state: 'hidden', timeout: 10000 });
report(true, 'overview: the Apartment row is gone from the portfolio table');
report(!(await typeRows()).some(r => r.startsWith('Real estate')), `overview: By type has no Real estate slice ${JSON.stringify(await typeRows())}`);
await page.locator('.split').screenshot({ path: 'shots/realestate-panels.png' });

await page.reload();
await toggle.waitFor();
report((await toggle.getAttribute('aria-checked')) === 'false', 'overview: the choice survives a reload (this browser)');
await toggle.click();
await page.locator('table.data tbody tr', { hasText: 'Apartment' }).waitFor({ timeout: 15000 });
report(true, 'overview: switching it back on brings the property back');

const exported = await json(await api.get(`${base}/api/export`));
report(exported.portfolios.some(p => p.name === 'Apartment' && p.kind === 'RealEstate'), 'the export carries the kind');

await context.close();
await browser.close();
console.log(failures === 0 ? `\nAll checks passed for ${email}.` : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
