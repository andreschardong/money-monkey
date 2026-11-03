import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { provideAppTesting } from '../../../testing/app-testing';
import { FakeDialog, provideFakeDialog } from '../../../testing/dialog';
import { fakeEcharts } from '../../../testing/echarts';
import {
  FakeAuth,
  FakeMarketStatusStore,
  FakePortfolioList,
  provideFakeAuth,
  provideFakeMarketStatusStore,
  provideFakePortfolioList,
} from '../../../testing/fakes';
import { allocation, history, mover, overview, overviewPortfolio, portfolioSummary } from '../../../testing/fixtures';
import { expectRequest, flush, flushNetworkError, settle, verifyNoOutstandingRequests } from '../../../testing/http';
import { PortfolioDialog } from '../../organisms/portfolio-dialog/portfolio-dialog';
import { OverviewPage } from './overview.page';

vi.mock('echarts/core', async () => (await import('../../../testing/echarts')).echartsCoreModule());

const OVERVIEW_URL = '/api/overview?currency=CAD';
const HISTORY_URL = '/api/overview/history?currency=CAD&range=1Y';

describe('OverviewPage', () => {
  let auth: FakeAuth;
  let list: FakePortfolioList;
  let market: FakeMarketStatusStore;
  let dialog: FakeDialog;

  beforeEach(() => {
    fakeEcharts.reset();
    auth = new FakeAuth();
    list = new FakePortfolioList();
    list.resource.value.set([portfolioSummary()]);
    market = new FakeMarketStatusStore();
    dialog = new FakeDialog();
    TestBed.configureTestingModule({
      providers: [
        provideAppTesting({ routes: [{ path: '**', children: [] }] }),
        provideFakeAuth(auth),
        provideFakePortfolioList(list),
        provideFakeMarketStatusStore(market),
        provideFakeDialog(dialog),
      ],
    });
  });

  afterEach(() => verifyNoOutstandingRequests());

  async function create(data = overview(), points = history()) {
    const fixture = TestBed.createComponent(OverviewPage);
    await settle();
    await flush('GET', OVERVIEW_URL, data);
    await flush('GET', HISTORY_URL, points);
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el };
  }

  const text = (el: HTMLElement) => el.textContent?.replace(/\s+/g, ' ') ?? '';

  it('shows a loading message until the overview arrives', async () => {
    const fixture = TestBed.createComponent(OverviewPage);
    await settle();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Loading your portfolios…');
    expectRequest('GET', OVERVIEW_URL).flush(overview());
    expectRequest('GET', HISTORY_URL).flush(history());
  });

  it('welcomes a new account and opens the new portfolio once it is created', async () => {
    list.resource.value.set([]);
    const { el } = await create();
    expect(text(el)).toContain('Start with a portfolio');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    (el.querySelector('button') as HTMLButtonElement).click();
    expect(dialog.last.component).toBe(PortfolioDialog);
    dialog.closeLast(portfolioSummary({ id: 'new1' }));

    expect(list.reload).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/portfolios', 'new1']);
  });

  it('does nothing when the new-portfolio dialog is dismissed', async () => {
    list.resource.value.set([]);
    const { el } = await create();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    (el.querySelector('button') as HTMLButtonElement).click();
    dialog.closeLast();

    expect(list.reload).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('offers to try again when the overview did not load, and reloads both requests', async () => {
    const fixture = TestBed.createComponent(OverviewPage);
    await settle();
    flushNetworkError(expectRequest('GET', OVERVIEW_URL));
    expectRequest('GET', HISTORY_URL).flush(history());
    await settle();
    const el = fixture.nativeElement as HTMLElement;
    expect(text(el)).toContain('The overview did not load');

    (el.querySelector('button') as HTMLButtonElement).click();
    await settle();

    expectRequest('GET', OVERVIEW_URL).flush(overview());
    expectRequest('GET', HISTORY_URL).flush(history());
    await settle();
    expect(text(el)).toContain('Net worth');
  });

  it('shows the net worth with day change, total return, net deposits and the price date', async () => {
    const { el } = await create(overview({ dayChangeDate: '2026-10-29' }));
    const t = text(el);
    expect(el.querySelector('h1')?.textContent?.trim()).toBe('Net worth');
    expect(el.querySelector('app-hero-figure .figure')?.getAttribute('aria-label')).toContain('10,000');
    expect(t).toContain('Thu, Oct 29');
    expect(t).toContain('Total return');
    expect(t).toContain('Net deposits');
    expect(t).toContain('Prices from');
  });

  it('labels the day change Today when the session is today', async () => {
    const { el } = await create();
    expect(el.querySelector('dl.facts dt')?.textContent).toBe('Today');
  });

  it('asks for deposits when the total return is unknown', async () => {
    const { el } = await create(overview({ totalReturn: null }));
    expect(text(el)).toContain('Record deposits to track');
  });

  it('hides every gain figure and the movers when gains are hidden', async () => {
    auth.hideGains.set(true);
    const { el } = await create();
    const t = text(el);
    expect(t).not.toContain('Total return');
    expect(t).not.toContain('Biggest moves');
    expect(t).not.toContain('Today');
    expect(t).toContain('Net deposits');
  });

  it('lists each portfolio with its holdings count, currency, country and owner when shared', async () => {
    const { el } = await create(
      overview({
        portfolios: [
          overviewPortfolio({ id: 'a', name: 'TFSA', holdingsCount: 1 }),
          overviewPortfolio({
            id: 'b',
            name: 'US margin',
            baseCurrency: 'USD',
            value: 5_000,
            valueInDisplay: 6_800,
            country: 'US',
            access: 'Edit',
            ownerEmail: 'grace@example.com',
            holdingsCount: 3,
            totalReturnInDisplay: null,
          }),
          overviewPortfolio({ id: 'c', name: 'House', kind: 'RealEstate', country: null }),
        ],
      }),
    );
    const rows = Array.from(el.querySelectorAll('tbody tr')).map((r) => text(r as HTMLElement));
    expect(rows[0]).toContain('TFSA');
    expect(rows[0]).toContain('1 holding ');
    expect(rows[1]).toContain('US margin');
    expect(rows[1]).toContain('3 holdings');
    expect(rows[1]).toContain('United States');
    expect(rows[1]).toContain('shared by grace@example.com');
    expect(rows[1]).toContain('—');
    expect(rows[2]).toContain('Real estate');
    expect(rows[2]).not.toContain('shared by');
  });

  it('opens a portfolio from its row, and from its link without a second navigation', async () => {
    const { el } = await create();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    (el.querySelector('tbody tr') as HTMLElement).click();
    expect(navigate).toHaveBeenCalledWith(['/portfolios', 'p1']);

    navigate.mockClear();
    (el.querySelector('a.row-link') as HTMLElement).click();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('sorts the portfolios when a column header is clicked', async () => {
    const { fixture, el } = await create(
      overview({
        portfolios: [
          overviewPortfolio({
            id: 'a',
            name: 'Alpha',
            valueInDisplay: 100,
            dayChangeInDisplay: 5,
            totalReturnInDisplay: 7,
          }),
          overviewPortfolio({
            id: 'b',
            name: 'Beta',
            valueInDisplay: 900,
            dayChangeInDisplay: 50,
            totalReturnInDisplay: 70,
          }),
        ],
      }),
    );
    const names = () => Array.from(el.querySelectorAll('a.row-link')).map((a) => a.textContent);
    expect(names()).toEqual(['Alpha', 'Beta']);

    const header = (label: string) =>
      Array.from(el.querySelectorAll('th')).find((th) => th.textContent?.trim() === label) as HTMLElement;
    header('Value').click();
    fixture.detectChanges();
    expect(names()).toEqual(['Beta', 'Alpha']);

    header('Portfolio').click();
    fixture.detectChanges();
    expect(names()).toEqual(['Alpha', 'Beta']);

    header('Today').click();
    fixture.detectChanges();
    expect(names()).toEqual(['Beta', 'Alpha']);

    header('Total return').click();
    fixture.detectChanges();
    expect(names()).toEqual(['Beta', 'Alpha']);
  });

  it('shows a portfolio value in its own currency under the converted one', async () => {
    const { el } = await create(
      overview({
        portfolios: [overviewPortfolio({ baseCurrency: 'USD', value: 5_000, valueInDisplay: 6_800 })],
      }),
    );
    expect(text(el.querySelector('tbody tr') as HTMLElement)).toContain('US$5,000.00');
  });

  it('shows the allocation panels, with country names', async () => {
    const { el } = await create(
      overview({ byCountry: [allocation({ key: 'CA', label: 'CA' }), allocation({ key: '', label: 'Other' })] }),
    );
    const t = text(el);
    expect(t).toContain('By currency');
    expect(t).toContain('By type');
    expect(t).toContain('By country');
    expect(t).toContain('Canada');
    expect(t).toContain('Other');
  });

  it('says so when there is nothing in any allocation', async () => {
    const { el } = await create(
      overview({ byCurrency: [], byAssetType: [], byCountry: [allocation({ key: '', label: 'None' })] }),
    );
    expect(el.querySelectorAll('p.muted')).toHaveLength(3);
    expect(text(el)).toContain('Give a portfolio a country');
  });

  it('lists the biggest moves and each warning', async () => {
    const { el } = await create(
      overview({
        warnings: ['Prices are stale for XYZ'],
        movers: [mover({ symbol: 'ABC', name: 'ABC Inc' }), mover({ securityId: 's2', symbol: 'DEF' })],
      }),
    );
    const t = text(el);
    expect(t).toContain('Prices are stale for XYZ');
    expect(t).toContain('Biggest moves');
    expect(el.querySelectorAll('ul.movers li')).toHaveLength(2);
    expect(t).toContain('ABC');
  });

  it('omits the movers panel when there are none', async () => {
    const { el } = await create(overview({ movers: [] }));
    expect(text(el)).not.toContain('Biggest moves');
  });

  it('draws the value history and refetches when the range changes', async () => {
    const { fixture, el } = await create();
    expect(fakeEcharts.last.setOption).toHaveBeenCalled();

    const sixMonths = Array.from(el.querySelectorAll('mat-button-toggle button')).find(
      (b) => b.textContent?.trim() === '6M',
    );
    (sixMonths as HTMLElement).click();
    await settle();

    await flush('GET', '/api/overview/history?currency=CAD&range=6M', history({ range: '6M' }));
    fixture.detectChanges();
    expect(text(el)).toContain('Net worth');
  });

  it('asks for the other display currency when the switch is used', async () => {
    const { el } = await create();
    const usd = Array.from(el.querySelectorAll('app-currency-switch button')).find(
      (b) => b.textContent?.trim() === 'USD',
    );
    (usd as HTMLElement).click();
    await settle();

    await flush('GET', '/api/overview?currency=USD', overview({ currency: 'USD' }));
    await flush('GET', '/api/overview/history?currency=USD&range=1Y', history({ currency: 'USD' }));
    expect(localStorage.getItem('folio.displayCurrency')).toBe('USD');
    expect(text(el)).toContain('US$');
  });

  it('leaves real estate out of the request when the switch is turned off, and says so in the title', async () => {
    const { el } = await create();
    (el.querySelector('mat-slide-toggle button') as HTMLElement).click();
    await settle();

    await flush('GET', `${OVERVIEW_URL}&excludeRealEstate=true`, overview());
    await flush('GET', `${HISTORY_URL}&excludeRealEstate=true`, history());
    expect(el.querySelector('h1')?.textContent).toContain('without real estate');
  });

  it('reloads both requests when a price refresh finishes', async () => {
    await create();
    market.pricesVersion.set(1);
    await settle();

    await flush('GET', OVERVIEW_URL, overview({ totalValue: 12_345 }));
    await flush('GET', HISTORY_URL, history());
  });

  it('keeps the last overview on screen if a reload fails', async () => {
    const { el } = await create();
    market.pricesVersion.set(1);
    await settle();
    flushNetworkError(expectRequest('GET', OVERVIEW_URL));
    expectRequest('GET', HISTORY_URL).flush(history());
    await settle();

    expect(text(el)).toContain('Net worth');
    expect(text(el)).not.toContain('The overview did not load');
  });

  it('labels the day change with the weekday when the session is not today', async () => {
    market.today.set('2026-10-31');
    const { el } = await create(overview({ dayChangeDate: '2026-10-30' }));
    expect(el.querySelector('dl.facts dt')?.textContent).not.toBe('Today');
  });
});
