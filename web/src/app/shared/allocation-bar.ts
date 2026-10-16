import { Component, computed, inject, input } from '@angular/core';
import { FORMAT_PIPES, formatPercent } from '../core/format';
import { Allocation, Currency } from '../core/models';
import { Theme } from '../core/theme';
import { assetTypeColour, chartTheme, currencyColour, slotColour } from './chart-theme';

/** Part-to-whole as one stacked bar; the legend below doubles as the table view. */
@Component({
  selector: 'app-allocation-bar',
  imports: [...FORMAT_PIPES],
  template: `
    <div class="bar" role="img" [attr.aria-label]="summary()">
      @for (slice of slices(); track slice.key) {
        <span class="segment" [style.flex-grow]="slice.weight" [style.background]="slice.colour"></span>
      }
    </div>
    <table class="legend">
      <tbody>
        @for (slice of slices(); track slice.key) {
          <tr>
            <td><i class="swatch" [style.background]="slice.colour"></i>{{ slice.label }}</td>
            <td class="num right">{{ slice.value | money: currency() }}</td>
            <td class="num right share">{{ slice.weight | pct: false : 1 }}</td>
          </tr>
        }
      </tbody>
    </table>
  `,
  styles: `
    :host { display: block; }
    .bar {
      display: flex;
      gap: 2px;
      height: 12px;
      margin-bottom: 14px;
    }
    .segment {
      min-width: 3px;
      flex-basis: 0;
      border-radius: 2px;
      &:first-child { border-top-left-radius: 4px; border-bottom-left-radius: 4px; }
      &:last-child { border-top-right-radius: 4px; border-bottom-right-radius: 4px; }
    }
    .legend {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
      td { padding: 5px 0; }
      .right { text-align: right; }
      .share { width: 64px; color: var(--ink-2); }
    }
    .swatch {
      display: inline-block;
      width: 10px;
      height: 10px;
      margin-right: 10px;
      border-radius: 3px;
      vertical-align: -1px;
    }
  `,
})
export class AllocationBar {
  readonly items = input.required<Allocation[]>();
  readonly currency = input.required<Currency>();
  readonly colourBy = input<'currency' | 'assetType' | 'country'>('currency');

  private readonly theme = inject(Theme);

  protected readonly slices = computed(() => {
    const theme = chartTheme(this.theme.isDark());
    const by = this.colourBy();
    let named = 0;
    return this.items().map(item => ({
      ...item,
      colour: by === 'country' ? slotColour(theme, item.key === '' ? 0 : named++, item.key)
        : by === 'currency' ? currencyColour(theme, item.key) : assetTypeColour(theme, item.key),
    }));
  });

  protected readonly summary = computed(() =>
    this.items().map(i => `${i.label} ${formatPercent(i.weight, { signed: false, decimals: 1 })}`).join(', '));
}
