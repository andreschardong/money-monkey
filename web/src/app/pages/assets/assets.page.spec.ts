import { TestBed } from '@angular/core/testing';
import { provideAppTesting } from '../../../testing/app-testing';
import {
  FakeAuth,
  FakeMarketStatusStore,
  FakePortfolioList,
  provideFakeAuth,
  provideFakeMarketStatusStore,
  provideFakePortfolioList,
} from '../../../testing/fakes';
import { assetHolding, assets, portfolioSummary } from '../../../testing/fixtures';
import { expectRequest, flush, flushNetworkError, settle, verifyNoOutstandingRequests } from '../../../testing/http';
import { AssetCash } from '../../core/models';
import { AssetsPage } from './assets.page';

const URL_CAD = '/api/assets?currency=CAD';

function cash(overrides: Partial<AssetCash> = {}): AssetCash {
  return {
    currency: 'CAD',
    balance: 500,
    value: 500,
    weight: 0.05,
    portfolios: [{ portfolioId: 'p1', portfolioName: 'Retirement', quantity: 500, value: 500 }],
    ...overrides,
  };
}

describe('AssetsPage', () => {
  let auth: FakeAuth;
  let list: FakePortfolioList;
  let market: FakeMarketStatusStore;

  beforeEach(() => {
    auth = new FakeAuth();
    list = new FakePortfolioList();
    list.resource.value.set([portfolioSummary()]);
    market = new FakeMarketStatusStore();
    TestBed.configureTestingModule({
      providers: [
        provideAppTesting({ routes: [{ path: '**', children: [] }] }),
        provideFakeAuth(auth),
        provideFakePortfolioList(list),
        provideFakeMarketStatusStore(market),
      ],
    });
  });

  afterEach(() => verifyNoOutstandingRequests());

  async function create(data = assets()) {
    const fixture = TestBed.createComponent(AssetsPage);
    await settle();
    await flush('GET', URL_CAD, data);
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el };
  }

  const text = (el: Element) => el.textContent?.replace(/\s+/g, ' ') ?? '';
  const header = (el: HTMLElement, label: string) =>
    Array.from(el.querySelectorAll('th')).find((th) => th.textContent === label) as HTMLElement;
  const tickers = (el: HTMLElement) => Array.from(el.querySelectorAll('tbody .ticker')).map((t) => t.textContent);

  it('shows a loading message until the assets arrive', async () => {
    const fixture = TestBed.createComponent(AssetsPage);
    await settle();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Loading your assets…');
    expectRequest('GET', URL_CAD).flush(assets());
  });

  it('points a new account back to the overview', async () => {
    list.resource.value.set([]);
    const { el } = await create();
    expect(text(el)).toContain('Once you create a portfolio');
    expect(el.querySelector('a')?.getAttribute('href')).toBe('/');
  });

  it('offers to try again when the assets did not load', async () => {
    const fixture = TestBed.createComponent(AssetsPage);
    await settle();
    flushNetworkError(expectRequest('GET', URL_CAD));
    await settle();
    const el = fixture.nativeElement as HTMLElement;
    expect(text(el)).toContain('The assets did not load');

    (el.querySelector('button') as HTMLButtonElement).click();
    await settle();
    await flush('GET', URL_CAD, assets());

    expect(el.querySelector('h1')?.textContent).toBe('All assets');
  });

  it('summarises the totals, one portfolio singular and several plural', async () => {
    const { el } = await create(assets({ portfolioCount: 1 }));
    expect(text(el)).toContain('across 1 portfolio, in CAD');
    expect(text(el)).toContain('Holdings');
    expect(text(el)).toContain('Cash');
    expect(text(el)).toContain('Unrealized gain');
    expect(text(el)).toContain('Today');
    expect(text(el)).toContain('Prices from');
  });

  it('says portfolios when there are several', async () => {
    const { el } = await create(assets({ portfolioCount: 3 }));
    expect(text(el)).toContain('across 3 portfolios');
  });

  it('labels the day change with the weekday when the session is not today', async () => {
    market.today.set('2026-10-31');
    const { el } = await create(assets({ dayChangeDate: '2026-10-30' }));
    expect(el.querySelector('dl.facts div:nth-child(3) dt')?.textContent).toBe('Fri, Oct 30');
  });

  it('hides gains and day changes when gains are hidden', async () => {
    auth.hideGains.set(true);
    const { el } = await create();
    expect(text(el)).not.toContain('Unrealized gain');
    expect(text(el)).not.toContain('Today');
    expect(el.querySelectorAll('thead th')).toHaveLength(6);
  });

  it('shows an empty message when nothing is held', async () => {
    const { el } = await create(assets({ holdings: [], cash: [] }));
    expect(text(el)).toContain('Nothing is held yet');
    expect(el.querySelector('table')).toBeNull();
  });

  it('shows each warning', async () => {
    const { el } = await create(assets({ warnings: ['No price for XYZ'] }));
    expect(text(el)).toContain('No price for XYZ');
  });

  it('lists holdings with where the shares sit, converted value and price', async () => {
    const { el } = await create(
      assets({
        holdings: [
          assetHolding({
            symbol: 'AAPL',
            currency: 'USD',
            marketValue: 1_360,
            marketValueLocal: 1_000,
            portfolios: [
              { portfolioId: 'p1', portfolioName: 'TFSA', quantity: 6, value: 600 },
              { portfolioId: 'p2', portfolioName: 'RRSP', quantity: 4, value: 400 },
            ],
          }),
        ],
      }),
    );
    const row = text(el.querySelector('tbody tr') as HTMLElement);
    expect(row).toContain('AAPL');
    expect(row).toContain('TFSA6 · RRSP4');
    expect(row).toContain('US$1,000.00');
    expect(el.querySelectorAll('.where a')[1].getAttribute('href')).toBe('/portfolios/p2');
  });

  it('shows a dash instead of a price when none is available, and no day change when gains are hidden', async () => {
    auth.hideGains.set(true);
    const { el } = await create(assets({ holdings: [assetHolding({ priceMissing: true })] }));
    expect(el.querySelectorAll('tbody tr td')[3].textContent?.trim()).toBe('—');
    auth.hideGains.set(false);
    await settle();
  });

  it('shows the day change under a price when gains are shown', async () => {
    const { el } = await create();
    expect(el.querySelectorAll('tbody tr td')[3].querySelector('app-change')).not.toBeNull();
  });

  it('lists cash lines after the holdings, with the balance in its own currency', async () => {
    const { el } = await create(
      assets({
        cash: [
          cash(),
          cash({
            currency: 'USD',
            balance: 100,
            value: 136,
            portfolios: [{ portfolioId: 'p1', portfolioName: 'Retirement', quantity: 100, value: 136 }],
          }),
        ],
      }),
    );
    const rows = Array.from(el.querySelectorAll('tr.cash')).map((r) => text(r));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Retirement$500.00');
    expect(rows[0]).not.toContain('US$');
    expect(rows[1]).toContain('US$100.00');
    expect(text(el.querySelector('tfoot') as HTMLElement)).toContain('Total');
  });

  it('leaves out the gain cells of cash and total rows when gains are hidden', async () => {
    auth.hideGains.set(true);
    const { el } = await create(assets({ cash: [cash()] }));
    expect(el.querySelectorAll('tr.cash td')).toHaveLength(6);
    expect(el.querySelectorAll('tfoot td')).toHaveLength(6);
  });

  it('sorts by market value first, then by whichever column is clicked', async () => {
    const { fixture, el } = await create(
      assets({
        holdings: [
          assetHolding({
            securityId: 'a',
            symbol: 'AAA',
            quantity: 1,
            averageCost: 9,
            price: 30,
            marketValue: 100,
            unrealizedGain: 5,
            weight: 0.1,
          }),
          assetHolding({
            securityId: 'b',
            symbol: 'BBB',
            quantity: 2,
            averageCost: 8,
            price: 20,
            marketValue: 900,
            unrealizedGain: 1,
            weight: 0.9,
          }),
          assetHolding({
            securityId: 'c',
            symbol: 'CCC',
            quantity: 3,
            averageCost: 7,
            price: 10,
            marketValue: 500,
            unrealizedGain: 3,
            weight: 0.5,
          }),
        ],
      }),
    );
    expect(tickers(el)).toEqual(['BBB', 'CCC', 'AAA']);

    const expectations: [string, string[]][] = [
      ['Asset', ['AAA', 'BBB', 'CCC']],
      ['Shares', ['CCC', 'BBB', 'AAA']],
      ['Average cost', ['AAA', 'BBB', 'CCC']],
      ['Price', ['AAA', 'BBB', 'CCC']],
      ['Unrealized gain', ['AAA', 'CCC', 'BBB']],
      ['Weight', ['BBB', 'CCC', 'AAA']],
    ];
    for (const [label, order] of expectations) {
      header(el, label).click();
      fixture.detectChanges();
      expect(tickers(el), label).toEqual(order);
    }
  });

  it('asks for the other currency when the switch is used', async () => {
    const { el } = await create();
    const eur = Array.from(el.querySelectorAll('app-currency-switch button')).find(
      (b) => b.textContent?.trim() === 'EUR',
    );
    (eur as HTMLElement).click();
    await settle();

    await flush('GET', '/api/assets?currency=EUR', assets({ currency: 'EUR' }));
    expect(text(el)).toContain('in EUR');
  });

  it('reloads when a price refresh finishes and keeps the page if that reload fails', async () => {
    const { el } = await create();
    market.pricesVersion.set(1);
    await settle();
    flushNetworkError(expectRequest('GET', URL_CAD));
    await settle();

    expect(el.querySelector('h1')?.textContent).toBe('All assets');
    expect(text(el)).not.toContain('did not load');
  });
});
