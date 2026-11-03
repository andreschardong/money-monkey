import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { provideAppTesting } from '../../../testing/app-testing';
import { fakeEcharts } from '../../../testing/echarts';
import { FakeAuth, provideFakeAuth } from '../../../testing/fakes';
import { security } from '../../../testing/fixtures';
import {
  expectRequest,
  flush,
  flushNetworkError,
  flushProblem,
  settle,
  verifyNoOutstandingRequests,
} from '../../../testing/http';
import { CorporateAction, PricePoint, Security } from '../../core/models';
import { SecurityPicker } from '../../molecules/security-picker/security-picker';
import { QuotesPage } from './quotes.page';

vi.mock('echarts/core', async () => (await import('../../../testing/echarts')).echartsCoreModule());

function closes(...values: number[]): PricePoint[] {
  return values.map((close, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, close }));
}

function action(overrides: Partial<CorporateAction> = {}): CorporateAction {
  return { date: '2026-09-15', kind: 'Dividend', numerator: 1, denominator: 1, amount: 0.5, ...overrides };
}

describe('QuotesPage', () => {
  let auth: FakeAuth;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fakeEcharts.reset();
    auth = new FakeAuth();
    TestBed.configureTestingModule({ providers: [provideAppTesting(), provideFakeAuth(auth)] });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  afterEach(() => verifyNoOutstandingRequests());

  const text = (el: Element) => el.textContent?.replace(/\s+/g, ' ') ?? '';

  function createPage() {
    const fixture = TestBed.createComponent(QuotesPage);
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  /** Looks a symbol up through the address bar and answers everything the page then asks for. */
  async function lookUp(
    options: {
      symbol?: string;
      sec?: Security;
      prices?: PricePoint[];
      actions?: CorporateAction[];
    } = {},
  ) {
    const { fixture, el } = createPage();
    const sec = options.sec ?? security();
    fixture.componentRef.setInput('symbol', options.symbol ?? 'XYZ');
    await settle();
    await flush('POST', '/api/securities', sec);
    await settle();
    await flush('GET', `/api/securities/${sec.id}`, sec);
    await flush('GET', `/api/securities/${sec.id}/prices?range=1Y`, options.prices ?? closes(10, 12, 9, 11));
    await flush('GET', `/api/securities/${sec.id}/actions`, options.actions ?? []);
    fixture.detectChanges();
    return { fixture, el };
  }

  it('invites a search before anything is picked', async () => {
    const { fixture, el } = createPage();
    await fixture.whenStable();
    expect(el.querySelector('h1')?.textContent).toBe('Quotes');
    expect(text(el)).toContain('Search for a symbol to see its quote and history');
  });

  it('looks up the symbol in the address bar once and shows its quote', async () => {
    const { el } = await lookUp({ sec: security({ symbol: 'SHOP.TO', name: 'Shopify', lastPrice: 120 }) });
    expect(el.querySelector('.quote h2')?.textContent?.trim()).toBe('SHOP.TO');
    expect(text(el.querySelector('.quote') as Element)).toContain('Shopify');
    expect(text(el.querySelector('.quote') as Element)).toContain('$120.00');
    expect(text(el.querySelector('.quote') as Element)).toContain('Close on');
    expect(text(el)).not.toContain('Search for a symbol');
  });

  it('lets the address bar spell the symbol in lower case and then writes the canonical one back', async () => {
    await lookUp({ symbol: 'xyz' });
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { symbol: 'XYZ' }, replaceUrl: true }),
    );
  });

  it('does not rewrite the address bar when it already holds the symbol', async () => {
    await lookUp({ symbol: 'XYZ' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('ignores a blank symbol in the address bar', async () => {
    const { fixture } = createPage();
    fixture.componentRef.setInput('symbol', '   ');
    await settle();
    verifyNoOutstandingRequests();
  });

  it('shows why a lookup failed and not the search hint', async () => {
    const { fixture, el } = createPage();
    fixture.componentRef.setInput('symbol', 'NOPE');
    await settle();
    flushProblem(expectRequest('POST', '/api/securities'), 404, 'No such symbol');
    await settle();
    fixture.detectChanges();

    expect(el.querySelector('p.error')?.getAttribute('role')).toBe('alert');
    expect(el.querySelector('p.error')?.textContent).toBe('No such symbol');
    expect(text(el)).not.toContain('Search for a symbol');
  });

  it('says the server is unreachable when the lookup cannot connect', async () => {
    const { fixture, el } = createPage();
    fixture.componentRef.setInput('symbol', 'XYZ');
    await settle();
    flushNetworkError(expectRequest('POST', '/api/securities'));
    await settle();
    fixture.detectChanges();
    expect(el.querySelector('p.error')?.textContent).toContain('not reachable');
  });

  it('follows a symbol chosen in the picker by writing it to the address bar', async () => {
    const { fixture } = createPage();
    await fixture.whenStable();
    const picker = fixture.debugElement.query(By.directive(SecurityPicker)).componentInstance as SecurityPicker;
    picker.value.set({ securityId: 's9', symbol: 'AAPL', name: 'Apple', currency: 'USD', exchange: 'NASDAQ' });
    await settle();

    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { symbol: 'AAPL' } }));
    expectRequest('GET', '/api/securities/s9');
    expectRequest('GET', '/api/securities/s9/prices?range=1Y');
    expectRequest('GET', '/api/securities/s9/actions');
  });

  it('describes the instrument: exchange, currency, ETF, manual or plain asset type', async () => {
    const etf = await lookUp({ sec: security({ assetType: 'Etf', exchange: 'TSX' }) });
    expect(text(etf.el.querySelector('.meta') as Element)).toBe('TSXCADETF');
  });

  it('marks a manually priced security and omits a missing exchange', async () => {
    const { el } = await lookUp({ sec: security({ priceSource: 'Manual', exchange: null }) });
    expect(text(el.querySelector('.meta') as Element)).toBe('CADPriced manually');
  });

  it('names the asset type of an ordinary stock', async () => {
    const { el } = await lookUp({ sec: security({ assetType: 'Stock', priceSource: 'Yahoo' }) });
    expect(text(el.querySelector('.meta') as Element)).toContain('Stock');
  });

  it('shows the range statistics: change, high, low, start and number of closes', async () => {
    const { el } = await lookUp({ prices: closes(10, 12, 9, 11) });
    const facts = text(el.querySelector('dl.facts') as Element);
    expect(facts).toContain('Change over the range');
    expect(facts).toContain('High $12.00');
    expect(facts).toContain('Low $9.00');
    expect(facts).toContain('From $10.00');
    expect(facts).toContain('Closes4');
  });

  it('has no statistics with fewer than two closes, and says no closes are loaded', async () => {
    const { el } = await lookUp({ prices: closes(10) });
    expect(el.querySelector('dl.facts')).toBeNull();
    expect(text(el)).toContain('Recent closes');
  });

  it('says no closes are loaded when there are none', async () => {
    const { el } = await lookUp({ prices: [] });
    expect(text(el)).toContain('No closes loaded yet.');
  });

  it('reports no percentage change when the first close was zero', async () => {
    const { el } = await lookUp({ prices: closes(0, 5) });
    expect(el.querySelector('dl.facts')).not.toBeNull();
    expect(el.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('hides every change figure when gains are hidden', async () => {
    auth.hideGains.set(true);
    const { el } = await lookUp({ actions: [action()] });
    expect(text(el)).not.toContain('Change over the range');
    expect(Array.from(el.querySelectorAll('th')).map((th) => th.textContent)).toEqual([
      'Date',
      'Close',
      'Date',
      'Event',
      'Amount',
    ]);
    expect(el.querySelector('.last app-change')).toBeNull();
  });

  it('lists only the fifteen latest closes, newest first, with the change from the day before', async () => {
    const values = Array.from({ length: 20 }, (_, i) => 100 + i);
    const { el } = await lookUp({ prices: closes(...values) });
    const rows = el.querySelectorAll('.split table:first-of-type tbody tr');
    expect(rows).toHaveLength(15);
    expect(text(rows[0])).toContain('$119.00');
  });

  it('sorts the recent closes by each column', async () => {
    const { fixture, el } = await lookUp({ prices: closes(10, 14, 11) });
    const closeColumn = () =>
      Array.from(el.querySelectorAll('.split table:first-of-type tbody tr')).map((r) =>
        r.querySelectorAll('td')[1].textContent?.trim(),
      );
    const header = (label: string) =>
      Array.from(el.querySelectorAll('.split table:first-of-type th')).find(
        (th) => th.textContent?.trim() === label,
      ) as HTMLElement;
    expect(closeColumn()).toEqual(['$11.00', '$14.00', '$10.00']);

    for (const [label, order] of [
      ['Close', ['$14.00', '$11.00', '$10.00']],
      ['Change', ['$14.00', '$11.00', '$10.00']],
      ['%', ['$14.00', '$11.00', '$10.00']],
      ['Date', ['$11.00', '$14.00', '$10.00']],
    ] as const) {
      header(label).click();
      fixture.detectChanges();
      expect(closeColumn(), label).toEqual([...order]);
    }
  });

  it('says so when there are no dividends or splits', async () => {
    const { el } = await lookUp();
    expect(text(el)).toContain('None on record for the history loaded so far.');
  });

  it('lists dividends and splits and sorts them by date, event and amount', async () => {
    const { fixture, el } = await lookUp({
      actions: [
        action({ date: '2026-03-01', kind: 'Dividend', amount: 0.5 }),
        action({ date: '2026-06-01', kind: 'Split', numerator: 2, denominator: 1 }),
        action({ date: '2026-01-01', kind: 'Dividend', amount: 0.25 }),
      ],
    });
    const rowsOf = () => Array.from(el.querySelectorAll('.split section:nth-of-type(2) tbody tr')).map((r) => text(r));
    expect(rowsOf()[0]).toContain('Split');
    expect(rowsOf()[0]).toContain('2-for-1');
    expect(rowsOf()[1]).toContain('$0.50 a share');

    const header = (label: string) =>
      Array.from(el.querySelectorAll('.split section:nth-of-type(2) th')).find(
        (th) => th.textContent?.trim() === label,
      ) as HTMLElement;
    header('Event').click();
    fixture.detectChanges();
    expect(rowsOf().map((r) => r.includes('Split'))).toEqual([false, false, true]);

    header('Amount').click();
    fixture.detectChanges();
    expect(rowsOf().map((r) => r.includes('Split'))).toEqual([true, false, false]);

    header('Date').click();
    fixture.detectChanges();
    expect(rowsOf()[0]).toContain('Split');
  });

  it('loads another range, keeping the earlier line on screen meanwhile', async () => {
    const { fixture, el } = await lookUp({ prices: closes(10, 12, 9, 11) });
    const threeMonths = Array.from(el.querySelectorAll('app-price-chart mat-button-toggle button')).find(
      (b) => b.textContent?.trim() === '3M',
    ) as HTMLElement;
    threeMonths.click();
    await settle();
    fixture.detectChanges();

    expect(text(el)).toContain('Closes4');
    await flush('GET', '/api/securities/s1/prices?range=3M', closes(1, 2, 3));
    fixture.detectChanges();
    expect(text(el)).toContain('Closes3');
  });

  it('shows prices without the quote card until the security itself has loaded', async () => {
    const { fixture, el } = createPage();
    fixture.componentRef.setInput('symbol', 'XYZ');
    await settle();
    await flush('POST', '/api/securities', security());
    await settle();
    fixture.detectChanges();
    expect(el.querySelector('.quote')).toBeNull();
    expect(el.querySelector('app-price-chart')).not.toBeNull();
    expectRequest('GET', '/api/securities/s1');
    expectRequest('GET', '/api/securities/s1/prices?range=1Y');
    expectRequest('GET', '/api/securities/s1/actions');
  });

  it('shows no closes when the prices cannot be loaded', async () => {
    const { fixture, el } = createPage();
    fixture.componentRef.setInput('symbol', 'XYZ');
    await settle();
    await flush('POST', '/api/securities', security());
    await settle();
    flushNetworkError(expectRequest('GET', '/api/securities/s1/prices?range=1Y'));
    await settle();
    fixture.detectChanges();
    expect(text(el)).toContain('No closes loaded yet.');
    expectRequest('GET', '/api/securities/s1');
    expectRequest('GET', '/api/securities/s1/actions');
  });

  it('drops the earlier line as soon as another security is picked', async () => {
    const { fixture, el } = await lookUp({ prices: closes(10, 12, 9, 11) });
    const picker = fixture.debugElement.query(By.directive(SecurityPicker)).componentInstance as SecurityPicker;
    picker.value.set({ securityId: 's2', symbol: 'ABC', name: 'ABC Ltd', currency: 'CAD', exchange: null });
    await settle();
    fixture.detectChanges();

    expect(text(el)).not.toContain('Closes4');
    expectRequest('GET', '/api/securities/s2');
    expectRequest('GET', '/api/securities/s2/prices?range=1Y');
    expectRequest('GET', '/api/securities/s2/actions');
  });

  it('says none are on record when the dividends and splits cannot be loaded', async () => {
    const { fixture, el } = createPage();
    fixture.componentRef.setInput('symbol', 'XYZ');
    await settle();
    await flush('POST', '/api/securities', security());
    await settle();
    flushNetworkError(expectRequest('GET', '/api/securities/s1/actions'));
    await settle();
    fixture.detectChanges();
    expect(text(el)).toContain('None on record');
    expectRequest('GET', '/api/securities/s1');
    expectRequest('GET', '/api/securities/s1/prices?range=1Y');
  });
});
