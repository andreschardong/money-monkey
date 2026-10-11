// Drives the UI end to end: create a portfolio, record a deposit and a buy, check the holding, then delete it.
import { chromium } from 'playwright';
import { signIn } from './session.mjs';

const base = process.argv[2] ?? 'http://localhost:4200';
const mailpit = process.argv[3] ?? 'http://localhost:8025';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const step = async (name, fn) => {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: `fail-${name.replace(/\W+/g, '-')}.png` });
    throw e;
  }
};

await signIn(page, base, mailpit);
await page.waitForLoadState('networkidle');

await step('create portfolio', async () => {
  await page.getByRole('button', { name: 'New portfolio' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Playwright USD');
  await dialog.getByRole('radio', { name: 'USD' }).click();
  await dialog.getByRole('button', { name: 'Create portfolio' }).click();
  await page.waitForURL(/\/portfolios\//);
  await page.getByRole('heading', { name: /Playwright USD/ }).waitFor();
});

await step('record deposit', async () => {
  await page.getByRole('button', { name: 'Add transaction' }).first().click();
  await page.getByRole('radio', { name: 'Deposit' }).click();
  await page.getByLabel('Amount', { exact: true }).fill('10000');
  await page.getByRole('button', { name: 'Record deposit' }).click();
  await page.getByText('Deposit recorded.').waitFor();
});

await step('record buy with search and price prefill', async () => {
  await page.getByRole('button', { name: 'Add transaction' }).first().click();
  await page.getByRole('radio', { name: 'Buy' }).click();
  await page.getByLabel('Stock or fund').fill('AAPL');
  await page.getByRole('option', { name: /^AAPL/ }).first().click();
  await page.getByText(/priced in USD/).waitFor({ timeout: 15000 });
  const date = page.getByLabel('Date');
  await date.fill('2026-09-01');
  await date.press('Tab');
  await page.getByText(/Close on/).waitFor({ timeout: 15000 });
  const price = await page.getByLabel('Price per share').inputValue();
  if (!(Number(price) > 0)) throw new Error(`price was not filled in (got "${price}")`);
  await page.getByLabel('Shares').fill('10');
  await page.getByLabel('Commission').fill('1');
  const summary = await page.locator('.summary').innerText();
  if (!/Total cost/.test(summary)) throw new Error(`no summary: ${summary}`);
  await page.getByRole('button', { name: 'Record buy' }).click();
  await page.getByText('Buy recorded.').waitFor();
  console.log(`     bought 10 AAPL at ${price}; ${summary.replace(/\s+/g, ' ')}`);
});

await step('holding appears', async () => {
  await page.getByRole('link', { name: 'AAPL' }).first().waitFor();
  const row = await page.locator('tr', { has: page.getByRole('link', { name: 'AAPL' }) }).first().innerText();
  console.log(`     ${row.replace(/\s+/g, ' ')}`);
});

await step('oversell is refused with a reason', async () => {
  await page.getByRole('button', { name: 'Add transaction' }).first().click();
  await page.getByRole('radio', { name: 'Sell' }).click();
  await page.getByLabel('Stock or fund').click();
  await page.getByRole('option', { name: /^AAPL/ }).first().click();
  await page.getByText('You hold 10 shares.').waitFor();
  await page.getByLabel('Shares').fill('11');
  await page.getByLabel('Price per share').fill('300');
  await page.getByRole('button', { name: 'Record sale' }).click();
  const alert = await page.getByRole('alert').innerText();
  if (!/only 10 held/.test(alert)) throw new Error(`unexpected message: ${alert}`);
  console.log(`     ${alert}`);
  await page.getByRole('button', { name: 'Cancel' }).click();
});

await step('holding page', async () => {
  await page.getByRole('link', { name: 'AAPL' }).first().click();
  await page.waitForURL(/holdings/);
  await page.getByText('Your buys').waitFor();
  await page.screenshot({ path: 'flow-holding.png', fullPage: true });
  await page.locator('a.back').click();
});

await step('delete portfolio', async () => {
  await page.getByRole('button', { name: 'Portfolio options' }).click();
  await page.getByRole('menuitem', { name: 'Delete portfolio' }).click();
  await page.getByRole('button', { name: 'Delete portfolio' }).click();
  await page.waitForURL(url => new URL(url).pathname === '/');
});

console.log(errors.length ? `browser errors:\n  ${errors.join('\n  ')}` : 'no browser errors');
await browser.close();
