// Suggestions, edit, conversion and delete flows on the first portfolio.
import { chromium } from 'playwright';
import { seedPortfolio, signIn } from './session.mjs';

const base = process.argv[2] ?? 'http://localhost:4200';
const mailpit = process.argv[3] ?? 'http://localhost:8025';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const step = async (name, fn) => {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: `fail2-${name.replace(/\W+/g, '-')}.png` });
    await browser.close();
    process.exit(1);
  }
};

await signIn(page, base, mailpit);
const portfolio = await seedPortfolio(page.request, base);
await page.goto(`${base}/portfolios/${portfolio.id}`);
await page.waitForLoadState('networkidle');
const dialog = page.getByRole('dialog');

await step('record a suggested dividend', async () => {
  const notice = page.locator('.notice', { hasText: 'went ex-dividend' }).first();
  const text = await notice.innerText();
  const symbol = text.split(' ')[0].trim();
  await notice.getByRole('button', { name: 'Record dividend' }).click();
  await dialog.getByLabel('Dividend received').waitFor();
  const amount = await dialog.getByLabel('Dividend received').inputValue();
  const date = await dialog.getByLabel('Date').inputValue();
  console.log(`     ${symbol}: prefilled ${amount} on ${date}`);
  await dialog.getByLabel('Tax withheld').fill('4.5');
  await dialog.getByRole('button', { name: 'Record dividend' }).click();
  await page.getByText('Dividend recorded.').waitFor();
  await page.locator('.notice', { hasText: `${symbol} went ex-dividend` }).waitFor({ state: 'detached', timeout: 8000 });
});

await step('edit a transaction', async () => {
  await page.getByRole('tab', { name: /Transactions/ }).click();
  const row = page.locator('tr', { hasText: 'GIC-2027' }).first();
  await row.getByRole('button', { name: /Actions for/ }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await dialog.getByLabel('Note (optional)').fill('Matures Oct 2027');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await page.getByText('Transaction updated.').waitFor();
  await page.getByText('Matures Oct 2027').waitFor();
});

await step('set a cash balance from the holdings tab', async () => {
  await page.getByRole('tab', { name: /Holdings/ }).click();
  await page.getByRole('button', { name: 'Cash', exact: true }).click();
  await dialog.getByLabel('Currency').click();
  await page.getByRole('option', { name: 'USD' }).click();
  await dialog.getByLabel('Balance', { exact: true }).fill('2500');
  await dialog.getByLabel('Note (optional)').fill('Statement of Oct 9');
  await dialog.getByRole('button', { name: 'Save balance' }).click();
  await page.getByText('Cash balance saved.').waitFor();
  await page.locator('tr.cash', { hasText: 'USD' }).getByText('US$2,500.00').waitFor();
});

await step('a buy leaves the cash balance alone', async () => {
  await page.getByRole('button', { name: 'Add transaction' }).first().click();
  await dialog.getByRole('radio', { name: 'Buy' }).click();
  await dialog.getByLabel('Stock or fund').fill('AAPL');
  await page.getByRole('option', { name: /^AAPL/ }).first().click();
  await dialog.getByText(/priced in USD/).waitFor({ timeout: 15000 });
  await dialog.getByLabel('Shares').fill('1');
  await dialog.getByLabel('Price per share').fill('200');
  await dialog.getByRole('button', { name: 'Record buy' }).click();
  await page.getByText('Buy recorded.').waitFor();
  await page.locator('tr.cash', { hasText: 'USD' }).getByText('US$2,500.00').waitFor();
});

await step('switch overview currency', async () => {
  await page.goto(base);
  await page.waitForLoadState('networkidle');
  const cad = await page.locator('app-hero-figure').innerText();
  await page.getByRole('radio', { name: 'USD' }).click();
  await page.locator('app-hero-figure', { hasText: 'US$' }).waitFor({ timeout: 8000 });
  const usd = await page.locator('app-hero-figure').innerText();
  console.log(`     ${cad.replace(/\s+/g, '')} -> ${usd.replace(/\s+/g, '')}`);
  if (!usd.includes('US$')) throw new Error('not shown in USD');
  await page.getByRole('radio', { name: 'CAD' }).click();
});

await step('column headers sort the holdings', async () => {
  await page.goto(`${base}/portfolios/${portfolio.id}`);
  await page.getByRole('tab', { name: /Holdings/ }).click();
  const firstRow = page.locator('table.data tbody tr').first();
  const expectFirst = (ticker) => firstRow.locator('.ticker', { hasText: ticker }).waitFor({ timeout: 5000 });
  await expectFirst('NVDA');                                             // biggest value first by default
  await page.getByRole('columnheader', { name: 'Holding' }).click();
  await expectFirst('AAPL');                                             // A to Z
  await page.getByRole('columnheader', { name: 'Holding' }).click();
  await expectFirst('SHOP.TO');                                          // Z to A
  await page.getByRole('columnheader', { name: 'Shares' }).click();
  await expectFirst('GIC-2027');                                         // most shares first
  await page.getByRole('columnheader', { name: 'Market value' }).click();
  await expectFirst('NVDA');
});

await step('the quotes page shows a symbol from the address bar', async () => {
  await page.goto(`${base}/quotes?symbol=SHOP.TO`);
  await page.getByRole('heading', { name: 'SHOP.TO' }).waitFor({ timeout: 20000 });
  await page.getByRole('heading', { name: 'Recent closes' }).waitFor();
  const rows = await page.locator('table.data tbody tr').count();
  if (rows < 2) throw new Error(`expected recent closes, found ${rows} rows`);
  await page.getByText(/Change over the range/).waitFor();
});

await step('all assets lists holdings and cash across portfolios', async () => {
  await page.goto(`${base}/assets`);
  await page.getByRole('heading', { name: 'All assets' }).waitFor();
  await page.locator('tr', { hasText: 'SHOP.TO' }).first().waitFor();
  await page.locator('tr.cash', { hasText: 'USD' }).first().waitFor();
  const total = await page.locator('tfoot').innerText();
  console.log(`     ${total.replace(/\s+/g, ' ').trim()}`);
});

console.log(errors.length ? `page errors:\n  ${errors.join('\n  ')}` : 'no page errors');
await browser.close();
