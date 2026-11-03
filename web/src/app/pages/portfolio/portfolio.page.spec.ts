import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { By } from '@angular/platform-browser';
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
import {
  cashBalance,
  history,
  holding,
  portfolioDetail,
  portfolioSummary,
  transaction,
} from '../../../testing/fixtures';
import {
  bodyOf,
  expectRequest,
  flush,
  flushNetworkError,
  flushProblem,
  flushStatus,
  settle,
  verifyNoOutstandingRequests,
} from '../../../testing/http';
import { PortfolioDetail, PortfolioSummary, RealizedReport, Suggestion, Transaction } from '../../core/models';
import { CashDialog } from '../../organisms/cash-dialog/cash-dialog';
import { HoldingsTable } from '../../organisms/holdings-table/holdings-table';
import { PortfolioDialog } from '../../organisms/portfolio-dialog/portfolio-dialog';
import { PropertyDialog } from '../../organisms/property-dialog/property-dialog';
import { ShareDialog } from '../../organisms/share-dialog/share-dialog';
import { TransactionDialog } from '../../organisms/transaction-dialog/transaction-dialog';
import { TransactionsTable } from '../../organisms/transactions-table/transactions-table';
import { PortfolioPage } from './portfolio.page';

vi.mock('echarts/core', async () => (await import('../../../testing/echarts')).echartsCoreModule());

function suggestion(overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    kind: 'Dividend',
    securityId: 's1',
    symbol: 'XYZ',
    name: 'XYZ Corp',
    date: '2026-10-15',
    currency: 'CAD',
    splitFrom: null,
    splitTo: null,
    perShare: 0.5,
    quantity: 10,
    amount: 5,
    ...overrides,
  };
}

function split(overrides: Partial<Suggestion> = {}): Suggestion {
  return suggestion({
    kind: 'Split',
    splitFrom: 1,
    splitTo: 2,
    perShare: null,
    quantity: null,
    amount: null,
    ...overrides,
  });
}

function report(years = 1): RealizedReport {
  return {
    currency: 'CAD',
    sales: [],
    years: Array.from({ length: years }, (_, i) => ({
      year: 2026 - i,
      proceeds: 1_000,
      costBasis: 800,
      gain: 200,
      dividends: 50,
      interest: 5,
      taxWithheld: 1,
    })),
  };
}

