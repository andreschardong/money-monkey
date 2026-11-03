import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { FakeAuth, cashBalance, holding, portfolioSummary, provideAppTesting, provideFakeAuth } from '../../../testing';
import { formatMoney, formatPrice, formatQuantity } from '../../core/format';
import { CashBalance, Currency, Holding, PortfolioSummary } from '../../core/models';
import { HoldingsTable } from './holdings-table';

@Component({ template: '' })
class Stub {}

@Component({
  imports: [HoldingsTable],
  template: `<app-holdings-table
    [holdings]="holdings()"
    [cash]="cash()"
    [summary]="summary()"
    [unrealized]="unrealized()"
    [readonly]="readonly()"
    (open)="events.push(['open', $event])"
    (add)="events.push(['add', null])"
    (addProperty)="events.push(['addProperty', null])"
    (editCash)="events.push(['editCash', $event])"
  />`,
})
class Host {
  readonly holdings = signal<Holding[]>([]);
  readonly cash = signal<CashBalance[]>([]);
  readonly summary = signal<PortfolioSummary>(portfolioSummary());
  readonly unrealized = signal(0);
  readonly readonly = signal(false);
  readonly events: [string, string | Currency | null][] = [];
}

const rows: Holding[] = [
  holding({
    securityId: 'a',
    symbol: 'AAA',
    name: 'Alpha Inc',
    quantity: 30,
    averageCost: 10,
    price: 50,
    marketValue: 300,
    marketValueLocal: 300,
    unrealizedGain: -50,
    unrealizedGainPercent: -0.14,
    weight: 0.1,
  }),
  holding({
    securityId: 'b',
    symbol: 'BBB',
    name: 'Beta Corp',
    quantity: 10,
    averageCost: 30,
    price: 10,
    marketValue: 900,
    marketValueLocal: 900,
    unrealizedGain: 20,
    unrealizedGainPercent: 0.02,
    weight: 0.5,
  }),
  holding({
    securityId: 'c',
    symbol: 'CCC',
    name: 'Gamma Ltd',
    quantity: 20,
    averageCost: 20,
    price: 30,
    marketValue: 600,
    marketValueLocal: 600,
    unrealizedGain: 100,
    unrealizedGainPercent: 0.2,
    weight: 0.4,
  }),
];

