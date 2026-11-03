import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideAppTesting } from '../../../testing/app-testing';
import { FakeDialog, provideFakeDialog } from '../../../testing/dialog';
import {
  FakeAuth,
  FakeMarketStatusStore,
  FakePortfolioList,
  provideFakeAuth,
  provideFakeMarketStatusStore,
  provideFakePortfolioList,
} from '../../../testing/fakes';
import { marketStatus, refreshRun, security } from '../../../testing/fixtures';
import {
  expectRequest,
  flush,
  flushNetworkError,
  flushProblem,
  settle,
  verifyNoOutstandingRequests,
} from '../../../testing/http';
import { FxRates, Security } from '../../core/models';
import { ManualSecurityDialog } from '../../organisms/manual-security-dialog/manual-security-dialog';
import { MarketPage } from './market.page';

function fxRates(overrides: Partial<FxRates> = {}): FxRates {
  return {
    date: '2026-10-30',
    ratesDate: '2026-10-29',
    rates: [
      { from: 'USD', to: 'CAD', rate: 1.25 },
      { from: 'EUR', to: 'CAD', rate: 1.5 },
    ],
    ...overrides,
  };
}

describe('MarketPage', () => {
  let auth: FakeAuth;
  let list: FakePortfolioList;
  let market: FakeMarketStatusStore;
  let dialog: FakeDialog;
  let snack: { open: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    auth = new FakeAuth();
    list = new FakePortfolioList();
    market = new FakeMarketStatusStore();
    dialog = new FakeDialog();
    snack = { open: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideAppTesting({ routes: [{ path: '**', children: [] }] }),
        provideFakeAuth(auth),
        provideFakePortfolioList(list),
        provideFakeMarketStatusStore(market),
        provideFakeDialog(dialog),
        { provide: MatSnackBar, useValue: snack },
      ],
    });
  });

  afterEach(() => verifyNoOutstandingRequests());

  const text = (el: Element) => el.textContent?.replace(/\s+/g, ' ') ?? '';

  async function create(options: { fx?: FxRates; securities?: Security[] } = {}) {
    const fixture = TestBed.createComponent(MarketPage);
    await settle();
    await flush('GET', '/api/fx', options.fx ?? fxRates());
    await flush('GET', '/api/securities', options.securities ?? [security()]);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  describe('refresh status', () => {
    it('shows when prices and rates were last refreshed and when the next run is', async () => {
      const { el } = await create();
      const status = text(el.querySelector('dl.status') as Element);
      expect(status).toContain('Up to date');
      expect(status).toContain('Next scheduled');
      expect(status).not.toContain('Scheduler off');
      expect(status).toContain('Latest close');
      expect(status).toContain('Latest exchange rate');
      expect(status).toContain('Backup sourceNone');
    });

    it('says the scheduler is off, a backup key is set, and shows the log of the last run', async () => {
      market.resource.value.set(
        marketStatus({
          schedulerEnabled: false,
          fallbackConfigured: true,
          lastRun: refreshRun({ log: 'XYZ updated' }),
        }),
      );
      const { el } = await create();
      expect(text(el)).toContain('Scheduler off');
      expect(text(el)).toContain('Alpha Vantage key set');
      expect(el.querySelector('details pre')?.textContent).toBe('XYZ updated');
    });

    it('says never refreshed when no run is on record', async () => {
      market.resource.value.set(marketStatus({ lastRun: null }));
      const { el } = await create();
      expect(text(el)).toContain('Never refreshed');
      expect(el.querySelector('.dot')?.classList).toContain('none');
      expect(el.querySelector('details')).toBeNull();
    });

    it('uses the start time of a run that has not finished', async () => {
      market.resource.value.set(marketStatus({ lastRun: refreshRun({ finishedAt: null, status: 'Failed' }) }));
      const { el } = await create();
      expect(text(el.querySelector('dl.status') as Element)).toContain('Failed');
    });

    it('shows the status panel only once the status is known', async () => {
      market.resource.hasValue.set(false);
      const { el } = await create();
      expect(el.querySelector('dl.status')).toBeNull();
    });

    it('reports a partly failed refresh', async () => {
      market.resource.value.set(marketStatus({ lastRun: refreshRun({ status: 'PartiallySucceeded' }) }));
      const { el } = await create();
      expect(text(el)).toContain('Some quotes failed');
    });
  });

  describe('refreshing now', () => {
    it('asks the server to refresh and tells the person', async () => {
      const { el } = await create();
      (el.querySelector('button[mat-flat-button]') as HTMLButtonElement).click();
      await settle();
      expectRequest('POST', '/api/market/refresh').flush(null);
      await settle();

      expect(snack.open).toHaveBeenCalledWith('Refreshing quotes and exchange rates.');
      expect(market.reload).toHaveBeenCalled();
    });

    it('shows the reason when the refresh is refused', async () => {
      const { el } = await create();
      (el.querySelector('button[mat-flat-button]') as HTMLButtonElement).click();
      await settle();
      flushProblem(expectRequest('POST', '/api/market/refresh'), 409, 'A refresh is already running');
      await settle();

      expect(snack.open).toHaveBeenCalledWith('A refresh is already running', 'Close');
      expect(market.reload).toHaveBeenCalled();
    });

    it('disables the button while a refresh runs, polls its status, and reloads the data when it ends', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      try {
        const { fixture, el } = await create();
        market.resource.value.set(marketStatus({ running: true }));
        await settle();
        fixture.detectChanges();

        const button = el.querySelector('button[mat-flat-button]') as HTMLButtonElement;
        expect(button.disabled).toBe(true);
        expect(button.textContent).toContain('Refreshing…');
        expect(text(el)).toContain('Running now');

        vi.advanceTimersByTime(3_000);
        expect(market.reload).toHaveBeenCalledTimes(2);

        market.resource.value.set(marketStatus({ running: false }));
        await settle();
        vi.advanceTimersByTime(3_000);
        expect(market.reload).toHaveBeenCalledTimes(2);
        expect(list.reload).toHaveBeenCalled();
        await flush('GET', '/api/fx', fxRates());
        await flush('GET', '/api/securities', [security()]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('stops polling when the page is closed during a refresh', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      try {
        const { fixture } = await create();
        market.resource.value.set(marketStatus({ running: true }));
        await settle();
        fixture.destroy();
        vi.advanceTimersByTime(5_000);
        expect(market.reload).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('exchange rates', () => {
    it('lists each rate with its inverse and adds the euro to dollar cross', async () => {
      const { el } = await create();
      const rows = Array.from(el.querySelectorAll('.split section:first-child tbody tr')).map((r) => text(r));
      expect(rows).toHaveLength(3);
      expect(rows[0]).toContain('USD to CAD');
      expect(rows[0]).toContain('1.25');
      expect(rows[0]).toContain('CAD to USD');
      expect(rows[2]).toContain('EUR to USD');
      expect(rows[2]).toContain('1.2');
      expect(text(el)).toContain('Published Thu, Oct 29.');
    });

    it('sorts the rates by pair and by rate', async () => {
      const { fixture, el } = await create();
      const pairs = () =>
        Array.from(el.querySelectorAll('.split section:first-child tbody tr td:first-child')).map((c) => c.textContent);
      const header = (label: string) =>
        Array.from(el.querySelectorAll('.split section:first-child th')).find(
          (th) => th.textContent === label,
        ) as HTMLElement;

      header('Pair').click();
      fixture.detectChanges();
      expect(pairs()).toEqual(['EUR to CAD', 'EUR to USD', 'USD to CAD']);

      header('Rate').click();
      fixture.detectChanges();
      expect(pairs()).toEqual(['EUR to CAD', 'USD to CAD', 'EUR to USD']);
    });

    it('leaves out the cross when a currency is missing', async () => {
      const { el } = await create({
        fx: fxRates({ rates: [{ from: 'USD', to: 'CAD', rate: 1.25 }], ratesDate: null }),
      });
      expect(el.querySelectorAll('.split section:first-child tbody tr')).toHaveLength(1);
      expect(text(el)).not.toContain('Published');
    });

    it('shows no rates when they cannot be loaded', async () => {
      const fixture = TestBed.createComponent(MarketPage);
      await settle();
      flushNetworkError(expectRequest('GET', '/api/fx'));
      await flush('GET', '/api/securities', []);
      fixture.detectChanges();
      expect(
        (fixture.nativeElement as HTMLElement).querySelectorAll('.split section:first-child tbody tr'),
      ).toHaveLength(0);
    });
  });

  describe('securities', () => {
    const many = [
      security({
        id: 'a',
        symbol: 'AAA',
        name: 'Zed',
        exchange: 'TSX',
        lastPrice: 30,
        dayChangePercent: 0.01,
        lastPriceDate: '2026-10-28',
      }),
      security({
        id: 'b',
        symbol: 'BBB',
        name: 'Yak',
        exchange: null,
        lastPrice: 10,
        dayChangePercent: 0.03,
        lastPriceDate: '2026-10-30',
        priceSource: 'Manual',
        inUse: false,
      }),
      security({
        id: 'c',
        symbol: 'CCC',
        name: 'Xen',
        exchange: 'NYSE',
        lastPrice: 20,
        dayChangePercent: -0.02,
        lastPriceDate: '2026-10-29',
        lastRefreshError: 'No data',
      }),
    ];

    it('says so when no security has been traded yet', async () => {
      const { el } = await create({ securities: [] });
      expect(text(el)).toContain('Securities appear here once you trade them.');
    });

    it('treats securities that cannot be loaded as none', async () => {
      const fixture = TestBed.createComponent(MarketPage);
      await settle();
      await flush('GET', '/api/fx', fxRates());
      flushNetworkError(expectRequest('GET', '/api/securities'));
      await settle();
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain(
        'Securities appear here once you trade them.',
      );
    });

    it('lists the securities with exchange, source and a link to the quote', async () => {
      const { el } = await create({ securities: many });
      const rows = Array.from(el.querySelectorAll('section:last-of-type tbody tr'));
      expect(rows).toHaveLength(3);
      expect(rows[0].querySelector('a.quote-link')?.getAttribute('href')).toBe('/quotes?symbol=AAA');
      expect(text(rows[0])).toContain('Yahoo');
      expect(text(rows[1])).toContain('—');
      expect(text(rows[1])).toContain('Manual');
      expect(rows[1].classList).toContain('unused');
      expect(text(rows[2])).toContain('Failed');
      expect(rows[0].classList).not.toContain('unused');
    });

    it('offers to update the price of manually priced securities only', async () => {
      const { el } = await create({ securities: many });
      const buttons = Array.from(el.querySelectorAll('section:last-of-type tbody button'));
      expect(buttons).toHaveLength(1);
      expect(buttons[0].textContent).toContain('Update price');
    });

    it('hides the change column when gains are hidden', async () => {
      auth.hideGains.set(true);
      const { el } = await create({ securities: many });
      expect(text(el)).not.toContain('Change');
      expect(el.querySelectorAll('section:last-of-type tbody tr:first-child td')).toHaveLength(7);
    });

    it('sorts by every column', async () => {
      const { fixture, el } = await create({ securities: many });
      const symbols = () =>
        Array.from(el.querySelectorAll('section:last-of-type tbody a.quote-link')).map((a) => a.textContent);
      const header = (label: string) =>
        Array.from(el.querySelectorAll('section:last-of-type th')).find(
          (th) => th.textContent === label,
        ) as HTMLElement;
      const cases: [string, string[]][] = [
        ['Symbol', ['CCC', 'BBB', 'AAA']],
        ['Name', ['CCC', 'BBB', 'AAA']],
        ['Exchange', ['CCC', 'AAA', 'BBB']],
        ['Last close', ['AAA', 'CCC', 'BBB']],
        ['Change', ['BBB', 'AAA', 'CCC']],
        ['Date', ['BBB', 'CCC', 'AAA']],
        ['Source', ['CCC', 'BBB', 'AAA']],
      ];
      for (const [label, order] of cases) {
        header(label).click();
        fixture.detectChanges();
        expect(symbols(), label).toEqual(order);
      }
    });
  });

  describe('manually priced securities', () => {
    it('adds one through the dialog, then confirms and reloads the list', async () => {
      const { el } = await create();
      (
        Array.from(el.querySelectorAll('button')).find((b) =>
          b.textContent?.includes('Add manually priced security'),
        ) as HTMLElement
      ).click();
      expect(dialog.last.component).toBe(ManualSecurityDialog);
      dialog.closeLast(security());
      await settle();

      expect(snack.open).toHaveBeenCalledWith('Security added. Find it by its code when you add a transaction.');
      await flush('GET', '/api/securities', [security()]);
    });

    it('does nothing when the add dialog is dismissed', async () => {
      const { el } = await create();
      (
        Array.from(el.querySelectorAll('button')).find((b) =>
          b.textContent?.includes('Add manually priced security'),
        ) as HTMLElement
      ).click();
      dialog.closeLast();
      expect(snack.open).not.toHaveBeenCalled();
    });

    it('updates the price of a manual security, then reloads the list and portfolios', async () => {
      const manual = security({ priceSource: 'Manual', symbol: 'GIC1' });
      const { el } = await create({ securities: [manual] });
      (
        Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Update price')) as HTMLElement
      ).click();
      expect(dialog.last.data).toEqual({ security: manual });
      dialog.closeLast(true);
      await settle();

      expect(snack.open).toHaveBeenCalledWith('Price of GIC1 saved.');
      expect(list.reload).toHaveBeenCalled();
      await flush('GET', '/api/securities', [manual]);
    });

    it('does nothing when the update dialog is dismissed', async () => {
      const { el } = await create({ securities: [security({ priceSource: 'Manual' })] });
      (
        Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Update price')) as HTMLElement
      ).click();
      dialog.closeLast();
      expect(snack.open).not.toHaveBeenCalled();
      expect(list.reload).not.toHaveBeenCalled();
    });
  });
});
