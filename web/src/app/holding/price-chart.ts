import { Component, computed, inject, input, output } from '@angular/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { formatCompactMoney, formatDate, formatPrice, formatQuantity } from '../core/format';
import { Currency, PricePoint, Range, Transaction } from '../core/models';
import { Theme } from '../core/theme';
import { chartTheme } from '../shared/chart-theme';
import { ChartOptions, EChart, reducedMotion } from '../shared/echart';
import { RANGES } from '../shared/value-chart';

/** Daily closes with the user's buys and sells marked, restated for splits so the line has no cliffs. */
@Component({
  selector: 'app-price-chart',
  imports: [EChart, MatButtonToggleModule],
  template: `
    <div class="head">
    <ul class="legend" aria-label="Chart legend">
      <li><i class="line"></i>Close</li>
      @if (hasBuys()) {
        <li><i class="tri up"></i>Your buys</li>
      }
      @if (hasSells()) {
        <li><i class="tri down"></i>Your sales</li>
      }
      @if (adjusted()) {
        <li class="note">Adjusted for splits</li>
      }
    </ul>
    <mat-button-toggle-group [value]="range()" (change)="rangeChange.emit($event.value)" hideSingleSelectionIndicator aria-label="Time range">
      @for (r of ranges; track r) {
        <mat-button-toggle [value]="r">{{ r === 'ALL' ? 'All' : r }}</mat-button-toggle>
      }
    </mat-button-toggle-group>
    </div>
    <div class="plot">
      @if (points().length > 1) {
        <app-echart [options]="options()" />
      } @else {
        <p class="empty muted">No price history yet.</p>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 24px; margin-bottom: 12px; }
    mat-button-toggle-group {
      --mat-button-toggle-height: 32px;
      --mat-button-toggle-shape: 8px;
      --mat-button-toggle-label-text-size: 0.8125rem;
      --mat-button-toggle-selected-state-background-color: var(--harbour-wash);
      --mat-button-toggle-selected-state-text-color: var(--harbour-ink);
      border-color: var(--rule);
    }
    .legend {
      display: flex; flex-wrap: wrap; gap: 8px 20px; margin: 0; padding: 0; list-style: none;
      color: var(--ink-2); font-size: 0.8125rem;
      li { display: inline-flex; align-items: center; gap: 8px; }
      .note { color: var(--ink-3); }
    }
    .line { width: 16px; height: 2px; background: var(--chart-1); }
    .tri { width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; }
    .tri.up { border-bottom: 10px solid var(--ink); }
    .tri.down { border-top: 10px solid var(--chart-2); }
    .plot { height: 280px; }
    .empty { display: grid; height: 100%; place-items: center; }
  `,
})
export class PriceChart {
  readonly points = input.required<PricePoint[]>();
  readonly transactions = input.required<Transaction[]>();
  readonly currency = input.required<Currency>();
  readonly range = input.required<Range>();
  readonly rangeChange = output<Range>();

  protected readonly ranges = RANGES;
  private readonly theme = inject(Theme);

  private readonly splits = computed(() =>
    this.transactions()
      .filter(t => t.type === 'Split' && t.splitFrom > 0 && t.splitTo > 0)
      .map(t => ({ date: t.date, factor: t.splitTo / t.splitFrom })));

  protected readonly adjusted = computed(() => this.splits().length > 0);

  /** Divides out every split after the date, so old prices match today's share count. */
  private factorAfter(date: string): number {
    return this.splits().filter(s => s.date > date).reduce((f, s) => f * s.factor, 1);
  }

  private readonly trades = computed(() =>
    this.transactions()
      .filter(t => t.type === 'Buy' || t.type === 'Sell' || t.type === 'TransferIn')
      .map(t => {
        const factor = this.factorAfter(t.date);
        return { ...t, chartPrice: t.price / factor, chartQuantity: t.quantity * factor };
      }));