describe('HoldingsTable', () => {
  function render(setup: (host: Host) => void = () => undefined, options: { hideGains?: boolean } = {}) {
    const auth = new FakeAuth();
    auth.hideGains.set(options.hideGains ?? false);
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [provideAppTesting({ routes: [{ path: 'holdings/:id', component: Stub }] }), provideFakeAuth(auth)],
    });
    const fixture = TestBed.createComponent(Host);
    setup(fixture.componentInstance);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      el,
      host: fixture.componentInstance,
      auth,
      tickers: () => Array.from(el.querySelectorAll('tbody tr:not(.cash) .ticker')).map((a) => a.textContent),
      headers: () => Array.from(el.querySelectorAll('thead th')).map((th) => th.textContent?.trim()),
      header: (name: string) =>
        Array.from(el.querySelectorAll<HTMLElement>('thead th')).find((th) => th.textContent?.trim() === name)!,
      button: (text: string) =>
        Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === text)!,
    };
  }

  describe('empty states', () => {
    it('invites a first transaction in an investment portfolio and emits add', () => {
      const { el, button, host } = render();

      expect(el.querySelector('.empty p')?.textContent).toContain('No holdings yet');
      button('Add a transaction').click();
      expect(host.events).toEqual([['add', null]]);
      expect(el.querySelector('table')).toBeNull();
    });

    it('invites a first property in a real estate portfolio and emits addProperty', () => {
      const { el, button, host } = render((h) => h.summary.set(portfolioSummary({ kind: 'RealEstate' })));

      expect(el.querySelector('.empty p')?.textContent).toContain('No properties yet');
      expect(el.textContent).not.toContain('Add a transaction');
      button('Add a property').click();
      expect(host.events).toEqual([['addProperty', null]]);
    });

    it('lets the owner set the cash balance from the empty state', () => {
      const { button, host } = render();

      button('Set cash balance').click();

      expect(host.events).toEqual([['editCash', null]]);
    });

    it('offers no actions to someone who can only view', () => {
      const { el } = render((h) => h.readonly.set(true));

      expect(el.querySelector('.empty p')).not.toBeNull();
      expect(el.querySelectorAll('button')).toHaveLength(0);
    });

    it('shows the table, not the empty state, when there is cash but no holdings', () => {
      const { el } = render((h) => h.cash.set([cashBalance()]));

      expect(el.querySelector('.empty')).toBeNull();
      expect(el.querySelector('tr.cash')).not.toBeNull();
    });
  });

  describe('holdings', () => {
    it('lists each holding with its symbol linking to its page, name, and figures', () => {
      const { el } = render((h) => h.holdings.set([rows[0]]));

      const row = el.querySelector('tbody tr:not(.cash)')!;
      const link = row.querySelector('a.ticker')!;
      expect(link.textContent).toBe('AAA');
      expect(link.getAttribute('href')).toContain('holdings/a');
      expect(row.querySelector('.name')?.textContent).toBe('Alpha Inc');
      const cells = Array.from(row.querySelectorAll('td')).map((td) => td.textContent?.replace(/\s+/g, ' ').trim());
      expect(cells[1]).toBe(formatQuantity(30));
      expect(cells[2]).toBe(formatPrice(10, 'CAD'));
      expect(cells[3]).toContain(formatPrice(50, 'CAD'));
      expect(cells[4]).toBe(formatMoney(300, 'CAD'));
    });

    it('shows a compact "shares at price" line for phones', () => {
      const { el } = render((h) => h.holdings.set([rows[0]]));

      expect(el.querySelector('.compact')?.textContent?.trim()).toBe(
        `${formatQuantity(30)} shares at ${formatPrice(50, 'CAD')}`,
      );
    });

    it('falls back to the average cost in the compact line when there is no price', () => {
      const { el } = render((h) => h.holdings.set([holding({ price: null, priceMissing: true, averageCost: 12 })]));

      expect(el.querySelector('.compact')?.textContent).toContain(formatPrice(12, 'CAD'));
    });

    it('calls a single real estate unit a property', () => {
      const { el } = render((h) => h.holdings.set([holding({ assetType: 'RealEstate', quantity: 1 })]));

      expect(el.querySelector('.compact')?.textContent).toBe('Property');
    });

    it('treats real estate held in several units like any other holding', () => {
      const { el } = render((h) => h.holdings.set([holding({ assetType: 'RealEstate', quantity: 2 })]));

      expect(el.querySelector('.compact')?.textContent).toContain('shares at');
    });

    it('shows a dash with an explanation instead of a price that is missing', () => {
      const { el } = render((h) => h.holdings.set([holding({ price: null, priceMissing: true })]));

      expect(el.querySelector('tbody td:nth-child(4) .muted')?.textContent).toBe('—');
    });

    it('shows the value in the foreign currency under the base-currency value', () => {
      const { el } = render((h) =>
        h.holdings.set([holding({ currency: 'USD', marketValue: 1_350, marketValueLocal: 1_000 })]),
      );

      expect(el.querySelector('.local')?.textContent).toBe(formatMoney(1_000, 'USD'));
    });

    it('shows no foreign line for a holding in the base currency', () => {
      const { el } = render((h) => h.holdings.set([rows[0]]));

      expect(el.querySelector('.local')).toBeNull();
    });

    it('shows the weight and the total row', () => {
      const { el } = render((h) => {
        h.holdings.set([rows[0]]);
        h.summary.set(portfolioSummary({ totalValue: 4_321 }));
        h.unrealized.set(250);
      });

      expect(el.querySelector('tbody td:last-child')?.textContent).toBe('10.0%');
      expect(el.querySelector('tfoot td:first-child')?.textContent).toBe('Total');
      expect(el.querySelector('tfoot .num')?.textContent).toBe(formatMoney(4_321, 'CAD'));
      expect(el.querySelector('tfoot app-change')?.textContent).toContain(formatMoney(250, 'CAD'));
    });

    it('keeps the secondary columns in the page for CSS to hide on phones', () => {
      const { el } = render((h) => h.holdings.set([rows[0]]));

      expect(el.querySelectorAll('th.hide-s')).toHaveLength(2);
      expect(el.querySelectorAll('th.hide-m')).toHaveLength(2);
    });
  });

  describe('gains', () => {
    it('shows the day change, gain columns and total gain by default', () => {
      const { headers, el } = render((h) => h.holdings.set([rows[0]]));

      expect(headers()).toContain('Unrealized gain');
      expect(el.querySelectorAll('app-change').length).toBeGreaterThanOrEqual(4);
    });

    it('hides every gain figure when gains are hidden', () => {
      const { headers, el } = render(
        (h) => {
          h.holdings.set([rows[0]]);
          h.cash.set([cashBalance()]);
        },
        { hideGains: true },
      );

      expect(headers()).not.toContain('Unrealized gain');
      expect(el.querySelectorAll('app-change')).toHaveLength(0);
      expect(el.querySelectorAll('tbody tr:not(.cash) td')).toHaveLength(6);
      expect(el.querySelectorAll('tr.cash td')).toHaveLength(6);
      expect(el.querySelectorAll('tfoot td')).toHaveLength(6);
    });

    it('spans the whole row for the "no cash" line, with or without the gain column', () => {
      const shown = render((h) => h.holdings.set([rows[0]]));
      expect(shown.el.querySelector('tr.cash td')?.getAttribute('colspan')).toBe('7');
      TestBed.resetTestingModule();

      const hidden = render((h) => h.holdings.set([rows[0]]), { hideGains: true });
      expect(hidden.el.querySelector('tr.cash td')?.getAttribute('colspan')).toBe('6');
    });
  });

  describe('cash', () => {
    it('says cash is not entered and lets the owner set it', () => {
      const { el, button, host } = render((h) => h.holdings.set([rows[0]]));

      expect(el.querySelector('tr.cash')?.textContent).toContain('not entered yet');
      button('Set cash balance').click();
      expect(host.events).toEqual([['editCash', null]]);
    });

    it('does not offer to set cash to someone who can only view', () => {
      const { el } = render((h) => {
        h.holdings.set([rows[0]]);
        h.readonly.set(true);
      });

      expect(el.querySelector('tr.cash')?.textContent).toContain('not entered yet');
      expect(el.querySelector('tr.cash button')).toBeNull();
    });

    it('shows a cash row per currency, with the foreign balance and its exchange rate', () => {
      const { el } = render((h) => {
        h.holdings.set([rows[0]]);
        h.cash.set([
          cashBalance({ currency: 'CAD', balance: 500, value: 500, asOf: '2026-10-30' }),
          cashBalance({ currency: 'USD', balance: 100, value: 135, fxRate: 1.35 }),
        ]);
      });

      const cashRows = Array.from(el.querySelectorAll('tr.cash'));
      expect(cashRows).toHaveLength(2);
      expect(cashRows[0].querySelector('.currency-code')?.textContent).toBe('CAD');
      expect(cashRows[0].querySelector('.num.muted')?.textContent?.trim()).toBe('');
      expect(cashRows[1].querySelector('.currency-code')?.textContent).toBe('USD');
      expect(cashRows[1].querySelector('.num.muted')?.textContent?.trim()).toBe('× 1.35');
      expect(cashRows[1].textContent).toContain(formatMoney(135, 'CAD'));
      expect(cashRows[1].textContent).toContain(formatMoney(100, 'USD'));
      expect(cashRows[0].querySelector('.small')?.textContent).toContain('as of');
    });

    it('marks a negative balance as a loss', () => {
      const { el } = render((h) => h.cash.set([cashBalance({ balance: -50, value: -50 })]));

      expect(el.querySelector('tr.cash td.loss')).not.toBeNull();
    });

    it('does not mark a positive balance as a loss', () => {
      const { el } = render((h) => h.cash.set([cashBalance()]));

      expect(el.querySelector('tr.cash td.loss')).toBeNull();
    });

    it('emits editCash with the currency when Edit is pressed', () => {
      const { el, host } = render((h) => h.cash.set([cashBalance({ currency: 'USD' })]));

      el.querySelector<HTMLButtonElement>('tr.cash button.edit')!.click();

      expect(host.events).toEqual([['editCash', 'USD']]);
    });

    it('hides Edit from someone who can only view', () => {
      const { el } = render((h) => {
        h.cash.set([cashBalance()]);
        h.readonly.set(true);
      });

      expect(el.querySelector('tr.cash button')).toBeNull();
    });
  });

  describe('interaction', () => {
    it('emits open with the security id when a row is clicked', () => {
      const { el, host } = render((h) => h.holdings.set(rows));

      el.querySelectorAll<HTMLElement>('tbody tr.clickable')[0].click();

      expect(host.events).toEqual([['open', 'b']]);
    });

    it('goes to the holding from the symbol link without also emitting open', async () => {
      const { el, host, fixture } = render((h) => h.holdings.set(rows));
      const router = TestBed.inject(Router);

      el.querySelector<HTMLAnchorElement>('a.ticker')!.click();
      await fixture.whenStable();

      expect(host.events).toEqual([]);
      expect(router.url).toBe('/holdings/b');
    });
  });

  describe('sorting', () => {
    it('starts with the largest market value first', () => {
      expect(render((h) => h.holdings.set(rows)).tickers()).toEqual(['BBB', 'CCC', 'AAA']);
    });

    it.each([
      ['Holding', ['AAA', 'BBB', 'CCC']],
      ['Shares', ['AAA', 'CCC', 'BBB']],
      ['Average cost', ['BBB', 'CCC', 'AAA']],
      ['Price', ['AAA', 'CCC', 'BBB']],
      ['Unrealized gain', ['CCC', 'BBB', 'AAA']],
      ['Weight', ['BBB', 'CCC', 'AAA']],
    ])('sorts by %s and reverses on a second click', (column, expected) => {
      const { fixture, tickers, header } = render((h) => h.holdings.set(rows));

      header(column).click();
      fixture.detectChanges();
      expect(tickers()).toEqual(expected);

      header(column).click();
      fixture.detectChanges();
      expect(tickers()).toEqual([...expected].reverse());
    });

    it('sorts by market value in both directions', () => {
      const { fixture, tickers, header } = render((h) => h.holdings.set(rows));

      header('Market value').click();
      fixture.detectChanges();

      expect(tickers()).toEqual(['AAA', 'CCC', 'BBB']);
    });

    it('keeps cash and the total below the holdings whatever the sort', () => {
      const { el, fixture, header } = render((h) => {
        h.holdings.set(rows);
        h.cash.set([cashBalance()]);
      });

      header('Holding').click();
      fixture.detectChanges();

      const last = el.querySelector('tbody tr:last-child')!;
      expect(last.classList).toContain('cash');
      expect(el.querySelector('tfoot')).not.toBeNull();
    });
  });
});