describe('PortfolioPage', () => {
  let auth: FakeAuth;
  let list: FakePortfolioList;
  let market: FakeMarketStatusStore;
  let dialog: FakeDialog;
  let snack: { open: ReturnType<typeof vi.fn> };
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fakeEcharts.reset();
    auth = new FakeAuth();
    list = new FakePortfolioList();
    market = new FakeMarketStatusStore();
    dialog = new FakeDialog();
    snack = { open: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideAppTesting(),
        provideFakeAuth(auth),
        provideFakePortfolioList(list),
        provideFakeMarketStatusStore(market),
        provideFakeDialog(dialog),
        { provide: MatSnackBar, useValue: snack },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  afterEach(() => verifyNoOutstandingRequests());

  const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  const button = (el: ParentNode, label: string) =>
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(label)) as HTMLButtonElement;

  function summary(overrides: Partial<PortfolioSummary> = {}): PortfolioSummary {
    return portfolioSummary({ id: 'p1', ...overrides });
  }

  interface Answers {
    detail?: PortfolioDetail;
    transactions?: Transaction[];
    suggestions?: Suggestion[];
  }

  /** Creates the page for portfolio p1 and answers the four requests it makes. */
  async function open(answers: Answers = {}, id = 'p1') {
    const fixture = TestBed.createComponent(PortfolioPage);
    fixture.componentRef.setInput('id', id);
    await settle();
    await flush('GET', `/api/portfolios/${id}`, answers.detail ?? portfolioDetail({ summary: summary({ id }) }));
    await flush('GET', `/api/portfolios/${id}/history?range=1Y`, history());
    await flush('GET', `/api/portfolios/${id}/transactions`, answers.transactions ?? [transaction()]);
    await flush('GET', `/api/portfolios/${id}/suggestions`, answers.suggestions ?? []);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  /** Answers the requests a refresh makes. */
  async function answerRefresh(options: { realized?: boolean; detail?: PortfolioDetail } = {}) {
    await flush('GET', '/api/portfolios/p1', options.detail ?? portfolioDetail({ summary: summary() }));
    await flush('GET', '/api/portfolios/p1/history?range=1Y', history());
    await flush('GET', '/api/portfolios/p1/transactions', [transaction()]);
    await flush('GET', '/api/portfolios/p1/suggestions', []);
    if (options.realized) {
      await flush('GET', '/api/portfolios/p1/realized', report());
    }
  }

  const component = <T>(
    fixture: { debugElement: { query(p: unknown): { componentInstance: unknown } } },
    type: unknown,
  ) => fixture.debugElement.query(By.directive(type as never)).componentInstance as T;

  /** Selects a tab; inactive tabs are not rendered. */
  async function selectTab(fixture: { detectChanges(): void }, el: HTMLElement, index: number) {
    (el.querySelectorAll('[role="tab"]')[index] as HTMLElement).click();
    await settle();
    fixture.detectChanges();
  }

  describe('states', () => {
    it('shows a loading message until the portfolio arrives', async () => {
      const fixture = TestBed.createComponent(PortfolioPage);
      fixture.componentRef.setInput('id', 'p1');
      await settle();
      expect(text(fixture.nativeElement)).toContain('Loading the portfolio…');
      expectRequest('GET', '/api/portfolios/p1').flush(portfolioDetail());
      expectRequest('GET', '/api/portfolios/p1/history?range=1Y').flush(history());
      expectRequest('GET', '/api/portfolios/p1/transactions').flush([]);
      expectRequest('GET', '/api/portfolios/p1/suggestions').flush([]);
    });

    it('says the portfolio was not found when the server answers 404', async () => {
      const fixture = TestBed.createComponent(PortfolioPage);
      fixture.componentRef.setInput('id', 'gone');
      await settle();
      flushProblem(expectRequest('GET', '/api/portfolios/gone'), 404, 'Not found');
      expectRequest('GET', '/api/portfolios/gone/history?range=1Y').flush(history());
      expectRequest('GET', '/api/portfolios/gone/transactions').flush([]);
      expectRequest('GET', '/api/portfolios/gone/suggestions').flush([]);
      await settle();
      fixture.detectChanges();
      expect(text(fixture.nativeElement)).toContain('Portfolio not found');
      expect(text(fixture.nativeElement)).not.toContain('did not load');
    });

    it('offers to try again when the server cannot be reached, and reloads everything', async () => {
      const fixture = TestBed.createComponent(PortfolioPage);
      fixture.componentRef.setInput('id', 'p1');
      await settle();
      flushStatus(expectRequest('GET', '/api/portfolios/p1'), 500);
      expectRequest('GET', '/api/portfolios/p1/history?range=1Y').flush(history());
      expectRequest('GET', '/api/portfolios/p1/transactions').flush([]);
      expectRequest('GET', '/api/portfolios/p1/suggestions').flush([]);
      await settle();
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(text(el)).toContain('The portfolio did not load');

      button(el, 'Try again').click();
      await settle();
      expect(list.reload).toHaveBeenCalled();
      expect(market.reload).toHaveBeenCalled();
      await answerRefresh();
      fixture.detectChanges();
      expect(el.querySelector('h1')?.textContent).toContain('Retirement');
    });

    it('replaces a loaded portfolio with the error state when a reload fails', async () => {
      const { fixture, el } = await open();
      market.pricesVersion.set(1);
      await settle();
      flushNetworkError(expectRequest('GET', '/api/portfolios/p1'));
      expectRequest('GET', '/api/portfolios/p1/history?range=1Y').flush(history());
      expectRequest('GET', '/api/portfolios/p1/transactions').flush([]);
      expectRequest('GET', '/api/portfolios/p1/suggestions').flush([]);
      await settle();
      fixture.detectChanges();
      expect(text(el)).toContain('The portfolio did not load');
    });

    it('never shows the previous portfolio while another one loads', async () => {
      const { fixture, el } = await open();
      fixture.componentRef.setInput('id', 'p2');
      await settle();
      fixture.detectChanges();
      expect(text(el)).toContain('Loading the portfolio…');

      await flush('GET', '/api/portfolios/p2', portfolioDetail({ summary: summary({ id: 'p2', name: 'Second' }) }));
      fixture.detectChanges();
      expect(el.querySelector('h1')?.textContent).toContain('Second');
      expect(text(el)).toContain('The chart starts once there are at least two days of history.');
      await flush('GET', '/api/portfolios/p2/history?range=1Y', history());
      await flush('GET', '/api/portfolios/p2/transactions', []);
      await flush('GET', '/api/portfolios/p2/suggestions', []);
    });

    it('keeps the portfolio on screen while a quote refresh reloads it', async () => {
      const { fixture, el } = await open();
      market.pricesVersion.set(1);
      await settle();
      fixture.detectChanges();
      expect(el.querySelector('h1')?.textContent).toContain('Retirement');
      await answerRefresh({ detail: portfolioDetail({ summary: summary({ totalValue: 12_345 }) }) });
      fixture.detectChanges();
      expect(el.querySelector('app-hero-figure .figure')?.getAttribute('aria-label')).toContain('12,345');
    });

    it('puts the portfolio name in the browser tab title', async () => {
      await open({ detail: portfolioDetail({ summary: summary({ name: 'TFSA' }) }) });
      expect(document.title).toBe('TFSA | Money Monkey');
    });
  });

  describe('header', () => {
    it('shows the name, currency, description and country', async () => {
      const { el } = await open({
        detail: portfolioDetail({
          summary: summary({ name: 'TFSA', baseCurrency: 'USD', description: 'Tax-free', country: 'US' }),
        }),
      });
      expect(text(el.querySelector('h1') as Element)).toBe('TFSA USD');
      expect(el.querySelector('.description')?.textContent).toBe('Tax-free');
      expect(el.querySelector('[data-testid="country"]')?.textContent).toBe('United States');
      expect(el.querySelector('[data-testid="kind"]')).toBeNull();
    });

    it('leaves out a missing description and country', async () => {
      const { el } = await open({ detail: portfolioDetail({ summary: summary({ country: null }) }) });
      expect(el.querySelector('.description')).toBeNull();
      expect(el.querySelector('[data-testid="country"]')).toBeNull();
    });

    it('marks a real estate portfolio', async () => {
      const { el } = await open({ detail: portfolioDetail({ summary: summary({ kind: 'RealEstate' }) }) });
      expect(el.querySelector('[data-testid="kind"]')?.textContent).toBe('Real estate');
    });

    it('says who shared a portfolio the person may edit', async () => {
      const { el } = await open({
        detail: portfolioDetail({ summary: summary({ access: 'Edit', ownerEmail: 'grace@example.com' }) }),
      });
      expect(text(el.querySelector('[data-testid="access"]') as Element)).toBe(
        'Shared by grace@example.com. You can record transactions and cash.',
      );
    });

    it('says who shared a portfolio to view', async () => {
      const { el } = await open({
        detail: portfolioDetail({ summary: summary({ access: 'View', ownerEmail: 'grace@example.com' }) }),
      });
      expect(text(el.querySelector('[data-testid="access"]') as Element)).toBe('Shared by grace@example.com, to view.');
    });

    it('lets the owner open the sharing dialog from the "shared with" line', async () => {
      const { el } = await open({ detail: portfolioDetail({ summary: summary({ sharedWith: 1 }) }) });
      const line = el.querySelector('button[data-testid="access"]') as HTMLButtonElement;
      expect(text(line)).toBe('Shared with 1 person');
      line.click();
      expect(dialog.last.component).toBe(ShareDialog);
    });

    it('pluralizes people for several shares', async () => {
      const { el } = await open({ detail: portfolioDetail({ summary: summary({ sharedWith: 3 }) }) });
      expect(text(el.querySelector('[data-testid="access"]') as Element)).toBe('Shared with 3 people');
    });

    it('says nothing about sharing when the portfolio is private', async () => {
      const { el } = await open();
      expect(el.querySelector('[data-testid="access"]')).toBeNull();
    });
  });

  describe('who can change what', () => {
    it('gives the owner cash, add transaction and the options menu', async () => {
      const { el } = await open();
      expect(button(el, 'Cash')).toBeTruthy();
      expect(button(el, 'Add transaction')).toBeTruthy();
      expect(button(el, 'Add property')).toBeUndefined();
      expect(el.querySelector('button[aria-label="Portfolio options"]')).not.toBeNull();
    });

    it('gives an editor cash and transactions but no options menu', async () => {
      const { el } = await open({
        detail: portfolioDetail({ summary: summary({ access: 'Edit', ownerEmail: 'g@example.com' }) }),
      });
      expect(button(el, 'Cash')).toBeTruthy();
      expect(button(el, 'Add transaction')).toBeTruthy();
      expect(el.querySelector('button[aria-label="Portfolio options"]')).toBeNull();
    });

    it('gives a viewer no way to change anything', async () => {
      const { fixture, el } = await open({
        detail: portfolioDetail({ summary: summary({ access: 'View', ownerEmail: 'g@example.com' }) }),
        suggestions: [split()],
      });
      expect(button(el, 'Cash')).toBeUndefined();
      expect(button(el, 'Add transaction')).toBeUndefined();
      expect(el.querySelector('button[aria-label="Portfolio options"]')).toBeNull();
      expect(button(el, 'Dismiss')).toBeUndefined();
      expect(component<HoldingsTable>(fixture, HoldingsTable).readonly()).toBe(true);
      await selectTab(fixture, el, 1);
      expect(component<TransactionsTable>(fixture, TransactionsTable).readonly()).toBe(true);
    });

    it('offers add property beside add transaction on a real estate portfolio', async () => {
      const { el } = await open({ detail: portfolioDetail({ summary: summary({ kind: 'RealEstate' }) }) });
      expect(button(el, 'Add transaction')).toBeTruthy();
      expect(button(el, 'Add property')).toBeTruthy();
    });
  });

  describe('figures', () => {
    it('shows the value, day change, total return and annualized return', async () => {
      const { el } = await open({
        detail: portfolioDetail({
          summary: summary({ totalValue: 20_000, annualizedReturn: 0.08, dayChangeDate: '2026-10-29' }),
        }),
      });
      const facts = text(el.querySelector('dl.facts') as Element);
      expect(facts).toContain('Thu, Oct 29');
      expect(facts).toContain('Total return');
      expect(facts).toContain('Per year, money-weighted');
      expect(facts).toContain('Net deposits');
    });

    it('asks for a deposit when the total return is unknown, and omits an unknown annual return', async () => {
      const { el } = await open({
        detail: portfolioDetail({ summary: summary({ totalReturn: null, annualizedReturn: null }) }),
      });
      const facts = text(el.querySelector('dl.facts') as Element);
      expect(facts).toContain('Record a deposit to track');
      expect(facts).not.toContain('Per year');
    });

    it('hides every gain figure when gains are hidden', async () => {
      auth.hideGains.set(true);
      const { el } = await open();
      const t = text(el);
      expect(t).not.toContain('Total return');
      expect(t).not.toContain('Unrealized gain');
      expect(t).not.toContain('Realized gain');
      expect(t).toContain('Net deposits');
      expect(t).toContain('Book value');
      expect(t).toContain('Fees paid');
    });

    it('shows the book value, gains, income, cash and fees', async () => {
      const { el } = await open({ detail: portfolioDetail({ dividends: 40, interest: 10, fees: 7 }) });
      const stats = text(el.querySelector('dl.stats') as Element);
      expect(stats).toContain('Book value');
      expect(stats).toContain('Unrealized gain');
      expect(stats).toContain('Realized gain');
      expect(stats).toContain('Dividends and interest$50.00');
      expect(stats).toContain('Fees paid$7.00');
    });

    it('marks negative cash', async () => {
      const { el } = await open({ detail: portfolioDetail({ summary: summary({ cashValue: -250 }) }) });
      expect(el.querySelector('dl.stats dd.loss')?.textContent).toContain('250.00');
    });

    it('draws the history and asks for another range', async () => {
      const { fixture, el } = await open();
      expect(fakeEcharts.charts.length).toBeGreaterThan(0);
      const sixMonths = Array.from(el.querySelectorAll('app-value-chart mat-button-toggle button')).find(
        (b) => b.textContent?.trim() === '6M',
      ) as HTMLElement;
      sixMonths.click();
      await settle();
      fixture.detectChanges();
      expect(text(el)).not.toContain('The chart starts once');
      await flush('GET', '/api/portfolios/p1/history?range=6M', history({ range: '6M' }));
    });

    it('labels the day change with the weekday when the session is not today', async () => {
      market.today.set('2026-10-31');
      const { el } = await open({ detail: portfolioDetail({ summary: summary({ dayChangeDate: '2026-10-30' }) }) });
      expect(el.querySelector('dl.facts dt')?.textContent).toBe('Fri, Oct 30');
    });
  });

  describe('things to check', () => {
    it('shows no notices section when there is nothing to check', async () => {
      const { el } = await open();
      expect(el.querySelector('section.notices')).toBeNull();
    });

    it('describes a split and a dividend, and shows warnings', async () => {
      const { el } = await open({
        detail: portfolioDetail({ warnings: ['No price for ABC'] }),
        suggestions: [split({ splitFrom: 1, splitTo: 4 }), suggestion()],
      });
      const notices = Array.from(el.querySelectorAll('section.notices app-notice')).map((n) => text(n));
      expect(notices).toHaveLength(3);
      expect(notices[0]).toContain('XYZ split 4-for-1 on');
      expect(notices[0]).toContain('Until the split is recorded');
      expect(notices[1]).toContain('XYZ went ex-dividend on');
      expect(notices[1]).toContain('$0.50 a share on 10 shares is about $5.00.');
      expect(notices[2]).toBe('No price for ABC');
    });

    it('shows warnings alone', async () => {
      const { el } = await open({ detail: portfolioDetail({ warnings: ['Stale prices'] }) });
      expect(text(el.querySelector('section.notices') as Element)).toBe('Stale prices');
    });

    it('opens the transaction dialog prefilled with the split', async () => {
      const { el } = await open({ suggestions: [split({ splitFrom: 1, splitTo: 3 })] });
      button(el, 'Record split').click();

      expect(dialog.last.component).toBe(TransactionDialog);
      expect(dialog.last.data).toMatchObject({
        portfolioId: 'p1',
        baseCurrency: 'CAD',
        preset: {
          type: 'Split',
          date: '2026-10-15',
          splitFrom: 1,
          splitTo: 3,
          security: { securityId: 's1', symbol: 'XYZ', exchange: null },
        },
      });
    });

    it('defaults a split with unknown ratios to one-for-one', async () => {
      const { el } = await open({ suggestions: [split({ splitFrom: null, splitTo: null })] });
      button(el, 'Record split').click();
      expect(dialog.last.data).toMatchObject({ preset: { splitFrom: 1, splitTo: 1 } });
    });

    it('opens the transaction dialog prefilled with the dividend', async () => {
      const { el } = await open({ suggestions: [suggestion({ amount: 5 })] });
      button(el, 'Record dividend').click();
      expect(dialog.last.data).toMatchObject({
        preset: { type: 'Dividend', amount: 5, currency: 'CAD', date: '2026-10-15' },
      });
    });

    it('leaves the amount open for a dividend of unknown size', async () => {
      const { el } = await open({ suggestions: [suggestion({ amount: null })] });
      button(el, 'Record dividend').click();
      expect((dialog.last.data as { preset: { amount?: number } }).preset.amount).toBeUndefined();
    });

    it('dismisses a suggestion and reloads the list', async () => {
      const { fixture, el } = await open({ suggestions: [split()] });
      button(el, 'Dismiss').click();
      await settle();
      const request = expectRequest('POST', '/api/portfolios/p1/suggestions/dismiss');
      expect(bodyOf(request)).toEqual({ securityId: 's1', date: '2026-10-15', kind: 'Split' });
      request.flush(null);
      await settle();

      await flush('GET', '/api/portfolios/p1/suggestions', []);
      fixture.detectChanges();
      expect(el.querySelector('section.notices')).toBeNull();
    });

    it('keeps the suggestion and shows why dismissing failed', async () => {
      const { el } = await open({ suggestions: [split()] });
      button(el, 'Dismiss').click();
      await settle();
      flushProblem(expectRequest('POST', '/api/portfolios/p1/suggestions/dismiss'), 500, 'Could not save');
      await settle();

      expect(snack.open).toHaveBeenCalledWith('Could not save', 'Close');
      expect(el.querySelectorAll('section.notices app-notice')).toHaveLength(1);
    });
  });

  describe('tabs', () => {
    it('counts holdings and transactions in the tab labels', async () => {
      const { el } = await open({
        detail: portfolioDetail({ holdings: [holding(), holding({ securityId: 's2', symbol: 'ABC' })] }),
        transactions: [transaction(), transaction({ id: 't2' }), transaction({ id: 't3' })],
      });
      const labels = Array.from(el.querySelectorAll('[role="tab"]')).map((t) => text(t));
      expect(labels[0]).toBe('Holdings (2)');
      expect(labels[1]).toBe('Transactions (3)');
      expect(labels[2]).toBe('Income and gains');
    });

    it('calls the third tab Income when gains are hidden', async () => {
      auth.hideGains.set(true);
      const { el } = await open();
      expect(text(el.querySelectorAll('[role="tab"]')[2])).toBe('Income');
    });

    it('treats transactions as none when they cannot be loaded', async () => {
      const fixture = TestBed.createComponent(PortfolioPage);
      fixture.componentRef.setInput('id', 'p1');
      await settle();
      await flush('GET', '/api/portfolios/p1', portfolioDetail());
      await flush('GET', '/api/portfolios/p1/history?range=1Y', history());
      flushNetworkError(expectRequest('GET', '/api/portfolios/p1/transactions'));
      await flush('GET', '/api/portfolios/p1/suggestions', []);
      fixture.detectChanges();
      expect(text(fixture.nativeElement)).toContain('Transactions (0)');
    });

    it('treats suggestions as none when they cannot be loaded', async () => {
      const fixture = TestBed.createComponent(PortfolioPage);
      fixture.componentRef.setInput('id', 'p1');
      await settle();
      await flush('GET', '/api/portfolios/p1', portfolioDetail());
      await flush('GET', '/api/portfolios/p1/history?range=1Y', history());
      await flush('GET', '/api/portfolios/p1/transactions', []);
      flushNetworkError(expectRequest('GET', '/api/portfolios/p1/suggestions'));
      await settle();
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).querySelector('section.notices')).toBeNull();
    });

    it('loads the income report only when the income tab is opened', async () => {
      const { fixture, el } = await open();
      (el.querySelectorAll('[role="tab"]')[2] as HTMLElement).click();
      await settle();
      fixture.detectChanges();
      expect(text(el)).toContain('Loading…');

      await flush('GET', '/api/portfolios/p1/realized', report());
      fixture.detectChanges();
      expect(el.querySelector('app-income-panel')).not.toBeNull();
      expect(text(el.querySelector('app-income-panel') as Element)).toContain('By year');
    });

    it('reloads the income report with the rest when a refresh happens on that tab', async () => {
      const { fixture, el } = await open();
      (el.querySelectorAll('[role="tab"]')[2] as HTMLElement).click();
      await settle();
      await flush('GET', '/api/portfolios/p1/realized', report());

      market.pricesVersion.set(1);
      await settle();
      await answerRefresh({ realized: true });
      fixture.detectChanges();
      expect(el.querySelector('app-income-panel')).not.toBeNull();
    });

    it('opens a holding from the holdings tab', async () => {
      const { fixture } = await open();
      component<HoldingsTable>(fixture, HoldingsTable).open.emit('s1');
      expect(navigate).toHaveBeenCalledWith(
        ['holdings', 's1'],
        expect.objectContaining({ relativeTo: expect.anything() }),
      );
    });
  });

  describe('cash', () => {
    it('opens the cash dialog with the current balances', async () => {
      const { el } = await open({
        detail: portfolioDetail({ cash: [cashBalance(), cashBalance({ currency: 'USD' })] }),
      });
      button(el, 'Cash').click();

      expect(dialog.last.component).toBe(CashDialog);
      expect(dialog.last.data).toMatchObject({ portfolioId: 'p1', baseCurrency: 'CAD', currency: undefined });
      expect((dialog.last.data as { balances: unknown[] }).balances).toHaveLength(2);
    });

    it('opens the cash dialog for one currency from the holdings table', async () => {
      const { fixture } = await open();
      component<HoldingsTable>(fixture, HoldingsTable).editCash.emit('USD');
      expect(dialog.last.data).toMatchObject({ currency: 'USD' });
    });

    it('opens the cash dialog without a currency when the table asks for none', async () => {
      const { fixture } = await open();
      component<HoldingsTable>(fixture, HoldingsTable).editCash.emit(null);
      expect(dialog.last.data).toMatchObject({ currency: undefined });
    });

    it('confirms and reloads once the balance is saved', async () => {
      const { el } = await open();
      button(el, 'Cash').click();
      dialog.closeLast(true);
      await settle();

      expect(snack.open).toHaveBeenCalledWith('Cash balance saved.');
      await answerRefresh();
    });

    it('changes nothing when the cash dialog is dismissed', async () => {
      const { el } = await open();
      button(el, 'Cash').click();
      dialog.closeLast();
      await settle();
      expect(snack.open).not.toHaveBeenCalled();
      expect(list.reload).not.toHaveBeenCalled();
    });
  });

  describe('transactions', () => {
    it("opens the transaction dialog with the portfolio's holdings and cash currencies", async () => {
      const { el } = await open({
        detail: portfolioDetail({ holdings: [holding()], cash: [cashBalance(), cashBalance({ currency: 'USD' })] }),
      });
      button(el, 'Add transaction').click();

      expect(dialog.last.component).toBe(TransactionDialog);
      expect(dialog.last.data).toMatchObject({
        portfolioId: 'p1',
        baseCurrency: 'CAD',
        cashCurrencies: ['CAD', 'USD'],
        preset: undefined,
      });
      expect((dialog.last.data as { holdings: unknown[] }).holdings).toHaveLength(1);
    });

    it('opens the same dialog from the holdings table', async () => {
      const { fixture } = await open();
      component<HoldingsTable>(fixture, HoldingsTable).add.emit();
      expect(dialog.last.component).toBe(TransactionDialog);
    });

    it("confirms with the dialog's message and reloads once a transaction is saved", async () => {
      const { el } = await open();
      button(el, 'Add transaction').click();
      dialog.closeLast({ message: 'Bought 10 XYZ.' });
      await settle();

      expect(snack.open).toHaveBeenCalledWith('Bought 10 XYZ.');
      await answerRefresh();
    });

    it('changes nothing when the transaction dialog is dismissed', async () => {
      const { el } = await open();
      button(el, 'Add transaction').click();
      dialog.closeLast();
      await settle();
      expect(snack.open).not.toHaveBeenCalled();
    });

    it('edits a transaction from the transactions tab', async () => {
      const tx = transaction({ id: 't9' });
      const { fixture, el } = await open({ transactions: [tx] });
      await selectTab(fixture, el, 1);
      component<TransactionsTable>(fixture, TransactionsTable).edit.emit(tx);
      expect(dialog.last.data).toMatchObject({ portfolioId: 'p1', transaction: tx });
    });

    it('deletes a transaction after confirmation and reloads', async () => {
      const tx = transaction({ id: 't9' });
      const { fixture, el } = await open({ transactions: [tx] });
      await selectTab(fixture, el, 1);
      component<TransactionsTable>(fixture, TransactionsTable).remove.emit(tx);
      dialog.closeLast(true);
      await settle();

      expectRequest('DELETE', '/api/portfolios/p1/transactions/t9').flush(null);
      await settle();
      expect(snack.open).toHaveBeenCalledWith('Transaction deleted.');
      await answerRefresh();
    });

    it('keeps the transaction when the delete is cancelled', async () => {
      const tx = transaction();
      const { fixture, el } = await open({ transactions: [tx] });
      await selectTab(fixture, el, 1);
      component<TransactionsTable>(fixture, TransactionsTable).remove.emit(tx);
      dialog.closeLast();
      await settle();
      verifyNoOutstandingRequests();
    });

    it('keeps the transaction and says why when the server refuses the delete', async () => {
      const tx = transaction();
      const { fixture, el } = await open({ transactions: [tx] });
      await selectTab(fixture, el, 1);
      component<TransactionsTable>(fixture, TransactionsTable).remove.emit(tx);
      dialog.closeLast(true);
      await settle();
      flushProblem(expectRequest('DELETE', '/api/portfolios/p1/transactions/t1'), 409, 'It is referenced');
      await settle();
      expect(snack.open).toHaveBeenCalledWith('It is referenced', 'Close', { duration: 12_000 });
    });
  });

  describe('properties', () => {
    it('adds a property through the property dialog', async () => {
      const { el } = await open({
        detail: portfolioDetail({ summary: summary({ kind: 'RealEstate', baseCurrency: 'USD' }) }),
      });
      button(el, 'Add property').click();

      expect(dialog.last.component).toBe(PropertyDialog);
      expect(dialog.last.data).toEqual({ portfolioId: 'p1', baseCurrency: 'USD' });
      dialog.closeLast(true);
      await settle();
      expect(snack.open).toHaveBeenCalledWith('Property added.');
      await answerRefresh();
    });

    it('opens the property dialog from the holdings table', async () => {
      const { fixture } = await open({ detail: portfolioDetail({ summary: summary({ kind: 'RealEstate' }) }) });
      component<HoldingsTable>(fixture, HoldingsTable).addProperty.emit();
      expect(dialog.last.component).toBe(PropertyDialog);
    });

    it('does nothing when the property dialog is dismissed', async () => {
      const { el } = await open({ detail: portfolioDetail({ summary: summary({ kind: 'RealEstate' }) }) });
      button(el, 'Add property').click();
      dialog.closeLast();
      await settle();
      expect(snack.open).not.toHaveBeenCalled();
    });
  });

  describe('options menu', () => {
    async function chooseOption(el: HTMLElement, fixture: { detectChanges(): void }, label: string) {
      (el.querySelector('button[aria-label="Portfolio options"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      await settle();
      const item = Array.from(document.querySelectorAll('.mat-mdc-menu-panel button')).find((b) =>
        b.textContent?.includes(label),
      ) as HTMLElement;
      item.click();
    }

    it('shares the portfolio and reloads when sharing changed', async () => {
      const { fixture, el } = await open({ detail: portfolioDetail({ summary: summary({ name: 'TFSA' }) }) });
      await chooseOption(el, fixture, 'Share');

      expect(dialog.last.component).toBe(ShareDialog);
      expect(dialog.last.data).toEqual({ portfolioId: 'p1', name: 'TFSA' });
      dialog.closeLast(true);
      await settle();
      await answerRefresh();
    });

    it('does not reload when the sharing dialog is dismissed', async () => {
      const { fixture, el } = await open();
      await chooseOption(el, fixture, 'Share');
      dialog.closeLast();
      await settle();
      expect(list.reload).not.toHaveBeenCalled();
    });

    it('edits the portfolio and confirms once saved', async () => {
      const { fixture, el } = await open();
      await chooseOption(el, fixture, 'Edit portfolio');

      expect(dialog.last.component).toBe(PortfolioDialog);
      expect(dialog.last.data).toMatchObject({ portfolio: expect.objectContaining({ id: 'p1' }) });
      dialog.closeLast(summary());
      await settle();
      expect(snack.open).toHaveBeenCalledWith('Portfolio saved.');
      await answerRefresh();
    });

    it('does not reload when the edit dialog is dismissed', async () => {
      const { fixture, el } = await open();
      await chooseOption(el, fixture, 'Edit portfolio');
      dialog.closeLast();
      await settle();
      expect(snack.open).not.toHaveBeenCalled();
    });

    it('asks before deleting, counting the transactions', async () => {
      const { fixture, el } = await open({
        detail: portfolioDetail({ summary: summary({ name: 'TFSA', transactionsCount: 5 }) }),
      });
      await chooseOption(el, fixture, 'Delete portfolio');
      expect(dialog.last.data).toMatchObject({
        title: 'Delete TFSA?',
        message: 'This removes the portfolio and its 5 transactions. It cannot be undone.',
        destructive: true,
      });
    });

    it('uses the singular for one transaction', async () => {
      const { fixture, el } = await open({ detail: portfolioDetail({ summary: summary({ transactionsCount: 1 }) }) });
      await chooseOption(el, fixture, 'Delete portfolio');
      expect((dialog.last.data as { message: string }).message).toContain('its 1 transaction.');
    });

    it('deletes the portfolio, refreshes the list and returns to the overview', async () => {
      const { fixture, el } = await open();
      await chooseOption(el, fixture, 'Delete portfolio');
      dialog.closeLast(true);
      await settle();

      expectRequest('DELETE', '/api/portfolios/p1').flush(null);
      await settle();
      expect(list.reload).toHaveBeenCalled();
      expect(snack.open).toHaveBeenCalledWith('Portfolio deleted.');
      expect(navigate).toHaveBeenCalledWith(['/']);
    });

    it('keeps the portfolio when the delete is cancelled', async () => {
      const { fixture, el } = await open();
      await chooseOption(el, fixture, 'Delete portfolio');
      dialog.closeLast();
      await settle();
      verifyNoOutstandingRequests();
      expect(navigate).not.toHaveBeenCalled();
    });

    it('shows why the portfolio could not be deleted and stays on the page', async () => {
      const { fixture, el } = await open();
      await chooseOption(el, fixture, 'Delete portfolio');
      dialog.closeLast(true);
      await settle();
      flushProblem(expectRequest('DELETE', '/api/portfolios/p1'), 403, 'Only the owner can delete it');
      await settle();

      expect(snack.open).toHaveBeenCalledWith('Only the owner can delete it', 'Close');
      expect(navigate).not.toHaveBeenCalled();
    });
  });
});
