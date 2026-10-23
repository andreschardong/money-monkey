// A portfolio can be a real-estate account: it is marked as such, a property goes in through the Add property dialog
// and is revalued from its own page, By type shows it as its own slice, and the overview's "Include real estate"
// switch leaves it out of every figure, remembered in the browser.
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

// ------------------------------------------------------------------ the switch is there from the start, on
await page.goto(`${base}/`);
await page.getByRole('heading', { name: 'Net worth' }).waitFor();
const toggle = page.getByRole('switch', { name: 'Include real estate' });
await toggle.waitFor();
report((await toggle.getAttribute('aria-checked')) === 'true', 'overview: the real-estate switch is there before any portfolio is real estate, and on');

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

// ------------------------------------------------------------------ the property, through the Add property dialog
await page.getByText('No properties yet').waitFor();
report(true, 'portfolio page: the empty table offers a property, not shares');
await page.getByRole('button', { name: 'Add property' }).click();
await dialog.getByRole('heading', { name: 'Add a property' }).waitFor();
await dialog.getByRole('button', { name: 'Add property' }).click();
report((await dialog.getByRole('alert').textContent())?.includes('short name') === true, 'dialog: an empty form says what is missing');
await dialog.getByLabel('Short name').fill('APT-SP');
await dialog.getByLabel('Address or description (optional)').fill('Apartment in São Paulo');
await dialog.getByLabel('Purchase date').fill('2019-03-15');
await dialog.getByLabel('Purchase price').fill('420000');
await dialog.getByLabel('Closing costs (optional)').fill('8000');
await dialog.getByLabel('Value today (optional)').fill('500000');
await dialog.screenshot({ path: 'shots/realestate-property-dialog.png' });
await dialog.getByRole('button', { name: 'Add property' }).click();
await dialog.waitFor({ state: 'hidden', timeout: 15000 });
const propertyRow = page.locator('app-holdings-table tbody tr', { hasText: 'APT-SP' });
await propertyRow.waitFor({ timeout: 15000 });
const property = (await json(await api.get(`${base}/api/portfolios/${apartmentId}`))).holdings.find(h => h.symbol === 'APT-SP');
report(property?.assetType === 'RealEstate' && property.quantity === 1, `API: one unit of a RealEstate holding (${property?.assetType}, ${property?.quantity})`);
report(property?.costBasis === 428000 && property?.marketValue === 500000,
  `API: book value is price plus closing costs, value is today's (${property?.costBasis}, ${property?.marketValue})`);
report((await propertyRow.textContent())?.includes('Apartment in São Paulo') === true, 'portfolio page: the property row shows its address');
await page.locator('.header').screenshot({ path: 'shots/realestate-header.png' });

// The three header buttons wrap on a phone instead of widening the page.
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole('button', { name: 'Add property' }).waitFor();
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
report(overflow <= 0, `phone: the real-estate portfolio page does not scroll sideways (${overflow}px)`);
await page.locator('.header').screenshot({ path: 'shots/realestate-header-phone.png' });
await page.getByRole('button', { name: 'Add property' }).click();
await dialog.getByRole('heading', { name: 'Add a property' }).waitFor();
await dialog.screenshot({ path: 'shots/realestate-property-dialog-phone.png' });
await dialog.getByRole('button', { name: 'Cancel' }).click();
await dialog.waitFor({ state: 'hidden' });
await page.setViewportSize({ width: 1440, height: 900 });

// ------------------------------------------------------------------ the overview counts it, then leaves it out
await page.goto(`${base}/`);
await page.getByRole('heading', { name: 'Net worth' }).waitFor();
await toggle.waitFor();
report((await toggle.getAttribute('aria-checked')) === 'true', 'overview: the switch is still on');
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

// ------------------------------------------------------------------ its value is updated from its own page
await page.goto(`${base}/portfolios/${apartmentId}/holdings/${property.securityId}`);
await page.getByRole('button', { name: 'Update value' }).click();
await dialog.getByRole('heading', { name: 'Update value of APT-SP' }).waitFor();
await dialog.getByLabel('Value', { exact: true }).fill('520000');
await dialog.getByRole('button', { name: 'Save value' }).click();
await dialog.waitFor({ state: 'hidden', timeout: 15000 });
await page.waitForFunction(() => document.querySelector('.quote .price')?.textContent?.includes('520,000'), null, { timeout: 15000 });
report(true, 'holding page: Update value moves the property to $520,000');
report(await page.getByText('Valued on').isVisible(), 'holding page: says "Valued on", not "Close on"');
const revalued = (await json(await api.get(`${base}/api/portfolios/${apartmentId}`))).holdings.find(h => h.symbol === 'APT-SP');
report(revalued?.marketValue === 520000, `API: the new value counts in the portfolio (${revalued?.marketValue})`);
await page.locator('.header').screenshot({ path: 'shots/realestate-holding-header.png' });

const exported = await json(await api.get(`${base}/api/export`));
report(exported.portfolios.some(p => p.name === 'Apartment' && p.kind === 'RealEstate'), 'the export carries the kind');

await context.close();
await browser.close();
console.log(failures === 0 ? `\nAll checks passed for ${email}.` : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
