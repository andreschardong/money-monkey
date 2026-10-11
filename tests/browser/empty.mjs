// First-run check against a fresh database: the overview invites a first portfolio.
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:8090';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(base);
await page.getByRole('heading', { name: 'Start with a portfolio' }).waitFor({ timeout: 20000 });
await page.screenshot({ path: 'empty-overview.png' });
await page.goto(`${base}/market`);
await page.getByRole('heading', { name: 'Prices and rates' }).waitFor();
await page.waitForTimeout(800);
await page.screenshot({ path: 'empty-market.png' });
console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'empty state ok, no page errors');
await browser.close();
