import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Title } from '@angular/platform-browser';
import {
  FakeAuth,
  FakeDialog,
  FakePortfolioList,
  expectRequest,
  fakeEcharts,
  flush,
  flushNetworkError,
  flushProblem,
  flushStatus,
  holding,
  holdingDetail,
  portfolioSummary,
  provideAppTesting,
  provideFakeAuth,
  provideFakeDialog,
  provideFakePortfolioList,
  security,
  settle,
  transaction,
  verifyNoOutstandingRequests,
} from '../../../testing';
import { formatMoney, formatPrice, formatQuantity } from '../../core/format';
import { HoldingDetail } from '../../core/models';
import { ManualSecurityDialog } from '../../organisms/manual-security-dialog/manual-security-dialog';
import { TransactionDialog } from '../../organisms/transaction-dialog/transaction-dialog';
import { ConfirmDialog } from '../../molecules/confirm-dialog/confirm-dialog';
import { HoldingPage } from './holding.page';

vi.mock('echarts/core', async () => (await import('../../../testing/echarts')).echartsCoreModule());

const DETAIL_URL = '/api/portfolios/p1/holdings/s1';
const PRICES_URL = '/api/securities/s1/prices?range=1Y';
const closes = [
  { date: '2026-09-01', close: 100 },
  { date: '2026-09-02', close: 105 },
];

