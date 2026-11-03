import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideAppTesting } from '../../testing/app-testing';
import {
  bodyOf,
  expectRequest,
  flushNetworkError,
  flushProblem,
  flushStatus,
  verifyNoOutstandingRequests,
} from '../../testing/http';
import { portfolioSummary, security } from '../../testing/fixtures';
import { Api, problemMessage } from './api';

describe('Api', () => {
  let api: Api;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideAppTesting()] });
    api = TestBed.inject(Api);
  });

  afterEach(() => verifyNoOutstandingRequests());

  it('creates a portfolio with every field in the body', async () => {
    const result = api.createPortfolio('Home', 'CAD', null, 'CA', 'RealEstate');
    const request = expectRequest('POST', '/api/portfolios');
    expect(bodyOf(request)).toEqual({
      name: 'Home',
      baseCurrency: 'CAD',
      description: null,
      country: 'CA',
      kind: 'RealEstate',
    });
    request.flush(portfolioSummary({ name: 'Home' }));
    expect((await result).name).toBe('Home');
  });

  it('updates a portfolio by id', async () => {
    const result = api.updatePortfolio('p9', 'Renamed', 'USD', 'Notes', null, 'Investment');
    const request = expectRequest('PUT', '/api/portfolios/p9');
    expect(bodyOf(request)).toEqual({
      name: 'Renamed',
      baseCurrency: 'USD',
      description: 'Notes',
      country: null,
      kind: 'Investment',
    });
    request.flush(portfolioSummary());
    await result;
  });

  it('deletes a portfolio', async () => {
    const result = api.deletePortfolio('p9');
    expectRequest('DELETE', '/api/portfolios/p9').flush(null);
    await expect(result).resolves.toBeNull();
  });

  it('adds a transaction to a portfolio', async () => {
    const result = api.addTransaction('p1', { type: 'Buy', date: '2026-10-01', symbol: 'XYZ', quantity: 5, price: 10 });
    const request = expectRequest('POST', '/api/portfolios/p1/transactions');
    expect(bodyOf(request)).toMatchObject({ type: 'Buy', symbol: 'XYZ', quantity: 5 });
    request.flush([]);
    await expect(result).resolves.toEqual([]);
  });

  it('adds a property to a portfolio', async () => {
    const request = {
      name: 'Condo',
      description: null,
      purchaseDate: '2020-05-01',
      purchasePrice: 400_000,
      closingCosts: 5_000,
      currentValue: null,
    };
    const result = api.addProperty('p1', request);
    const sent = expectRequest('POST', '/api/portfolios/p1/properties');
    expect(bodyOf(sent)).toEqual(request);
    sent.flush({});
    await result;
  });

  it('updates and deletes a transaction by id', async () => {
    const update = api.updateTransaction('p1', 't7', { type: 'Sell', date: '2026-10-02' });
    expectRequest('PUT', '/api/portfolios/p1/transactions/t7').flush({});
    await update;
    const remove = api.deleteTransaction('p1', 't7');
    expectRequest('DELETE', '/api/portfolios/p1/transactions/t7').flush(null);
    await remove;
  });

  it('reads, sets and deletes cash balances, encoding the currency in the path', async () => {
    const read = api.cashEntries('p1');
    expectRequest('GET', '/api/portfolios/p1/cash').flush([]);
    await expect(read).resolves.toEqual([]);

    const set = api.setCash('p1', { currency: 'USD', balance: 12.5, date: null, note: 'Wire' });
    const put = expectRequest('PUT', '/api/portfolios/p1/cash');
    expect(bodyOf(put)).toEqual({ currency: 'USD', balance: 12.5, date: null, note: 'Wire' });
    put.flush({});
    await set;

    const remove = api.deleteCash('p1', 'U/S D', '2026-10-01');
    expectRequest('DELETE', '/api/portfolios/p1/cash/U%2FS%20D/2026-10-01').flush(null);
    await remove;
  });

  it('dismisses a suggestion', async () => {
    const result = api.dismissSuggestion('p1', 's1', '2026-10-01', 'Split');
    const request = expectRequest('POST', '/api/portfolios/p1/suggestions/dismiss');
    expect(bodyOf(request)).toEqual({ securityId: 's1', date: '2026-10-01', kind: 'Split' });
    request.flush(null);
    await result;
  });

  it('searches securities with the query as a parameter and returns an observable', () => {
    let matches: unknown;
    api.searchSecurities('ab&c').subscribe((value) => (matches = value));
    const request = expectRequest('GET', '/api/securities/search?q=ab%26c');
    request.flush([{ symbol: 'ABC' }]);
    expect(matches).toEqual([{ symbol: 'ABC' }]);
  });

  it('resolves a security, with or without a history start', async () => {
    const withHistory = api.resolveSecurity('XYZ', '2024-01-01');
    const first = expectRequest('POST', '/api/securities');
    expect(bodyOf(first)).toEqual({ symbol: 'XYZ', historyFrom: '2024-01-01' });
    first.flush(security());
    await withHistory;

    const without = api.resolveSecurity('XYZ', null);
    const second = expectRequest('POST', '/api/securities');
    expect(bodyOf(second)).toEqual({ symbol: 'XYZ', historyFrom: null });
    second.flush(security());
    await without;
  });

  it('creates a manual security and sets manual prices', async () => {
    const created = api.createManualSecurity('GIC1', 'GIC', 'CAD', 'Fund', 1000, '2026-10-01');
    const post = expectRequest('POST', '/api/securities/manual');
    expect(bodyOf(post)).toEqual({
      symbol: 'GIC1',
      name: 'GIC',
      currency: 'CAD',
      assetType: 'Fund',
      price: 1000,
      date: '2026-10-01',
    });
    post.flush(security());
    await created;

    const price = api.setManualPrice('s1', '2026-10-02', 1010);
    const priced = expectRequest('POST', '/api/securities/s1/prices');
    expect(bodyOf(priced)).toEqual({ date: '2026-10-02', close: 1010 });
    priced.flush(null);
    await price;
  });

  it('asks for a price and for exchange rates on a date', async () => {
    const price = api.priceOn('s1', '2026-10-01');
    expectRequest('GET', '/api/securities/s1/price-on?date=2026-10-01').flush({ securityId: 's1', close: 5 });
    await expect(price).resolves.toMatchObject({ close: 5 });

    const rates = api.fxRates('2026-10-01');
    expectRequest('GET', '/api/fx?date=2026-10-01').flush({ date: '2026-10-01', rates: [] });
    await expect(rates).resolves.toMatchObject({ rates: [] });
  });

  it('lists, adds and removes shares', async () => {
    const list = api.shares('p1');
    expectRequest('GET', '/api/portfolios/p1/shares').flush([]);
    await list;

    const add = api.share('p1', 'grace@example.com', true);
    const put = expectRequest('PUT', '/api/portfolios/p1/shares');
    expect(bodyOf(put)).toEqual({ email: 'grace@example.com', canEdit: true });
    put.flush([]);
    await add;

    const remove = api.unshare('p1', 'grace+x@example.com');
    expectRequest('DELETE', '/api/portfolios/p1/shares?email=grace%2Bx@example.com').flush([]);
    await remove;
  });

  it('imports a file body and refreshes market data', async () => {
    const file = { portfolios: [] };
    const imported = api.importData(file);
    const post = expectRequest('POST', '/api/import');
    expect(bodyOf(post)).toBe(file);
    post.flush({ portfolios: 0, transactions: 0, cashBalances: 0, warnings: [] });
    await imported;

    const refreshed = api.refreshMarketData();
    const refresh = expectRequest('POST', '/api/market/refresh');
    expect(bodyOf(refresh)).toBeNull();
    refresh.flush(null);
    await refreshed;
  });

  it('rejects with the HttpErrorResponse when the server fails', async () => {
    const result = api.deletePortfolio('p9');
    flushProblem(expectRequest('DELETE', '/api/portfolios/p9'), 403, 'You cannot delete this portfolio.');
    const error = await result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpErrorResponse);
    expect(problemMessage(error)).toBe('You cannot delete this portfolio.');
  });
});

