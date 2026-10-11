// Screenshots of every page, light and dark, desktop and phone. Usage: node shoot.mjs [baseUrl] [outDir]
import { chromium } from 'playwright';
import { seedPortfolio, signIn } from './session.mjs';

const base = process.argv[2] ?? 'http://localhost:4200';
const out = process.argv[3] ?? '.';
const mailpit = process.argv[4] ?? 'http://localhost:8025';
const browser = await chromium.launch({ channel: 'msedge' });

// One session, reused by every context below.
const login = await browser.newContext();
const loginPage = await login.newPage();
await signIn(loginPage, base, mailpit);
if ((await (await login.request.get(`${base}/api/portfolios`)).json()).length === 0) {
  await seedPortfolio(login.request, base);
}
const storageState = await login.storageState();
const api = login.request;

async function page(theme, viewport) {
  const context = await browser.newContext({ viewport, colorScheme: theme, deviceScaleFactor: 1, storageState });
  await context.addInitScript(t => localStorage.setItem('folio.theme', t), theme);
  const p = await context.newPage();
  p.on('console', m => { if (m.type() === 'error') console.log(`[console ${theme}] ${m.text()}`); });
  p.on('pageerror', e => console.log(`[pageerror ${theme}] ${e.message}`));
  return p;
}

async function settle(p) {
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(900);
  // The sidenav content scrolls internally; let the document grow so full-page shots include everything.
  await p.addStyleTag({ content: 'html, body, .mat-drawer-container, .mat-drawer-content { height: auto !important; overflow: visible !important; }' });
  await p.waitForTimeout(150);
}

const portfolios = await (await api.get(`${base}/api/portfolios`)).json();
const first = portfolios[0];
const detail = first ? await (await api.get(`${base}/api/portfolios/${first.id}`)).json() : null;
const holding = detail?.holdings?.[0];

for (const theme of ['light', 'dark']) {
  const desk = await page(theme, { width: 1440, height: 900 });
  await desk.goto(`${base}/`);
  await settle(desk);
  await desk.screenshot({ path: `${out}/overview-${theme}.png`, fullPage: true });

  await desk.goto(`${base}/assets`);
  await settle(desk);
  await desk.screenshot({ path: `${out}/assets-${theme}.png`, fullPage: true });

  await desk.goto(`${base}/quotes?symbol=SHOP.TO`);
  await desk.getByRole('heading', { name: 'SHOP.TO' }).waitFor({ timeout: 20000 });
  await settle(desk);
  await desk.screenshot({ path: `${out}/quotes-${theme}.png`, fullPage: true });

  if (first) {
    await desk.goto(`${base}/portfolios/${first.id}`);
    await settle(desk);
    await desk.screenshot({ path: `${out}/portfolio-${theme}.png`, fullPage: true });

    await desk.getByRole('tab', { name: /Transactions/ }).click();
    await settle(desk);
    await desk.screenshot({ path: `${out}/transactions-${theme}.png`, fullPage: true });

    await desk.getByRole('tab', { name: /Income/ }).click();
    await settle(desk);
    await desk.screenshot({ path: `${out}/income-${theme}.png`, fullPage: true });

    await desk.getByRole('button', { name: 'Add transaction' }).first().click();
    await settle(desk);
    await desk.screenshot({ path: `${out}/dialog-${theme}.png` });
    await desk.keyboard.press('Escape');

    if (holding) {
      await desk.goto(`${base}/portfolios/${first.id}/holdings/${holding.securityId}`);
      await settle(desk);
      await desk.screenshot({ path: `${out}/holding-${theme}.png`, fullPage: true });
    }
  }

  await desk.goto(`${base}/market`);
  await settle(desk);
  await desk.screenshot({ path: `${out}/market-${theme}.png`, fullPage: true });
  await desk.context().close();

  const phone = await page(theme, { width: 390, height: 844 });
  await phone.goto(`${base}/`);
  await settle(phone);
  await phone.screenshot({ path: `${out}/phone-overview-${theme}.png`, fullPage: true });
  if (first) {
    await phone.goto(`${base}/portfolios/${first.id}`);
    await settle(phone);
    await phone.screenshot({ path: `${out}/phone-portfolio-${theme}.png`, fullPage: true });
  }
  await phone.context().close();
}

for (const theme of ['light', 'dark']) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
  await context.addInitScript(t => localStorage.setItem('folio.theme', t), theme);
  const p = await context.newPage();
  await p.goto(`${base}/sign-in`);
  await p.getByRole('heading', { name: 'Sign in' }).waitFor();
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${out}/sign-in-${theme}.png` });
  await context.close();
}
const acct = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', storageState });
const ap = await acct.newPage();
await ap.goto(`${base}/account`);
await ap.getByRole('heading', { name: 'Account' }).waitFor();
await ap.waitForTimeout(800);
await ap.screenshot({ path: `${out}/account-light.png` });
await acct.close();
await login.close();
await browser.close();
console.log('done');
