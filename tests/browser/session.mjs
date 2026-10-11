// Shared helpers for the browser checks: sign in through an email link read from Mailpit, and seed a portfolio.

export async function latestLink(mailpit, email, attempts = 20) {
  for (let i = 0; i < attempts; i++) {
    const list = await (await fetch(`${mailpit}/api/v1/messages?limit=30`)).json();
    const mine = list.messages?.find(m => m.To?.some(t => t.Address === email));
    if (mine) {
      const message = await (await fetch(`${mailpit}/api/v1/message/${mine.ID}`)).json();
      const link = /https?:\/\/\S+/.exec(message.Text)?.[0];
      if (link) return link;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`no email for ${email} in Mailpit`);
}

/** Signs the page's context in with a fresh (or given) email and returns the email. */
export async function signIn(page, base, mailpit, email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`) {
  await page.goto(`${base}/sign-in`);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await page.getByRole('heading', { name: 'Check your email' }).waitFor();
  await page.goto(await latestLink(mailpit, email));
  await page.getByRole('button', { name: 'Continue' }).click();
  const notNow = page.getByRole('button', { name: 'Not now' });
  try {
    await notNow.waitFor({ timeout: 8000 });
    await notNow.click();
  } catch {
    // An account that already has a passkey goes straight in.
  }
  await page.waitForURL(url => new URL(url).pathname === '/', { timeout: 15000 });
  return email;
}

/** A CAD portfolio with the smoke-test history, created through the API with the context's session. */
export async function seedPortfolio(request, base) {
  const json = async (response) => {
    if (!response.ok()) throw new Error(`${response.status()} ${await response.text()}`);
    return response.json();
  };
  const post = async (path, data) => json(await request.post(`${base}${path}`, { data }));
  const get = async (path) => json(await request.get(`${base}${path}`));

  const portfolio = await post('/api/portfolios', { name: 'TFSA', baseCurrency: 'CAD', description: 'Smoke test' });
  const tx = data => post(`/api/portfolios/${portfolio.id}/transactions`, data);
  await tx({ type: 'Deposit', date: '2024-01-02', amount: 20000 });
  const shop = await post('/api/securities', { symbol: 'SHOP.TO', historyFrom: '2024-01-15' });
  const shopClose = (await get(`/api/securities/${shop.id}/price-on?date=2024-01-15`)).close;
  await tx({ type: 'Buy', date: '2024-01-15', securityId: shop.id, quantity: 50, price: shopClose, fee: 4.95 });
  const put = async (path, data) => json(await request.put(`${base}${path}`, { data }));
  await put(`/api/portfolios/${portfolio.id}/cash`, { currency: 'CAD', balance: 3000, date: '2024-02-01', note: 'Statement' });
  await put(`/api/portfolios/${portfolio.id}/cash`, { currency: 'USD', balance: 5498, date: '2025-06-02', note: 'Statement' });
  await tx({ type: 'Buy', date: '2024-03-01', symbol: 'NVDA', quantity: 12, price: 822.79, fee: 0 });
  await tx({ type: 'Buy', date: '2024-05-01', symbol: 'RY.TO', quantity: 30, price: 131.2, fee: 4.95 });
  await tx({ type: 'Sell', date: '2025-06-02', securityId: shop.id, quantity: 10, price: 150, fee: 4.95 });
  const nvda = (await get('/api/securities/search?q=NVDA')).find(s => s.symbol === 'NVDA');
  await tx({ type: 'Split', date: '2024-06-10', securityId: nvda.securityId, splitFrom: 1, splitTo: 10 });
  const gic = await post('/api/securities/manual', { symbol: 'GIC-2027', name: 'EQ Bank 2-year GIC', currency: 'CAD', assetType: 'Other', price: 1, date: '2026-10-01' })
    .catch(async () => (await get('/api/securities')).find(s => s.symbol === 'GIC-2027'));
  await tx({ type: 'Buy', date: '2026-10-01', securityId: gic.id, quantity: 1000, price: 1 });
  return portfolio;
}