describe('HoldingPage', () => {
  beforeEach(() => fakeEcharts.reset());

  async function render(
    options: { answer?: HoldingDetail | 'pending'; hideGains?: boolean; list?: FakePortfolioList } = {},
  ) {
    const dialog = new FakeDialog();
    const snack = { open: vi.fn() };
    const auth = new FakeAuth();
    auth.hideGains.set(options.hideGains ?? false);
    const list = options.list ?? new FakePortfolioList();
    TestBed.configureTestingModule({
      providers: [
        provideAppTesting(),
        provideFakeAuth(auth),
        provideFakeDialog(dialog),
        provideFakePortfolioList(list),
        { provide: MatSnackBar, useValue: snack },
      ],
    });
    const fixture = TestBed.createComponent(HoldingPage);
    fixture.componentRef.setInput('id', 'p1');
    fixture.componentRef.setInput('securityId', 's1');
    fixture.detectChanges();
    await settle();
    const el = fixture.nativeElement as HTMLElement;
    const answer = options.answer ?? holdingDetail();
    if (answer !== 'pending') {
      await flush('GET', DETAIL_URL, answer);
      await flush('GET', PRICES_URL, closes);
    }
    fixture.detectChanges();
    const button = (text: string) =>
      Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === text)!;
    const stat = (label: string) =>
      Array.from(el.querySelectorAll('dl.stats > div'))
        .find((d) => d.querySelector('dt')?.textContent === label)
        ?.querySelector('dd')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim();
    const rowMenu = (item: 'Edit' | 'Delete') => {
      el.querySelector<HTMLButtonElement>('app-transactions-table td.actions button')!.click();
      Array.from(document.querySelectorAll<HTMLButtonElement>('button[mat-menu-item]'))
        .find((b) => b.textContent?.trim() === item)!
        .click();
    };
    return { fixture, el, dialog, snack, auth, list, button, stat, rowMenu };
  }

  describe('loading and failing', () => {
    it('shows a loading message until the holding arrives', async () => {
      const { el } = await render({ answer: 'pending' });

      expect(el.querySelector('app-busy')?.textContent).toContain('Loading the holding…');
      expect(el.querySelector('h1')).toBeNull();
    });

    it('says the holding is not in the portfolio when the API answers 404', async () => {
      const { fixture, el } = await render({ answer: 'pending' });

      flushProblem(expectRequest('GET', DETAIL_URL), 404, 'Not found');
      flushStatus(expectRequest('GET', PRICES_URL), 404);
      await settle();
      fixture.detectChanges();

      expect(el.querySelector('app-state-message')?.textContent).toContain('This holding is not in the portfolio');
      expect(el.querySelector('app-busy')).toBeNull();
      expect(el.querySelector('button')).toBeNull();
    });

    it('offers to try again when the server cannot be reached, and asks for everything again', async () => {
      const { fixture, el, list, button } = await render({ answer: 'pending' });
      flushNetworkError(expectRequest('GET', DETAIL_URL));
      flushNetworkError(expectRequest('GET', PRICES_URL));
      await settle();
      fixture.detectChanges();
      expect(el.querySelector('app-state-message')?.textContent).toContain('The holding did not load');

      button('Try again').click();
      await settle();

      await flush('GET', DETAIL_URL, holdingDetail());
      await flush('GET', PRICES_URL, closes);
      fixture.detectChanges();
      expect(el.querySelector('h1')?.textContent).toContain('XYZ');
      expect(list.reload).toHaveBeenCalledTimes(1);
    });

    it('keeps the holding on screen when a later refresh fails', async () => {
      const { fixture, el, dialog, button } = await render();
      void button('Add transaction').click();
      dialog.closeLast({ message: 'Saved.' });
      await settle();

      flushProblem(expectRequest('GET', DETAIL_URL), 500, 'Boom');
      await flush('GET', PRICES_URL, closes);
      fixture.detectChanges();

      expect(el.querySelector('h1')?.textContent).toContain('XYZ');
      expect(el.querySelector('app-state-message')).toBeNull();
    });
  });

  describe('the holding', () => {
    it('shows the symbol, name, exchange, currency, last price and a link to the quote page', async () => {
      const { el, fixture } = await render({
        answer: holdingDetail({
          security: security({ symbol: 'SHOP.TO', name: 'Shopify Inc.', exchange: 'TSX', lastPrice: 123.45 }),
        }),
      });

      expect(el.querySelector('h1')?.textContent).toContain('SHOP.TO');
      expect(el.querySelector('.name')?.textContent).toBe('Shopify Inc.');
      expect(el.querySelector('.meta')?.textContent).toContain('TSX');
      expect(el.querySelector('.currency-code')?.textContent).toBe('CAD');
      expect(el.querySelector('.price')?.textContent).toBe(formatPrice(123.45, 'CAD'));
      expect(el.querySelector('.meta a')?.getAttribute('href')).toContain('/quotes?symbol=SHOP.TO');
      expect(el.querySelector('section.quote .muted')?.textContent).toContain('Close on');
      expect(TestBed.inject(Title).getTitle()).toBe('SHOP.TO | Money Monkey');
      expect(fixture).toBeTruthy();
    });

    it('links back to the portfolio by name', async () => {
      const list = new FakePortfolioList();
      list.resource.value.set([portfolioSummary({ id: 'p1', name: 'Retirement' })]);

      const { el } = await render({ list });

      expect(el.querySelector('a.back')?.textContent?.trim()).toBe('Retirement');
      expect(el.querySelector('a.back')?.getAttribute('href')).toBe('/portfolios/p1');
    });

    it('calls the portfolio "Portfolio" until the list has loaded or when it is not in the list', async () => {
      const unloaded = new FakePortfolioList();
      unloaded.resource.hasValue.set(false);
      expect((await render({ list: unloaded })).el.querySelector('a.back')?.textContent?.trim()).toBe('Portfolio');
      TestBed.resetTestingModule();

      const other = new FakePortfolioList();
      other.resource.value.set([portfolioSummary({ id: 'other', name: 'Other' })]);
      expect((await render({ list: other })).el.querySelector('a.back')?.textContent?.trim()).toBe('Portfolio');
    });

    it('leaves out the exchange when the security has none', async () => {
      const { el } = await render({ answer: holdingDetail({ security: security({ exchange: null }) }) });

      expect(el.querySelector('.meta span:not(.currency-code)')).toBeNull();
    });

    it('shows the position figures', async () => {
      const { stat } = await render({
        answer: holdingDetail({
          baseCurrency: 'CAD',
          dividends: 40,
          realizedGain: 25,
          holding: holding({
            quantity: 12,
            averageCost: 50,
            costBasis: 600,
            marketValue: 700,
            weight: 0.255,
            currency: 'CAD',
          }),
        }),
      });

      expect(stat('Shares')).toBe(formatQuantity(12));
      expect(stat('Average cost')).toBe(formatPrice(50, 'CAD'));
      expect(stat('Book value')).toBe(formatMoney(600, 'CAD'));
      expect(stat('Market value')).toBe(formatMoney(700, 'CAD'));
      expect(stat('Share of portfolio')).toBe('25.5%');
      expect(stat('Dividends')).toBe(formatMoney(40, 'CAD'));
      expect(stat('Unrealized gain')).toBeTruthy();
      expect(stat('Realized gain')).toContain(formatMoney(25, 'CAD'));
    });

    it('says no shares are held after everything was sold', async () => {
      const { stat } = await render({ answer: holdingDetail({ holding: null }) });

      expect(stat('Shares')).toBe('None held now');
      expect(stat('Average cost')).toBeUndefined();
    });

    it('hides every gain figure when gains are hidden', async () => {
      const { el, stat } = await render({ hideGains: true });

      expect(stat('Unrealized gain')).toBeUndefined();
      expect(stat('Realized gain')).toBeUndefined();
      expect(el.querySelector('section.quote app-change')).toBeNull();
      expect(stat('Dividends')).toBeDefined();
    });

    it('shows the day change beside the price by default', async () => {
      const { el } = await render();

      expect(el.querySelector('section.quote app-change')).not.toBeNull();
    });

    it('lists the transactions', async () => {
      const { el } = await render({
        answer: holdingDetail({ transactions: [transaction({ id: 'a' }), transaction({ id: 'b' })] }),
      });

      expect(el.querySelectorAll('app-transactions-table tbody tr')).toHaveLength(2);
    });
  });

  describe('price history', () => {
    it('draws the closes on the price chart', async () => {
      await render();

      expect(fakeEcharts.charts).toHaveLength(1);
    });

    it('asks for another range and keeps the old line while it loads', async () => {
      const { fixture, el } = await render();

      el.querySelectorAll<HTMLButtonElement>('app-price-chart mat-button-toggle button')[1].click();
      await settle();
      fixture.detectChanges();

      const request = expectRequest('GET', '/api/securities/s1/prices?range=3M');
      expect(el.querySelector('app-price-chart app-echart')).not.toBeNull();
      request.flush([
        { date: '2026-09-05', close: 1 },
        { date: '2026-09-06', close: 2 },
      ]);
      await settle();
      fixture.detectChanges();
      expect(el.querySelector('app-price-chart app-echart')).not.toBeNull();
    });

    it('says there is no price history when the prices cannot be fetched', async () => {
      const { fixture, el } = await render({ answer: 'pending' });
      await flush('GET', DETAIL_URL, holdingDetail());
      flushProblem(expectRequest('GET', PRICES_URL), 500, 'Prices are down');
      await settle();
      fixture.detectChanges();

      expect(el.querySelector('h1')?.textContent).toContain('XYZ');
      expect(el.querySelector('app-price-chart .empty')?.textContent).toBe('No price history yet.');
    });

    it('says there is no price history when the server has none', async () => {
      const { fixture, el } = await render({ answer: 'pending' });
      await flush('GET', DETAIL_URL, holdingDetail());
      await flush('GET', PRICES_URL, []);
      fixture.detectChanges();

      expect(el.querySelector('app-price-chart .empty')?.textContent).toBe('No price history yet.');
    });
  });

  describe('manually priced securities', () => {
    const manual = holdingDetail({ security: security({ priceSource: 'Manual' }) });
    const property = holdingDetail({ security: security({ priceSource: 'Manual', assetType: 'RealEstate' }) });

    it('offers no price update for a listed security', async () => {
      const { el } = await render();

      expect(el.textContent).not.toContain('Update price');
      expect(el.textContent).not.toContain('Priced manually');
    });

    it('offers to update the price and says it is priced manually', async () => {
      const { el, button } = await render({ answer: manual });

      expect(button('Update price')).toBeDefined();
      expect(el.querySelector('.meta')?.textContent).toContain('Priced manually');
    });

    it('calls it a value for a property', async () => {
      const { el, button } = await render({ answer: property });

      expect(button('Update value')).toBeDefined();
      expect(el.querySelector('section.quote .muted')?.textContent).toContain('Valued on');
    });

    it('opens the price dialog with the security', async () => {
      const { dialog, button } = await render({ answer: manual });

      button('Update price').click();

      expect(dialog.last.component).toBe(ManualSecurityDialog);
      expect(dialog.last.data).toEqual({ security: manual.security });
      expect(dialog.last.config?.maxWidth).toBe('96vw');
    });

    it('confirms and reloads everything after a saved price', async () => {
      const { dialog, snack, list, button } = await render({ answer: manual });

      button('Update price').click();
      dialog.closeLast(true);
      await settle();

      expect(snack.open).toHaveBeenCalledWith('Price saved.');
      expect(list.reload).toHaveBeenCalledTimes(1);
      await flush('GET', DETAIL_URL, manual);
      await flush('GET', PRICES_URL, closes);
    });

    it('confirms "Value saved." for a property', async () => {
      const { dialog, snack, button } = await render({ answer: property });

      button('Update value').click();
      dialog.closeLast(true);
      await settle();

      expect(snack.open).toHaveBeenCalledWith('Value saved.');
      await flush('GET', DETAIL_URL, property);
      await flush('GET', PRICES_URL, closes);
    });

    it('does nothing when the dialog is dismissed', async () => {
      const { dialog, snack, list, button } = await render({ answer: manual });

      button('Update price').click();
      dialog.closeLast(undefined);
      await settle();

      expect(snack.open).not.toHaveBeenCalled();
      expect(list.reload).not.toHaveBeenCalled();
      verifyNoOutstandingRequests();
    });
  });

  describe('adding a transaction', () => {
    it('opens the transaction dialog preset to a buy of this security', async () => {
      const detail = holdingDetail({
        baseCurrency: 'USD',
        security: security({ id: 's1', symbol: 'ABC', name: 'ABC Ltd', currency: 'CAD', exchange: 'TSX' }),
      });
      const { dialog, button } = await render({ answer: detail });

      button('Add transaction').click();

      expect(dialog.last.component).toBe(TransactionDialog);
      expect(dialog.last.data).toEqual({
        portfolioId: 'p1',
        baseCurrency: 'USD',
        holdings: [detail.holding],
        cashCurrencies: [],
        preset: {
          type: 'Buy',
          security: { securityId: 's1', symbol: 'ABC', name: 'ABC Ltd', currency: 'CAD', exchange: 'TSX' },
        },
      });
    });

    it('passes no holdings when none are held', async () => {
      const { dialog, button } = await render({ answer: holdingDetail({ holding: null }) });

      button('Add transaction').click();

      expect((dialog.last.data as { holdings: unknown[] }).holdings).toEqual([]);
    });

    it('confirms and refreshes the page after a saved transaction', async () => {
      const { dialog, snack, list, button } = await render();

      button('Add transaction').click();
      dialog.closeLast({ message: 'Bought 5 XYZ.' });
      await settle();

      expect(snack.open).toHaveBeenCalledWith('Bought 5 XYZ.');
      expect(list.reload).toHaveBeenCalledTimes(1);
      await flush('GET', DETAIL_URL, holdingDetail());
      await flush('GET', PRICES_URL, closes);
    });

    it('changes nothing when the dialog is dismissed', async () => {
      const { dialog, snack, list, button } = await render();

      button('Add transaction').click();
      dialog.closeLast(undefined);
      await settle();

      expect(snack.open).not.toHaveBeenCalled();
      expect(list.reload).not.toHaveBeenCalled();
      verifyNoOutstandingRequests();
    });
  });

  describe('editing a transaction', () => {
    it('opens the dialog on the chosen transaction', async () => {
      const t = transaction({ id: 'tx9' });
      const detail = holdingDetail({ transactions: [t] });
      const { dialog, rowMenu } = await render({ answer: detail });

      rowMenu('Edit');

      expect(dialog.last.component).toBe(TransactionDialog);
      expect(dialog.last.data).toEqual({
        portfolioId: 'p1',
        baseCurrency: 'CAD',
        holdings: [detail.holding],
        cashCurrencies: [],
        transaction: t,
      });
    });

    it('passes no holdings when none are held', async () => {
      const { dialog, rowMenu } = await render({ answer: holdingDetail({ holding: null }) });

      rowMenu('Edit');

      expect((dialog.last.data as { holdings: unknown[] }).holdings).toEqual([]);
    });

    it('refreshes after a saved change', async () => {
      const { dialog, snack, list, rowMenu } = await render();

      rowMenu('Edit');
      dialog.closeLast({ message: 'Updated.' });
      await settle();

      expect(snack.open).toHaveBeenCalledWith('Updated.');
      expect(list.reload).toHaveBeenCalledTimes(1);
      await flush('GET', DETAIL_URL, holdingDetail());
      await flush('GET', PRICES_URL, closes);
    });

    it('changes nothing when the dialog is dismissed', async () => {
      const { dialog, list, rowMenu } = await render();

      rowMenu('Edit');
      dialog.closeLast(undefined);
      await settle();

      expect(list.reload).not.toHaveBeenCalled();
      verifyNoOutstandingRequests();
    });
  });

  describe('deleting a transaction', () => {
    it('asks first, naming the transaction', async () => {
      const { dialog, rowMenu } = await render({
        answer: holdingDetail({ transactions: [transaction({ type: 'Sell', symbol: 'XYZ', date: '2026-10-01' })] }),
      });

      rowMenu('Delete');

      expect(dialog.last.component).toBe(ConfirmDialog);
      const data = dialog.last.data as { title: string; message: string; destructive: boolean };
      expect(data.title).toBe('Delete transaction?');
      expect(data.message).toContain('sell of XYZ');
      expect(data.destructive).toBe(true);
    });

    it('deletes, confirms and refreshes when the person agrees', async () => {
      const { dialog, snack, list, rowMenu } = await render({
        answer: holdingDetail({ transactions: [transaction({ id: 'tx7' })] }),
      });

      rowMenu('Delete');
      dialog.closeLast(true);
      await settle();
      const request = expectRequest('DELETE', '/api/portfolios/p1/transactions/tx7');
      request.flush(null);
      await settle();

      expect(snack.open).toHaveBeenCalledWith('Transaction deleted.');
      expect(list.reload).toHaveBeenCalledTimes(1);
      await flush('GET', DETAIL_URL, holdingDetail());
      await flush('GET', PRICES_URL, closes);
    });

    it('sends nothing when the person cancels', async () => {
      const { dialog, snack, list, rowMenu } = await render();

      rowMenu('Delete');
      dialog.closeLast(undefined);
      await settle();

      verifyNoOutstandingRequests();
      expect(snack.open).not.toHaveBeenCalled();
      expect(list.reload).not.toHaveBeenCalled();
    });

    it('shows the reason and does not refresh when the server refuses', async () => {
      const { dialog, snack, list, rowMenu } = await render();

      rowMenu('Delete');
      dialog.closeLast(true);
      await settle();
      flushProblem(expectRequest('DELETE', '/api/portfolios/p1/transactions/t1'), 409, 'Selling more than you own.');
      await settle();

      expect(snack.open).toHaveBeenCalledWith('Selling more than you own.', 'Close', { duration: 12_000 });
      expect(list.reload).not.toHaveBeenCalled();
      verifyNoOutstandingRequests();
    });
  });
});
