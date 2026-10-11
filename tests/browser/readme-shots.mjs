// Screenshots for the README: a demo account with realistic portfolios, framed desktop and phone captures,
// composed into a few images under docs/screenshots. Usage: node readme-shots.mjs [baseUrl] [mailpitUrl]
// Registration must be open on the target (empty FOLIO_ALLOWED_EMAILS) and prices need the internet.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { latestLink } from './session.mjs';

const base = process.argv[2] ?? 'http://localhost:8090';
const mailpit = process.argv[3] ?? 'http://localhost:8025';
const out = '../../docs/screenshots';
const demoEmail = 'demo@moneymonkey.example';
mkdirSync(out, { recursive: true });
mkdirSync('shots', { recursive: true });

const browser = await chromium.launch({ channel: 'msedge' });

// ------------------------------------------------------------------ sign in as the demo account
const login = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const loginPage = await login.newPage();
await loginPage.goto(`${base}/sign-in`);
await loginPage.getByLabel('Email').fill(demoEmail);
await loginPage.getByRole('button', { name: 'Email me a sign-in link' }).click();
await loginPage.getByRole('heading', { name: 'Check your email' }).waitFor();
await loginPage.goto(await latestLink(mailpit, demoEmail));
await loginPage.getByRole('button', { name: 'Continue' }).click();
try {
  const notNow = loginPage.getByRole('button', { name: 'Not now' });
  await notNow.waitFor({ timeout: 8000 });
  await notNow.click();
} catch { /* already has a passkey */ }
await loginPage.waitForURL(url => new URL(url).pathname === '/', { timeout: 15000 });
const api = login.request;

// ------------------------------------------------------------------ demo data (only when the account is empty)
const json = async (response) => {
  if (!response.ok()) throw new Error(`${response.status()} ${await response.text()}`);
  return response.json();
};
const post = async (path, data) => json(await api.post(`${base}${path}`, { data }));
const get = async (path) => json(await api.get(`${base}${path}`));
const put = async (path, data) => json(await api.put(`${base}${path}`, { data }));

async function buy(portfolioId, symbol, date, quantity, fee = 9.99) {
  const security = await post('/api/securities', { symbol, historyFrom: date });
  const { close } = await get(`/api/securities/${security.id}/price-on?date=${date}`);
  await post(`/api/portfolios/${portfolioId}/transactions`, { type: 'Buy', date, securityId: security.id, quantity, price: close, fee });
  return security;
}

let portfolios = await get('/api/portfolios');
if (portfolios.length === 0) {
  console.log('seeding demo portfolios');
  const tfsa = await post('/api/portfolios', { name: 'TFSA', baseCurrency: 'CAD', description: 'Tax-free savings, long-term holdings' });
  await post(`/api/portfolios/${tfsa.id}/transactions`, { type: 'Deposit', date: '2024-01-08', amount: 42000 });
  await buy(tfsa.id, 'SHOP.TO', '2024-01-15', 60);
  await buy(tfsa.id, 'RY.TO', '2024-02-05', 55);
  await buy(tfsa.id, 'ENB.TO', '2024-03-04', 120);
  await buy(tfsa.id, 'CNQ.TO', '2024-06-03', 80);
  await post(`/api/portfolios/${tfsa.id}/transactions`, { type: 'Deposit', date: '2025-01-06', amount: 7000 });
  await buy(tfsa.id, 'XEQT.TO', '2025-01-13', 150);
  await put(`/api/portfolios/${tfsa.id}/cash`, { currency: 'CAD', balance: 2184.5, date: '2026-09-30', note: 'Statement' });

  const rrsp = await post('/api/portfolios', { name: 'RRSP', baseCurrency: 'CAD', description: 'Retirement, US growth' });
  await post(`/api/portfolios/${rrsp.id}/transactions`, { type: 'Deposit', date: '2024-02-01', amount: 35000 });
  await buy(rrsp.id, 'AAPL', '2024-02-12', 40);
  await buy(rrsp.id, 'MSFT', '2024-02-12', 25);
  await buy(rrsp.id, 'NVDA', '2024-04-15', 60);
  await put(`/api/portfolios/${rrsp.id}/cash`, { currency: 'USD', balance: 1520.75, date: '2026-09-30', note: 'Statement' });
  await put(`/api/portfolios/${rrsp.id}/cash`, { currency: 'CAD', balance: 640, date: '2026-09-30' });

  const euro = await post('/api/portfolios', { name: 'Europe', baseCurrency: 'EUR', description: 'Euro account, Amsterdam and Paris' });
  await post(`/api/portfolios/${euro.id}/transactions`, { type: 'Deposit', date: '2024-05-06', amount: 15000 });
  await buy(euro.id, 'ASML.AS', '2024-05-13', 12);
  await buy(euro.id, 'MC.PA', '2024-05-13', 8);
  await put(`/api/portfolios/${euro.id}/cash`, { currency: 'EUR', balance: 980.2, date: '2026-09-30' });
  portfolios = await get('/api/portfolios');
}
// Record the splits Yahoo knows about, so share counts and gains are right; dividend suggestions stay as a showcase.
for (const p of portfolios) {
  for (const s of await get(`/api/portfolios/${p.id}/suggestions`)) {
    if (s.kind === 'Split') {
      await post(`/api/portfolios/${p.id}/transactions`, { type: 'Split', date: s.date, securityId: s.securityId, splitFrom: s.splitFrom, splitTo: s.splitTo });
      console.log(`recorded split ${s.symbol} ${s.splitTo}-for-${s.splitFrom} on ${s.date}`);
    }
  }
}
const tfsa = portfolios.find(p => p.name === 'TFSA') ?? portfolios[0];
const storageState = await login.storageState();
await login.close();

