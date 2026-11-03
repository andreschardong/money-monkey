import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FakeAuth, provideAppTesting, provideFakeAuth } from '../../../testing';
import { formatMoney } from '../../core/format';
import { IncomeYear, RealizedGain, RealizedReport } from '../../core/models';
import { IncomePanel } from './income-panel';

@Component({ imports: [IncomePanel], template: `<app-income-panel [report]="report()" />` })
class Host {
  readonly report = signal<RealizedReport>({ currency: 'CAD', years: [], sales: [] });
}

const year = (y: number, over: Partial<IncomeYear> = {}): IncomeYear => ({
  year: y,
  proceeds: 0,
  costBasis: 0,
  gain: 0,
  dividends: 0,
  interest: 0,
  taxWithheld: 0,
  ...over,
});

const sale = (id: string, over: Partial<RealizedGain> = {}): RealizedGain => ({
  transactionId: id,
  date: '2026-03-01',
  securityId: `sec-${id}`,
  symbol: id.toUpperCase(),
  name: `${id} Corp`,
  quantity: 1,
  currency: 'CAD',
  proceedsLocal: 0,
  costLocal: 0,
  gainLocal: 0,
  proceeds: 0,
  costBasis: 0,
  gain: 0,
  ...over,
});

const years: IncomeYear[] = [
  year(2024, { proceeds: 1_000, costBasis: 800, gain: 200, dividends: 50, interest: 5, taxWithheld: 7 }),
  year(2025, { proceeds: 500, costBasis: 700, gain: -200, dividends: 80, interest: 1, taxWithheld: 2 }),
  year(2026, { proceeds: 0, costBasis: 0, gain: 0, dividends: 10, interest: 9, taxWithheld: 0 }),
];

const sales: RealizedGain[] = [
  sale('a', { date: '2026-01-10', quantity: 5, proceeds: 500, costBasis: 400, gain: 100 }),
  sale('b', { date: '2026-02-10', quantity: 1, proceeds: 300, costBasis: 350, gain: -50 }),
  sale('c', { date: '2026-03-10', quantity: 3, proceeds: 100, costBasis: 100, gain: 0 }),
];

