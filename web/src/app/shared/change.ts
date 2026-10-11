import { Component, computed, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { direction, formatMoney, formatPercent } from '../core/format';
import { Currency } from '../core/models';

/**
 * A signed change in money and/or percent. Direction is carried three ways (arrow, sign and colour) so it
 * never depends on colour alone.
 */
@Component({
  selector: 'app-change',
  imports: [MatIcon],
  template: `
    <span class="change num" [class]="tone()" [attr.aria-label]="spoken()">
      @if (showArrow() && tone()) {
        <mat-icon class="arrow" [svgIcon]="tone() === 'gain' ? 'arrow_upward' : 'arrow_downward'" aria-hidden="true" />
      }
      @if (amount() !== null && amount() !== undefined) {
        <span>{{ money() }}</span>
      }
      @if (percent() !== null && percent() !== undefined) {
        <span [class.paren]="amount() !== null && amount() !== undefined">{{ pct() }}</span>
      }
    </span>
  `,
  styles: `
    .change {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-weight: 550;
    }
    .gain { color: var(--gain); }
    .loss { color: var(--loss); }
    .arrow {
      width: 1em;
      height: 1em;
      margin-right: -3px;
    }
    .paren { color: inherit; opacity: 0.85; }
  `,
})
export class Change {
  readonly amount = input<number | null | undefined>(null);
  readonly percent = input<number | null | undefined>(null);
  readonly currency = input<Currency>('CAD');
  readonly showArrow = input(true);

  protected readonly tone = computed(() => {
    const amount = this.amount();
    return amount !== null && amount !== undefined ? direction(amount) : direction(this.percent(), 0.00005);
  });
  protected readonly money = computed(() => formatMoney(this.amount(), this.currency(), { signed: true }));
  protected readonly pct = computed(() => formatPercent(this.percent()));
  protected readonly spoken = computed(() => {
    const word = this.tone() === 'gain' ? 'up' : this.tone() === 'loss' ? 'down' : 'unchanged';
    const parts = [word];
    if (this.amount() !== null && this.amount() !== undefined) parts.push(formatMoney(Math.abs(this.amount()!), this.currency()));
    if (this.percent() !== null && this.percent() !== undefined) parts.push(formatPercent(Math.abs(this.percent()!), { signed: false }));
    return parts.join(' ');
  });
}