// ------------------------------------------------------------------ captures
async function capture(name, path, { theme = 'light', viewport = { width: 1440, height: 900 }, scale = 1.5, mobile = false, fullPage = false, prepare } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale, colorScheme: theme, isMobile: mobile, hasTouch: mobile, storageState });
  const page = await context.newPage();
  await page.goto(`${base}${path}`);
  await page.waitForLoadState('networkidle');
  if (prepare) await prepare(page);
  await page.waitForTimeout(1200);
  const file = `shots/readme-${name}.png`;
  await page.screenshot({ path: file, fullPage });
  await context.close();
  console.log(`captured ${name}`);
  return file;
}

const overview = await capture('overview', '/');
const overviewDark = await capture('overview-dark', '/', { theme: 'dark' });
const portfolio = await capture('portfolio', `/portfolios/${tfsa.id}`);
const assets = await capture('assets', '/assets');
const quotes = await capture('quotes', '/quotes?symbol=SHOP.TO', { prepare: p => p.getByRole('heading', { name: 'SHOP.TO' }).waitFor({ timeout: 20000 }) });
const phoneOverview = await capture('phone-overview', '/', { viewport: { width: 390, height: 844 }, scale: 2, mobile: true });
const phonePortfolio = await capture('phone-portfolio', `/portfolios/${tfsa.id}`, { viewport: { width: 390, height: 844 }, scale: 2, mobile: true });

// ------------------------------------------------------------------ composition
const dataUrl = file => `data:image/png;base64,${readFileSync(file).toString('base64')}`;
const frameCss = `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Archivo, "Segoe UI", system-ui, sans-serif; }
  .stage { position: relative; display: flex; align-items: flex-start; justify-content: center; padding: 56px 64px 64px; background: radial-gradient(120% 90% at 20% 0%, #e8eef4 0%, #f2f4f5 55%, #e6e1d5 100%); }
  .stage.dark { background: radial-gradient(120% 90% at 20% 0%, #1b2b3a 0%, #0e1519 60%, #101a21 100%); }
  .window { width: 1280px; border-radius: 14px; overflow: hidden; background: #fff; box-shadow: 0 30px 70px rgba(23, 36, 48, 0.28), 0 2px 6px rgba(23, 36, 48, 0.12); }
  .bar { display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 14px; background: #e9edf0; }
  .dark .bar { background: #1f2b34; }
  .bar i { width: 11px; height: 11px; border-radius: 50%; background: #c9d1d8; }
  .dark .bar i { background: #3a4a56; }
  .bar span { margin-left: 10px; font-size: 12px; color: #6b7a86; }
  .window img { display: block; width: 100%; }
  .phone { position: absolute; right: 70px; bottom: 44px; width: 300px; padding: 12px; border-radius: 40px; background: #172430; box-shadow: 0 30px 60px rgba(23, 36, 48, 0.35); }
  .phone img { display: block; width: 100%; border-radius: 30px; }
`;
async function compose(file, html, { width, height, dark = false }) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>${frameCss}</style></head><body><div class="stage${dark ? ' dark' : ''}" style="width:${width}px;min-height:${height}px">${html}</div></body></html>`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${file}`, clip: { x: 0, y: 0, width, height } });
  await page.close();
  console.log(`composed docs/screenshots/${file}`);
}
const win = (img, title) => `<div class="window"><div class="bar"><i></i><i></i><i></i><span>${title}</span></div><img src="${dataUrl(img)}"></div>`;

await compose('hero.png', win(overview, 'moneymonkey.example.com') + `<div class="phone"><img src="${dataUrl(phonePortfolio)}"></div>`, { width: 1600, height: 1010 });
await compose('overview-dark.png', win(overviewDark, 'Dark mode'), { width: 1408, height: 940, dark: true });
await compose('portfolio.png', win(portfolio, 'TFSA'), { width: 1408, height: 940 });
await compose('assets.png', win(assets, 'All assets'), { width: 1408, height: 940 });
await compose('quotes.png', win(quotes, 'Quotes'), { width: 1408, height: 940 });
await compose('phone.png', `<div style="display:flex;gap:48px;justify-content:center"><div class="phone" style="position:static"><img src="${dataUrl(phoneOverview)}"></div><div class="phone" style="position:static"><img src="${dataUrl(phonePortfolio)}"></div></div>`, { width: 900, height: 780 });

await browser.close();
console.log('done');
