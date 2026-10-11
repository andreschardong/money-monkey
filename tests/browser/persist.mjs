// Sessions must survive an app restart (cookie keys live in the database).
// node persist.mjs save <base> <mailpit>   -> signs in and writes session.json
// node persist.mjs check <base>            -> reuses session.json and reports /api/auth/me
import { chromium } from 'playwright';
import { signIn } from './session.mjs';

const [mode, base = 'http://localhost:8090', mailpit = 'http://localhost:8025'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'msedge' });

if (mode === 'save') {
  const context = await browser.newContext();
  const email = await signIn(await context.newPage(), base, mailpit);
  await context.storageState({ path: 'session.json' });
  console.log(`signed in as ${email}; session saved`);
} else {
  const context = await browser.newContext({ storageState: 'session.json' });
  const me = await (await context.request.get(`${base}/api/auth/me`)).json();
  console.log(me.signedIn ? `still signed in as ${me.email}` : 'SESSION LOST');
  process.exitCode = me.signedIn ? 0 : 1;
}
await browser.close();