describe('IncomePanel', () => {
  function render(report: Partial<RealizedReport> = {}, hideGains = false) {
    const auth = new FakeAuth();
    auth.hideGains.set(hideGains);
    TestBed.configureTestingModule({ imports: [Host], providers: [provideAppTesting(), provideFakeAuth(auth)] });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.report.set({ currency: 'CAD', years, sales, ...report });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const tables = () => Array.from(el.querySelectorAll('table'));
    const column = (table: number, index: number) =>
      Array.from(tables()[table].querySelectorAll(`tbody tr td:nth-child(${index})`)).map((td) =>
        td.textContent?.trim(),
      );
    const header = (table: number, name: string) =>
      Array.from(tables()[table].querySelectorAll<HTMLElement>('thead th')).find(
        (th) => th.textContent?.trim() === name,
      )!;
    const sortBy = (table: number, name: string) => {
      header(table, name).click();
      fixture.detectChanges();
    };
    return { fixture, el, tables, column, header, sortBy };
  }

  it('invites the person to come back when there is nothing to summarize', () => {
    const { el, tables } = render({ years: [], sales: [] });

    expect(el.querySelector('.empty')?.textContent).toContain('will be summarized here by year');
    expect(tables()).toHaveLength(0);
  });

  describe('by year', () => {
    it('lists the years newest first with every figure in the report currency', () => {
      const { column, tables } = render();

      expect(column(0, 1)).toEqual(['2026', '2025', '2024']);
      expect(column(0, 2)).toEqual([0, 500, 1_000].map((v) => formatMoney(v, 'CAD')));
      expect(column(0, 3)).toEqual([0, 700, 800].map((v) => formatMoney(v, 'CAD')));
      expect(column(0, 5)).toEqual([10, 80, 50].map((v) => formatMoney(v, 'CAD')));
      expect(tables()[0].querySelectorAll('th.hide-s')).toHaveLength(4);
    });

    it('explains how gains are worked out', () => {
      const { el } = render({ currency: 'USD' });

      expect(el.querySelector('.caption')?.textContent).toContain('adjusted cost base (average cost) in USD');
    });

    it('signs the realized gain and colours it, leaving zero plain', () => {
      const { tables } = render();

      const cells = Array.from(tables()[0].querySelectorAll('tbody tr td:nth-child(4)'));
      expect(cells.map((c) => c.textContent?.trim())).toEqual([
        formatMoney(0, 'CAD', { signed: true }),
        formatMoney(-200, 'CAD', { signed: true }),
        formatMoney(200, 'CAD', { signed: true }),
      ]);
      expect(cells.map((c) => [c.classList.contains('gain'), c.classList.contains('loss')])).toEqual([
        [false, false],
        [false, true],
        [true, false],
      ]);
    });

    it.each([
      ['Proceeds', 2, [2024, 2025, 2026]],
      ['Book value sold', 3, [2024, 2025, 2026]],
      ['Realized gain', 4, [2024, 2026, 2025]],
      ['Dividends', 5, [2025, 2024, 2026]],
      ['Interest', 6, [2026, 2024, 2025]],
      ['Tax withheld', 7, [2024, 2025, 2026]],
    ])('sorts by %s, largest first, and reverses on a second click', (name, _index, order) => {
      const { column, sortBy } = render();

      sortBy(0, name);
      expect(column(0, 1)).toEqual(order.map(String));
      sortBy(0, name);
      expect(column(0, 1)).toEqual([...order].reverse().map(String));
    });

    it('sorts by year, flipping the starting order', () => {
      const { column, sortBy } = render();

      sortBy(0, 'Year');

      expect(column(0, 1)).toEqual(['2024', '2025', '2026']);
    });
  });

  describe('sales', () => {
    it('lists the sales newest first, linking each security', () => {
      const { column, tables } = render();

      expect(column(1, 2)).toEqual(['C', 'B', 'A']);
      const link = tables()[1].querySelector('tbody a.ticker');
      expect(link?.getAttribute('href')).toContain('holdings/sec-c');
      expect(column(1, 4)).toEqual([100, 300, 500].map((v) => formatMoney(v, 'CAD')));
    });

    it('signs and colours each gain', () => {
      const { tables } = render();

      const cells = Array.from(tables()[1].querySelectorAll('tbody tr td:nth-child(6)'));
      expect(cells.map((c) => c.textContent?.trim())).toEqual([
        formatMoney(0, 'CAD', { signed: true }),
        formatMoney(-50, 'CAD', { signed: true }),
        formatMoney(100, 'CAD', { signed: true }),
      ]);
      expect(cells.map((c) => [c.classList.contains('gain'), c.classList.contains('loss')])).toEqual([
        [false, false],
        [false, true],
        [true, false],
      ]);
    });

    it('shows no sales table when nothing was sold', () => {
      const { tables, el } = render({ sales: [] });

      expect(tables()).toHaveLength(1);
      expect(el.querySelector('.sales-title')).toBeNull();
    });

    it.each([
      ['Date', 1, ['A', 'B', 'C']],
      ['Security', 2, ['A', 'B', 'C']],
      ['Shares', 3, ['A', 'C', 'B']],
      ['Proceeds', 4, ['A', 'B', 'C']],
      ['Book value', 5, ['A', 'B', 'C']],
      ['Gain', 6, ['A', 'C', 'B']],
    ])('sorts by %s and reverses on a second click', (name, _index, order) => {
      const { column, sortBy } = render();

      sortBy(1, name);
      expect(column(1, 2)).toEqual(order);
      sortBy(1, name);
      expect(column(1, 2)).toEqual([...order].reverse());
    });
  });

  describe('gains hidden', () => {
    it('drops the caption and every gain column from both tables', () => {
      const { el, tables } = render({}, true);

      expect(el.querySelector('.caption')).toBeNull();
      const names = tables().map((t) => Array.from(t.querySelectorAll('thead th')).map((th) => th.textContent?.trim()));
      expect(names[0]).not.toContain('Realized gain');
      expect(names[1]).not.toContain('Gain');
      expect(tables()[0].querySelectorAll('tbody tr:first-child td')).toHaveLength(6);
      expect(tables()[1].querySelectorAll('tbody tr:first-child td')).toHaveLength(5);
      expect(el.querySelectorAll('.gain, .loss')).toHaveLength(0);
    });

    it('still shows income and sale proceeds', () => {
      const { column } = render({}, true);

      expect(column(0, 4)).toEqual([10, 80, 50].map((v) => formatMoney(v, 'CAD')));
      expect(column(1, 4)).toEqual([100, 300, 500].map((v) => formatMoney(v, 'CAD')));
    });
  });
});
