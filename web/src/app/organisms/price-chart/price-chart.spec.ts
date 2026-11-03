import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { drawnChart, fakeEcharts, stubMatchMedia, transaction } from '../../../testing';
import { formatPrice } from '../../core/format';
import { PricePoint, Range, Transaction } from '../../core/models';
import { Theme } from '../../core/theme';
import { PriceChart } from './price-chart';

vi.mock('echarts/core', async () => (await import('../../../testing/echarts')).echartsCoreModule());

@Component({
  imports: [PriceChart],
  template: `<app-price-chart
    [points]="points()"
    [transactions]="transactions()"
    currency="CAD"
    [range]="range()"
    (rangeChange)="changed.push($event)"
  />`,
})
class Host {
  readonly points = signal<PricePoint[]>([]);
  readonly transactions = signal<Transaction[]>([]);
  readonly range = signal<Range>('1Y');
  readonly changed: Range[] = [];
}

const closes: PricePoint[] = [
  { date: '2026-09-01', close: 100 },
  { date: '2026-09-02', close: 110 },
  { date: '2026-09-03', close: 120 },
];

describe('PriceChart', () => {
  beforeEach(() => fakeEcharts.reset());

  function render(points: PricePoint[] = closes, transactions: Transaction[] = []) {
    TestBed.configureTestingModule({ imports: [Host] });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.points.set(points);
    fixture.componentInstance.transactions.set(transactions);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      el,
      host: fixture.componentInstance,
      legend: () => Array.from(el.querySelectorAll('.legend li')).map((li) => li.textContent?.trim()),
    };
  }

  it('draws the closing prices as a line with no trade markers when nothing was traded', () => {
    const { legend } = render();

    const series = drawnChart().series;
    expect(series.map((s) => s.name)).toEqual(['Close', 'Your buys', 'Your sales']);
    expect(series[0].data).toEqual([
      ['2026-09-01', 100],
      ['2026-09-02', 110],
      ['2026-09-03', 120],
    ]);
    expect(series[1].data).toEqual([]);
    expect(series[2].data).toEqual([]);
    expect(legend()).toEqual(['Close']);
  });

  it('says there is no history instead of drawing a chart for a single price', () => {
    const { el } = render([{ date: '2026-09-01', close: 100 }]);

    expect(fakeEcharts.charts).toHaveLength(0);
    expect(el.querySelector('.empty')?.textContent).toBe('No price history yet.');
  });

  it('says there is no history for an empty series', () => {
    expect(render([]).el.querySelector('.empty')).not.toBeNull();
  });

  it('lists the ranges and announces the one picked', () => {
    const { fixture, el, host } = render();

    expect(Array.from(el.querySelectorAll('mat-button-toggle')).map((t) => t.textContent?.trim())).toEqual([
      '1M',
      '3M',
      '6M',
      'YTD',
      '1Y',
      '3Y',
      'All',
    ]);
    expect(el.querySelectorAll('mat-button-toggle')[4].classList).toContain('mat-button-toggle-checked');
    el.querySelectorAll<HTMLButtonElement>('mat-button-toggle button')[1].click();
    fixture.detectChanges();

    expect(host.changed).toEqual(['3M']);
  });

  describe('trade markers', () => {
    const trades = [
      transaction({ id: 'b', type: 'Buy', date: '2026-09-02', quantity: 5, price: 108 }),
      transaction({ id: 't', type: 'TransferIn', date: '2026-09-03', quantity: 2, price: 119 }),
      transaction({ id: 's', type: 'Sell', date: '2026-09-03', quantity: 1, price: 121 }),
      transaction({ id: 'd', type: 'Dividend', date: '2026-09-03', quantity: 0, price: 0 }),
    ];

    it('marks buys and transfers in as buys and sells as sales, naming each in the legend', () => {
      const { legend } = render(closes, trades);

      const [, buys, sales] = drawnChart().series;
      expect(buys.data).toHaveLength(2);
      expect(sales.data).toHaveLength(1);
      expect(legend()).toEqual(['Close', 'Your buys', 'Your sales']);
    });

    it('lists only buys in the legend when nothing was sold', () => {
      const { legend } = render(closes, [trades[0]]);

      expect(legend()).toEqual(['Close', 'Your buys']);
    });

    it('lists only sales in the legend when nothing was bought', () => {
      const { legend } = render(closes, [trades[2]]);

      expect(legend()).toEqual(['Close', 'Your sales']);
    });

    it('leaves out trades from before the first price on the chart', () => {
      render(closes, [transaction({ type: 'Buy', date: '2026-01-01' })]);

      expect(drawnChart().series[1].data).toEqual([]);
    });
  });

  describe('splits', () => {
    const split = transaction({
      id: 'sp',
      type: 'Split',
      date: '2026-09-02',
      splitFrom: 1,
      splitTo: 2,
      quantity: 0,
      price: 0,
    });

    it('restates earlier prices for the split and says so in the legend', () => {
      const { legend } = render(closes, [split]);

      expect(drawnChart().series[0].data).toEqual([
        ['2026-09-01', 50],
        ['2026-09-02', 110],
        ['2026-09-03', 120],
      ]);
      expect(legend()).toEqual(['Close', 'Adjusted for splits']);
    });

    it('restates the price and share count of trades made before the split', () => {
      render(closes, [split, transaction({ type: 'Buy', date: '2026-09-01', quantity: 10, price: 100 })]);

      const marker = drawnChart().series[1].data[0] as { value: [string, number] };
      expect(marker.value).toEqual(['2026-09-01', 50]);
    });

    it('compounds several splits', () => {
      render(closes, [
        split,
        transaction({ id: 'sp2', type: 'Split', date: '2026-09-03', splitFrom: 1, splitTo: 3, quantity: 0, price: 0 }),
      ]);

      expect(drawnChart().series[0].data[0]).toEqual(['2026-09-01', 100 / 6]);
    });

    it('ignores a split that has no ratio', () => {
      const { legend } = render(closes, [
        transaction({ type: 'Split', date: '2026-09-02', splitFrom: 0, splitTo: 2 }),
        transaction({ type: 'Split', date: '2026-09-02', splitFrom: 1, splitTo: 0 }),
      ]);

      expect(legend()).toEqual(['Close']);
    });
  });

  describe('options', () => {
    it('animates unless the system asks for reduced motion', () => {
      render();
      expect(drawnChart().animation).toBe(true);
    });

    it('does not animate under reduced motion', () => {
      stubMatchMedia({ '(prefers-reduced-motion: reduce)': true });
      render();
      expect(drawnChart().animation).toBe(false);
    });

    it('redraws in the dark palette', () => {
      const { fixture } = render();
      const before = JSON.stringify(drawnChart().series[0]);

      TestBed.inject(Theme).set('dark');
      fixture.detectChanges();

      expect(JSON.stringify(drawnChart().series[0])).not.toBe(before);
    });

    it('labels the price axis in money', () => {
      render();

      expect(drawnChart().yAxis.axisLabel.formatter(110)).toContain('110');
    });
  });

  describe('tooltip', () => {
    const point = (seriesIndex: number, data: unknown) => ({ seriesIndex, data });
    const tradeDatum = (trade: Transaction) => ({
      value: [trade.date, trade.price],
      trade: { ...trade, chartPrice: trade.price },
    });

    it('shows the day and the close', () => {
      render();

      const html = drawnChart().tooltip.formatter([point(0, ['2026-09-02', 110])]);
      expect(html).toContain(formatPrice(110, 'CAD'));
      expect(html).toContain('close');
      expect(html).not.toContain('Bought');
    });

    it('describes each kind of trade made on that day', () => {
      render();
      const buy = transaction({ type: 'Buy', date: '2026-09-02', quantity: 5, price: 108 });
      const sell = transaction({ type: 'Sell', date: '2026-09-02', quantity: 1, price: 111, currency: 'USD' });
      const transfer = transaction({ type: 'TransferIn', date: '2026-09-02', quantity: 2, price: 109 });

      const html = drawnChart().tooltip.formatter([
        point(0, ['2026-09-02', 110]),
        point(1, tradeDatum(buy)),
        point(2, tradeDatum(sell)),
        point(1, tradeDatum(transfer)),
      ]);

      expect(html).toContain(`Bought 5 at ${formatPrice(108, 'CAD')}`);
      expect(html).toContain(`Sold 1 at ${formatPrice(111, 'USD')}`);
      expect(html).toContain(`Transferred in 2 at ${formatPrice(109, 'CAD')}`);
    });

    it('leaves out a trade from a neighbouring day', () => {
      render();
      const other = transaction({ type: 'Buy', date: '2026-09-03', quantity: 5, price: 108 });

      const html = drawnChart().tooltip.formatter([point(0, ['2026-09-02', 110]), point(1, tradeDatum(other))]);

      expect(html).not.toContain('Bought');
    });

    it('shows nothing when the close is missing', () => {
      render();

      expect(drawnChart().tooltip.formatter([])).toBe('');
    });
  });
});
