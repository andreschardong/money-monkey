// Account flow end to end with a virtual authenticator: email activation, passkey registration, sign out,
// passkey sign-in. Usage: node passkeys.mjs [baseUrl] [mailpitUrl]
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:8090';
const mailpit = process.argv[3] ?? 'http://localhost:8025';
const email = `andre-${Date.now()}@example.com`;
const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));

// A platform authenticator (like Windows Hello) that approves every prompt.
const cdp = await context.newCDPSession(page);
await cdp.send('WebAuthn.enable');
await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
});

const step = async (name, fn) => {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: `fail-auth-${name.replace(/\W+/g, '-')}.png` });
    await browser.close();
    process.exit(1);
  }
};

async function latestLink() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const list = await (await fetch(`${mailpit}/api/v1/messages?limit=20`)).json();
    const mine = list.messages?.find(m => m.To?.some(t => t.Address === email));
    if (mine) {
      const message = await (await fetch(`${mailpit}/api/v1/message/${mine.ID}`)).json();
      const link = /https?:\/\/\S+/.exec(message.Text)?.[0];
      if (link) return { subject: message.Subject, link };
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`no email for ${email} in Mailpit`);
}

await step('anonymous API calls are refused', async () => {
  const status = (await fetch(`${base}/api/portfolios`)).status;
  if (status !== 401) throw new Error(`expected 401, got ${status}`);
});

await step('visitors land on the sign-in page', async () => {
  await page.goto(base);
  await page.waitForURL(/\/sign-in/);
  await page.getByRole('heading', { name: 'Sign in' }).waitFor();
  await page.screenshot({ path: 'auth-sign-in.png' });
});

await step('request an activation email', async () => {
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await page.getByRole('heading', { name: 'Check your email' }).waitFor();
  await page.screenshot({ path: 'auth-check-email.png' });
});

let link;
await step('the activation email arrives in Mailpit', async () => {
  const mail = await latestLink();
  console.log(`     "${mail.subject}" -> ${mail.link}`);
  if (!/Activate/.test(mail.subject)) throw new Error('expected an activation email');
  link = mail.link;
});

await step('the link signs in and offers a passkey', async () => {
  await page.goto(link);
  await page.getByRole('heading', { name: 'Sign in to Money Monkey' }).waitFor();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: "You're in" }).waitFor({ timeout: 15000 });
  await page.screenshot({ path: 'auth-offer-passkey.png' });
});

await step('register a passkey', async () => {
  await page.getByLabel(/Name for this passkey/).fill('Playwright PC');
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await page.waitForURL(url => new URL(url).pathname === '/', { timeout: 15000 });
  await page.getByRole('heading', { name: 'Start with a portfolio' }).waitFor();
});

await step('the account page lists it', async () => {
  await page.goto(`${base}/account`);
  await page.getByText('Playwright PC').waitFor();
  await page.getByText(email).first().waitFor();
  await page.screenshot({ path: 'auth-account.png' });
});

await step('sign out', async () => {
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.waitForURL(/\/sign-in/);
});

await step('sign in with the passkey', async () => {
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await page.waitForURL(url => new URL(url).pathname === '/', { timeout: 15000 });
  await page.getByRole('heading', { name: 'Start with a portfolio' }).waitFor();
});

await step('a used activation link is refused', async () => {
  await page.goto(link);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: "This link didn't work" }).waitFor({ timeout: 15000 });
});

await step('sign out everywhere ends the session', async () => {
  await page.goto(`${base}/account`);
  await page.getByRole('button', { name: 'Sign out everywhere' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out everywhere' }).click();
  await page.waitForURL(/\/sign-in/);
  const status = (await page.request.get(`${base}/api/portfolios`)).status();
  if (status !== 401) throw new Error(`expected 401 after signing out everywhere, got ${status}`);
});

console.log(errors.length ? `page errors:\n  ${errors.join('\n  ')}` : 'no page errors');
await browser.close();