  protected readonly hasBuys = computed(() => this.trades().some(t => t.type !== 'Sell'));
  protected readonly hasSells = computed(() => this.trades().some(t => t.type === 'Sell'));

  protected readonly options = computed<ChartOptions>(() => {
    const t = chartTheme(this.theme.isDark());
    const currency = this.currency();
    const font = getComputedStyle(document.body).fontFamily;
    const first = this.points()[0]?.date ?? '';
    const line = this.points().map(p => [p.date, p.close / this.factorAfter(p.date)]);
    const inRange = this.trades().filter(trade => trade.date >= first);
    const marker = (trade: (typeof inRange)[number]) => ({
      value: [trade.date, trade.chartPrice],
      trade,
    });

    return {
      animation: !reducedMotion(),
      animationDuration: 500,
      textStyle: { fontFamily: font },
      grid: { left: 4, right: 12, top: 12, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: t.axis, width: 1, type: 'solid' } },
        backgroundColor: t.tooltipBg,
        borderColor: t.tooltipBorder,
        borderWidth: 1,
        padding: [10, 12],
        extraCssText: 'border-radius: 8px; box-shadow: 0 6px 20px rgb(0 0 0 / 12%);',
        textStyle: { color: t.ink, fontFamily: font, fontSize: 13 },
        formatter: (params: unknown) => {
          const items = params as { seriesIndex: number; data: unknown }[];
          const close = items.find(i => i.seriesIndex === 0)?.data as [string, number] | undefined;
          if (!close) {
            return '';
          }
          // Each series reports its nearest point; only trades on this exact day belong in the readout.
          const trades = items
            .filter(i => i.seriesIndex > 0)
            .map(i => (i.data as { trade: (typeof inRange)[number] }).trade)
            .filter(trade => trade.date === close[0]);
          let html = `<div style="color:${t.ink2};font-size:12px">${formatDate(close[0], 'weekday')}</div>` +
            `<div><strong style="font-variant-numeric:tabular-nums">${formatPrice(close[1], currency)}</strong>` +
            ` <span style="color:${t.ink2}">close</span></div>`;
          for (const trade of trades) {
            const verb = trade.type === 'Sell' ? 'Sold' : trade.type === 'TransferIn' ? 'Transferred in' : 'Bought';
            html += `<div style="margin-top:4px">${verb} ${formatQuantity(trade.quantity)} at ${formatPrice(trade.price, trade.currency)}</div>`;
          }
          return html;
        },
      },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: t.axis } },
        axisTick: { show: false },
        axisLabel: { color: t.ink3, hideOverlap: true, formatter: { year: '{yyyy}', month: '{MMM}', day: '{MMM} {d}' } },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        scale: true,
        splitNumber: 4,
        axisLabel: { color: t.ink3, formatter: (value: number) => formatCompactMoney(value, currency) },
        splitLine: { lineStyle: { color: t.grid, width: 1, type: 'solid' } },
      },
      series: [
        {
          name: 'Close',
          type: 'line',
          data: line,
          showSymbol: false,
          lineStyle: { width: 2, color: t.series[0], cap: 'round', join: 'round' },
          itemStyle: { color: t.series[0] },
          emphasis: { disabled: true },
        },
        {
          name: 'Your buys',
          type: 'scatter',
          data: inRange.filter(x => x.type !== 'Sell').map(marker),
          symbol: 'triangle',
          symbolSize: 14,
          itemStyle: { color: t.ink, borderColor: t.surface, borderWidth: 2 },
          z: 4,
        },
        {
          name: 'Your sales',
          type: 'scatter',
          data: inRange.filter(x => x.type === 'Sell').map(marker),
          symbol: 'triangle',
          symbolRotate: 180,
          symbolSize: 14,
          itemStyle: { color: t.series[1], borderColor: t.surface, borderWidth: 2 },
          z: 4,
        },
      ],
    };
  });
}
