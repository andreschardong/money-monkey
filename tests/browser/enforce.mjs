// Live check of the allowed-list enforcement against a running Money Monkey: "signin" stores a session while the list is
// open; "check" uses it after the list was restored and expects the session to be rejected.
import { readFileSync, writeFileSync } from 'node:fs';
import { latestLink } from './session.mjs';

const base = 'http://localhost:8090';
const mailpit = 'http://localhost:8025';
const file = 'enforce-session.json';
const json = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

if (process.argv[2] === 'signin') {
  const email = `e2e-enforce-${Date.now()}@example.com`;
  let r = await fetch(`${base}/api/auth/email-link`, json({ email }));
  console.log(`link request: ${r.status}`);
  const token = new URL(await latestLink(mailpit, email)).searchParams.get('token');
  r = await fetch(`${base}/api/auth/email-link/verify`, json({ token }));
  console.log(`verify: ${r.status}`);
  const cookie = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  r = await fetch(`${base}/api/portfolios`, { headers: { cookie } });
  console.log(`portfolios with the list open: ${r.status}`);
  writeFileSync(file, JSON.stringify({ email, cookie }));
} else {
  const { email, cookie } = JSON.parse(readFileSync(file, 'utf8'));
  let r = await fetch(`${base}/api/portfolios`, { headers: { cookie } });
  console.log(`portfolios after the list was restored: ${r.status}${r.status === 401 ? ' (session rejected)' : ' (UNEXPECTED)'}`);
  r = await fetch(`${base}/api/auth/email-link`, json({ email }));
  console.log(`new link for that address: ${r.status} ${(await r.json()).title ?? ''}`);
}
