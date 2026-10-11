// Sharing a portfolio with another account (view, then edit), importing an export, and unsharing.
import { chromium } from 'playwright';
import { seedPortfolio, signIn } from './session.mjs';

const base = process.argv[2] ?? 'http://localhost:8090';
const mailpit = process.argv[3] ?? 'http://localhost:8025';
const browser = await chromium.launch({ channel: 'msedge' });
const viewport = { width: 1360, height: 1000 };
const owner = await (await browser.newContext({ viewport })).newPage();
const wife = await (await browser.newContext({ viewport })).newPage();
const errors = [];
for (const page of [owner, wife]) {
  page.on('pageerror', e => errors.push(e.message));
}
const step = async (name, fn) => {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`);
    await owner.screenshot({ path: `fail-share-owner-${name.replace(/\W+/g, '-')}.png` });
    await wife.screenshot({ path: `fail-share-wife-${name.replace(/\W+/g, '-')}.png` });
    await browser.close();
    process.exit(1);
  }
};

const ownerEmail = await signIn(owner, base, mailpit);
const portfolio = await seedPortfolio(owner.request, base);
const wifeEmail = await signIn(wife, base, mailpit);
const url = `${base}/portfolios/${portfolio.id}`;
const dialog = owner.getByRole('dialog');

await step('the other account cannot see the portfolio before it is shared', async () => {
  await wife.goto(url);
  await wife.getByRole('heading', { name: 'Portfolio not found' }).waitFor();
  await wife.goto(`${base}/`);
  await wife.getByRole('heading', { name: 'Start with a portfolio' }).waitFor();
});

await step('sharing refuses an email without an account', async () => {
  await owner.goto(url);
  await owner.getByRole('button', { name: 'Portfolio options' }).click();
  await owner.getByRole('menuitem', { name: 'Share…' }).click();
  await dialog.getByText('Not shared with anyone yet.').waitFor();
  await dialog.getByLabel('Email of a Money Monkey account').fill('nobody-here@example.com');
  await dialog.getByRole('button', { name: 'Share' }).click();
  await dialog.getByRole('alert').filter({ hasText: 'sign up and activate' }).waitFor();
});

await step('the owner shares it to view', async () => {
  await dialog.getByLabel('Email of a Money Monkey account').fill(wifeEmail);
  await dialog.getByRole('button', { name: 'Share' }).click();
  await dialog.getByRole('list', { name: 'Shared with' }).getByText(wifeEmail).waitFor();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await owner.getByTestId('access').filter({ hasText: 'Shared with 1 person' }).waitFor();
});

await step('the other account sees it read-only', async () => {
  await wife.goto(url);
  await wife.getByTestId('access').filter({ hasText: `Shared by ${ownerEmail}, to view.` }).waitFor();
  await wife.getByRole('heading', { name: 'TFSA' }).waitFor();
  if (await wife.getByRole('button', { name: 'Add transaction' }).count()) throw new Error('Add transaction is offered');
  if (await wife.getByRole('button', { name: 'Cash', exact: true }).count()) throw new Error('Cash editing is offered');
  if (await wife.getByRole('button', { name: 'Portfolio options' }).count()) throw new Error('the options menu is offered');
  await wife.getByRole('tab', { name: /Transactions/ }).click();
  await wife.locator('app-transactions-table tbody tr').first().waitFor();
  if (await wife.getByRole('button', { name: /^Actions for/ }).count()) throw new Error('row actions are offered');
  const nav = wife.locator('a.portfolio', { hasText: 'TFSA' });
  await nav.locator('mat-icon.shared').waitFor();
  await wife.goto(`${base}/`);
  await wife.locator('table.data').getByText(`shared by ${ownerEmail}`).waitFor();   // the nav tooltip's hidden description also carries the text
});

await step('the other account cannot write through the API either', async () => {
  const refused = await wife.request.post(`${base}/api/portfolios/${portfolio.id}/transactions`,
    { data: { type: 'Deposit', date: '2026-01-05', amount: 10 } });
  if (refused.status() !== 403) throw new Error(`expected 403, got ${refused.status()}`);
});

await step('the owner allows editing', async () => {
  await owner.getByTestId('access').click();
  const row = dialog.getByRole('list', { name: 'Shared with' }).getByRole('listitem').filter({ hasText: wifeEmail });
  await row.getByRole('checkbox', { name: 'Can edit' }).check();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await wife.goto(url);
  await wife.getByTestId('access').filter({ hasText: 'You can record transactions and cash.' }).waitFor();
  await wife.getByRole('button', { name: 'Add transaction' }).waitFor();
  if (await wife.getByRole('button', { name: 'Portfolio options' }).count()) throw new Error('the options menu is offered to an editor');
});

await step('the other account records a deposit that the owner then sees', async () => {
  const before = (await (await owner.request.get(`${base}/api/portfolios/${portfolio.id}`)).json()).summary.transactionsCount;
  const ok = await wife.request.post(`${base}/api/portfolios/${portfolio.id}/transactions`,
    { data: { type: 'Deposit', date: '2026-01-05', amount: 10 } });
  if (!ok.ok()) throw new Error(`${ok.status()} ${await ok.text()}`);
  await owner.goto(url);
  await owner.getByRole('tab', { name: `Transactions (${before + 1})` }).waitFor();
});

await step('an export imports on the account page', async () => {
  const exported = await (await owner.request.get(`${base}/api/export`)).text();
  await wife.goto(`${base}/account`);
  await wife.locator('input[type=file]').setInputFiles({ name: 'folio-export.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
  await wife.getByRole('status').filter({ hasText: /Added 1 portfolio with \d+ transactions and \d+ cash balances\./ }).waitFor({ timeout: 60000 });
  // Her copy is her own; the shared one keeps its name, so the copy is told apart.
  await wife.locator('a.portfolio', { hasText: 'TFSA (imported)' }).waitFor();
  await wife.locator('a.portfolio', { hasText: 'TFSA (imported)' }).click();
  await wife.getByRole('button', { name: 'Portfolio options' }).waitFor();
  const mine = (await (await wife.request.get(`${base}/api/portfolios`)).json()).find(p => p.name === 'TFSA (imported)');
  const theirs = (await (await owner.request.get(`${base}/api/portfolios/${portfolio.id}`)).json()).summary;
  if (Math.abs(mine.totalValue - theirs.totalValue) > 0.01) throw new Error(`copy is worth ${mine.totalValue}, original ${theirs.totalValue}`);
});

await step('a file that is not an export is refused', async () => {
  await wife.goto(`${base}/account`);
  await wife.locator('input[type=file]').setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await wife.getByRole('alert').filter({ hasText: 'not a Money Monkey export' }).waitFor();
});

await step('the owner unshares and the portfolio disappears for the other account', async () => {
  await owner.goto(url);
  await owner.getByTestId('access').click();
  const row = dialog.getByRole('list', { name: 'Shared with' }).getByRole('listitem').filter({ hasText: wifeEmail });
  await row.getByRole('button', { name: 'Remove' }).click();
  await dialog.getByText('Not shared with anyone yet.').waitFor();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await owner.getByTestId('access').waitFor({ state: 'detached' });
  await wife.goto(url);
  await wife.getByRole('heading', { name: 'Portfolio not found' }).waitFor();
});

await step('no page errors', async () => {
  if (errors.length) throw new Error(errors.join(' | '));
});

await browser.close();
console.log('sharing checks passed');
