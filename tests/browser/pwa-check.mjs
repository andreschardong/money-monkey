// Checks the installable-app plumbing against a running site: manifest, service worker control after reload,
// and that API navigations (downloads) are not answered from the app-shell cache. Usage: node pwa-check.mjs [base] [mailpit]
import { chromium } from 'playwright';
import { signIn } from './session.mjs';
const base = process.argv[2] ?? 'http://localhost:8090';
const mailpit = process.argv[3] ?? 'http://localhost:8025';
const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
const page = await context.newPage();
const results = [];
const check = (name, ok, detail = '') => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); };

const manifest = await context.request.get(`${base}/manifest.webmanifest`);
const m = manifest.ok() ? await manifest.json() : null;
check('manifest served', manifest.ok() && m?.name === 'Money Monkey', `${manifest.status()} ${m?.name ?? ''} ${m?.display ?? ''}`);
const icon = await context.request.get(`${base}/icons/icon-512x512.png`);
check('512px icon served', icon.ok() && icon.headers()['content-type']?.includes('image/png'));
const worker = await context.request.get(`${base}/ngsw-worker.js`);
check('service worker script served', worker.ok() && (worker.headers()['content-type'] ?? '').includes('javascript'), worker.headers()['content-type']);

await page.goto(`${base}/sign-in`);
const registered = await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 40000))]);
  return reg ? (reg.active?.state ?? 'no active') : 'timeout';
});
check('service worker registered and active', registered === 'activated' || registered === 'activating', registered);
await page.reload();
await page.waitForLoadState('networkidle');
const controlled = await page.evaluate(() => !!navigator.serviceWorker?.controller);
check('page controlled by the service worker after reload', controlled);
const meta = await page.evaluate(() => ({
  theme: document.querySelector('meta[name=theme-color]')?.content,
  apple: document.querySelector('link[rel=apple-touch-icon]')?.getAttribute('href'),
  manifest: document.querySelector('link[rel=manifest]')?.getAttribute('href'),
}));
check('install metadata in the page', meta.theme === '#172430' && !!meta.apple && !!meta.manifest, JSON.stringify(meta));

// A signed-in download must come from the API, not the cached app shell. On an invite-only site a throwaway
// account cannot sign in, so that part is skipped there; an anonymous API navigation still proves the bypass.
let signedIn = false;
try {
  await signIn(page, base, mailpit);
  signedIn = true;
} catch {
  results.push('skip signed-in download checks (sign-in refused: invite-only site or no inbox)');
}
const exportNav = await page.goto(`${base}/api/export`);
const type = exportNav.headers()['content-type'] ?? '';
check(`navigation to /api/export is answered by the API${signedIn ? '' : ' (as 401, not the app shell)'}`,
  signedIn ? type.includes('application/json') : exportNav.status() === 401, `${exportNav.status()} ${type}`);
if (signedIn) {
  // A download navigation can't be awaited with goto; the context's request client shares the session cookie.
  const csv = await context.request.get(`${base}/api/export/transactions.csv`);
  check('CSV download is answered by the API', (csv.headers()['content-type'] ?? '').includes('text/csv'), csv.headers()['content-type']);
}

await browser.close();
for (const r of results) console.log(r);
if (results.some(r => r.startsWith('FAIL'))) process.exit(1);
