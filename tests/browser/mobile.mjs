// Phone-size screenshots of every page and dialog (390 x 844, light). Usage: node mobile.mjs [baseUrl] [outDir] [mailpitUrl]
import { chromium } from 'playwright';
import { seedPortfolio, signIn } from './session.mjs';

const base = process.argv[2] ?? 'http://localhost:8090';
const out = process.argv[3] ?? 'shots';
const mailpit = process.argv[4] ?? 'http://localhost:8025';
const browser = await chromium.launch({ channel: 'msedge' });
const viewport = { width: 390, height: 844 };

const login = await browser.newContext({ viewport });
const loginPage = await login.newPage();
await signIn(loginPage, base, mailpit);
if ((await (await login.request.get(`${base}/api/portfolios`)).json()).length === 0) {
  await seedPortfolio(login.request, base);
}
const storageState = await login.storageState();
const api = login.request;
const portfolios = await (await api.get(`${base}/api/portfolios`)).json();
const first = portfolios[0];
const detail = await (await api.get(`${base}/api/portfolios/${first.id}`)).json();
const holding = detail.holdings[0];
await login.close();

const context = await browser.newContext({ viewport, colorScheme: 'light', deviceScaleFactor: 1, isMobile: true, hasTouch: true, storageState });
const page = await context.newPage();
const problems = [];
page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));

async function settle() {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(700);
}

/** Reports any element wider than the viewport, which shows up as sideways scrolling on a phone. */
async function overflow(name) {
  const wide = await page.evaluate(() => {
    const limit = document.documentElement.clientWidth + 1;
    const found = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > limit && getComputedStyle(el).position !== 'fixed') {
        const scrollParent = el.closest('.scroll, .mat-mdc-tab-header, .mat-mdc-tab-body-content, mat-dialog-content, .cdk-overlay-pane');   // inactive tab bodies sit off-screen by design
        if (!scrollParent) found.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''} right=${Math.round(r.right)}`);
      }
    }
    // The navigation drawer must never scroll sideways either (a long email once widened it).
    const drawer = document.querySelector('mat-sidenav .mat-drawer-inner-container');
    const rail = drawer ? { scrollWidth: drawer.scrollWidth, clientWidth: drawer.clientWidth } : null;
    return { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, found: found.slice(0, 6), rail };
  });
  if (wide.scrollWidth > wide.clientWidth + 1 || wide.found.length) {
    problems.push(`${name}: page ${wide.scrollWidth}px wide in a ${wide.clientWidth}px viewport; ${wide.found.join('; ') || 'no single culprit'}`);
  }
  if (wide.rail && wide.rail.scrollWidth > wide.rail.clientWidth + 1) {
    problems.push(`${name}: the navigation drawer scrolls sideways (${wide.rail.scrollWidth}px of content in ${wide.rail.clientWidth}px)`);
  }
}

async function shot(name, fullPage = true) {
  await settle();
  await overflow(name);
  if (fullPage) {
    await page.addStyleTag({ content: 'html, body, .mat-drawer-container, .mat-drawer-content { height: auto !important; overflow: visible !important; }' });
    await page.waitForTimeout(150);
  }
  await page.screenshot({ path: `${out}/m-${name}.png`, fullPage });
  console.log(`shot ${name}`);
}

await page.goto(`${base}/`);
await shot('overview');
await page.getByRole('button', { name: 'Open navigation' }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/m-nav.png` });
console.log('shot nav');
await page.keyboard.press('Escape');

await page.goto(`${base}/assets`);
await shot('assets');

await page.goto(`${base}/quotes?symbol=SHOP.TO`);
await page.getByRole('heading', { name: 'SHOP.TO' }).waitFor({ timeout: 20000 });
await shot('quotes');

await page.goto(`${base}/market`);
await shot('market');

await page.goto(`${base}/portfolios/${first.id}`);
await shot('portfolio');
await page.getByRole('tab', { name: /Transactions/ }).click();
await shot('transactions');
await page.getByRole('tab', { name: /Income/ }).click();
await shot('income');

await page.getByRole('button', { name: 'Add transaction' }).first().click();
await page.getByRole('dialog').waitFor();
await shot('dialog-transaction', false);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

await page.getByRole('button', { name: 'Cash', exact: true }).click();
await page.getByRole('dialog').waitFor();
await shot('dialog-cash', false);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

await page.getByRole('button', { name: 'Portfolio options' }).click();
await page.getByRole('menuitem', { name: 'Share…' }).click();
await page.getByRole('dialog').waitFor();
await shot('dialog-share', false);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

await page.goto(`${base}/portfolios/${first.id}/holdings/${holding.securityId}`);
await shot('holding');

await page.goto(`${base}/account`);
await shot('account');

await context.close();
const anon = await browser.newContext({ viewport, colorScheme: 'light', isMobile: true, hasTouch: true });
const signin = await anon.newPage();
await signin.goto(`${base}/sign-in`);
await signin.getByRole('heading', { name: 'Sign in' }).waitFor();
await signin.waitForTimeout(600);
await signin.screenshot({ path: `${out}/m-sign-in.png`, fullPage: true });
console.log('shot sign-in');
await anon.close();
await browser.close();

if (problems.length) {
  console.log('PROBLEMS:');
  for (const p of problems) console.log(`  ${p}`);
} else {
  console.log('no overflow or page errors');
}
