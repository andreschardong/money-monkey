import { Component, computed, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { Auth } from '../core/auth';
import { compactAxisFormatter, formatDate, formatMoney, FORMAT_PIPES } from '../core/format';
import { Currency, HistoryPoint, Range } from '../core/models';
import { Theme } from '../core/theme';
import { chartTheme } from './chart-theme';
import { SortHeader, TableSort } from './table-sort';
import { ChartOptions, EChart, reducedMotion } from './echart';

export const RANGES: readonly Range[] = ['1M', '3M', '6M', 'YTD', '1Y', '3Y', 'ALL'];

/**
 * Portfolio value against net deposits: the gap between the two lines is what the money has earned. Without any
 * deposit or withdrawal recorded, the net-deposits line would be a flat zero that pins the axis to zero and flattens
 * the value line, so it is left out until there is one.
 */
@Component({
  selector: 'app-value-chart',
  imports: [EChart, MatButtonModule, MatButtonToggleModule, SortHeader, ...FORMAT_PIPES],
  templateUrl: './value-chart.html',
  styleUrl: './value-chart.scss',
})
export class ValueChart {
  readonly points = input.required<HistoryPoint[]>();
  readonly currency = input.required<Currency>();
  readonly range = input.required<Range>();
  readonly loading = input(false);
  readonly rangeChange = output<Range>();

  protected readonly ranges = RANGES;
  protected readonly showTable = signal(false);
  protected readonly auth = inject(Auth);
  private readonly theme = inject(Theme);

  /** Month-end rows (and the latest day) for the table view. */
  protected readonly rows = computed(() => {
    const points = this.points();
    const rows: HistoryPoint[] = [];
    for (let i = 0; i < points.length; i++) {
      const next = points[i + 1];
      if (!next || next.date.slice(0, 7) !== points[i].date.slice(0, 7)) {
        rows.push(points[i]);
      }
    }
    return rows.reverse();
  });

  /** A deposit, withdrawal or transfer has been recorded, so net deposits mean something. */
  protected readonly hasContributions = computed(() => this.points().some(p => p.netContributions !== 0));

  protected readonly sort = new TableSort({ key: 'date', direction: 'desc' });
  protected readonly sortedRows = computed(() => this.sort.apply(this.rows(), {
    date: r => r.date, value: r => r.value, netContributions: r => r.netContributions, earned: r => r.value - r.netContributions,
  }));

  protected readonly options = computed<ChartOptions>(() => {
    const t = chartTheme(this.theme.isDark());
    const currency = this.currency();
    const points = this.points();
    const withDeposits = this.hasContributions();
    const showGains = this.auth.showGains();
    const font = getComputedStyle(document.body).fontFamily;
    const axisLabel = compactAxisFormatter(
      withDeposits ? points.flatMap(p => [p.value, p.netContributions]) : points.map(p => p.value), currency);

    return {
      animation: !reducedMotion(),
      animationDuration: 650,
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
          const items = params as { dataIndex: number }[];
          const point = points[items[0]?.dataIndex ?? 0];
          if (!point) {
            return '';
          }
          const gain = point.value - point.netContributions;
          const row = (colour: string, value: string, label: string) =>
            `<div style="display:flex;align-items:center;gap:8px;margin-top:4px">` +
            `<span style="display:inline-block;width:14px;height:2px;background:${colour}"></span>` +
            `<strong style="font-variant-numeric:tabular-nums">${value}</strong>` +
            `<span style="color:${t.ink2}">${label}</span></div>`;
          const head = `<div style="color:${t.ink2};font-size:12px">${formatDate(point.date, 'weekday')}</div>` +
            row(t.series[0], formatMoney(point.value, currency), 'value');
          if (!withDeposits) {
            return head;
          }
          const earned = showGains
            ? `<div style="margin-top:6px;color:${gain >= 0 ? t.gain : t.loss};font-variant-numeric:tabular-nums">` +
              `${formatMoney(gain, currency, { signed: true })} earned</div>`
            : '';
          return head + row(t.series[1], formatMoney(point.netContributions, currency), 'net deposits') + earned;
        },
      },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: t.axis } },
        axisTick: { show: false },
        axisLabel: {
          color: t.ink3,
          hideOverlap: true,
          formatter: { year: '{yyyy}', month: '{MMM}', day: '{MMM} {d}' },
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        // The axis fits the data rather than starting at zero, so a steady portfolio's moves stay visible.
        scale: true,
        splitNumber: 4,
        axisLabel: { color: t.ink3, formatter: axisLabel },
        splitLine: { lineStyle: { color: t.grid, width: 1, type: 'solid' } },
      },
      series: [
        ...(withDeposits ? [{
          name: 'Net deposits',
          type: 'line',
          step: 'end',
          data: points.map(p => [p.date, p.netContributions]),
          showSymbol: false,
          symbolSize: 8,
          lineStyle: { width: 2, color: t.series[1], cap: 'round', join: 'round' },
          itemStyle: { color: t.series[1], borderColor: t.surface, borderWidth: 2 },
          emphasis: { disabled: true },
          z: 2,
        }] : []),
        {
          name: 'Value',
          type: 'line',
          data: points.map(p => [p.date, p.value]),
          showSymbol: false,
          symbolSize: 8,
          lineStyle: { width: 2, color: t.series[0], cap: 'round', join: 'round' },
          itemStyle: { color: t.series[0], borderColor: t.surface, borderWidth: 2 },
          areaStyle: { color: t.series[0], opacity: 0.1 },
          emphasis: { disabled: true },
          z: 3,
        },
      ],
    };
  });
}