describe('problemMessage', () => {
  const failure = (status: number, body: unknown, statusText = 'Bad') =>
    new HttpErrorResponse({ status, statusText, error: body });

  it('prefers the problem detail from the API', () => {
    expect(problemMessage(failure(400, { title: 'Bad', detail: 'Quantity must be positive.' }))).toBe(
      'Quantity must be positive.',
    );
  });

  it('says the server is not reachable when there was no response at all', () => {
    expect(problemMessage(failure(0, null))).toBe(
      'The Money Monkey server is not reachable. Check that it is running.',
    );
  });

  it('shows a plain-text 409 body as it is', () => {
    expect(problemMessage(failure(409, 'That email already has access.'))).toBe('That email already has access.');
  });

  it('falls back to the status line for a 409 that carries no text', () => {
    expect(problemMessage(failure(409, { title: 'Conflict' }, 'Conflict'))).toBe('The request failed (409 Conflict).');
  });

  it.each([
    [401, 'Unauthorized'],
    [500, 'Internal Server Error'],
  ])('falls back to the status line for a %i without a detail', (status, text) => {
    expect(problemMessage(failure(status, null, text))).toBe(`The request failed (${status} ${text}).`);
  });

  it('ignores a problem whose detail is empty and an error body that is not an object', () => {
    expect(problemMessage(failure(500, { detail: '' }, 'Oops'))).toBe('The request failed (500 Oops).');
    expect(problemMessage(failure(502, '<html>', 'Bad Gateway'))).toBe('The request failed (502 Bad Gateway).');
  });

  it('uses the message of an ordinary Error', () => {
    expect(problemMessage(new Error('Boom'))).toBe('Boom');
  });

  it('has a generic message for anything else that was thrown', () => {
    expect(problemMessage('text')).toBe('Something went wrong.');
    expect(problemMessage(undefined)).toBe('Something went wrong.');
  });
});

describe('Api over the wire', () => {
  it('reports an unreachable server through problemMessage', async () => {
    TestBed.configureTestingModule({ providers: [provideAppTesting()] });
    const result = TestBed.inject(Api).refreshMarketData();
    flushNetworkError(expectRequest('POST', '/api/market/refresh'));
    expect(problemMessage(await result.catch((e: unknown) => e))).toContain('not reachable');
  });

  it('reports a text 409 through problemMessage', async () => {
    TestBed.configureTestingModule({ providers: [provideAppTesting()] });
    const result = TestBed.inject(Api).share('p1', 'a@b.c', false);
    flushStatus(expectRequest('PUT', '/api/portfolios/p1/shares'), 409, 'Already shared.');
    expect(problemMessage(await result.catch((e: unknown) => e))).toBe('Already shared.');
  });
});
