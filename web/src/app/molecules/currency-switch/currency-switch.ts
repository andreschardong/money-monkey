import { Component, input, output } from '@angular/core';
import { MatButtonToggleChange, MatButtonToggleModule } from '@angular/material/button-toggle';
import { Currency, PORTFOLIO_CURRENCIES } from '../../core/models';

/** The pill switch that restates a page's totals in CAD, USD or EUR. */
@Component({
  selector: 'app-currency-switch',
  imports: [MatButtonToggleModule],
  template: `
    <mat-button-toggle-group
      class="currency-switch"
      [value]="value()"
      (change)="select($event)"
      hideSingleSelectionIndicator
      aria-label="Show totals in"
    >
      @for (c of currencies; track c) {
        <mat-button-toggle [value]="c">{{ c }}</mat-button-toggle>
      }
    </mat-button-toggle-group>
  `,
  styles: `
    :host {
      display: inline-flex;
    }
    .currency-switch {
      --mat-button-toggle-height: 34px;
      --mat-button-toggle-shape: 999px;
      --mat-button-toggle-label-text-size: 0.8125rem;
      --mat-button-toggle-label-text-weight: 600;
      --mat-button-toggle-selected-state-background-color: var(--ink);
      --mat-button-toggle-selected-state-text-color: var(--paper);
      border-color: var(--rule-strong);
      font-stretch: 90%;
      letter-spacing: 0.04em;
    }
  `,
})
export class CurrencySwitch {
  readonly value = input.required<Currency>();
  readonly valueChange = output<Currency>();

  protected readonly currencies = PORTFOLIO_CURRENCIES;

  protected select(event: MatButtonToggleChange): void {
    this.valueChange.emit(event.value as Currency);
  }
}
