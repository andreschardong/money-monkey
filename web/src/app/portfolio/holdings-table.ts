import { Component, computed, inject, input, output } from '@angular/core';
import { MatTooltip } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { Auth } from '../core/auth';
import { FORMAT_PIPES } from '../core/format';
import { CashBalance, Currency, Holding, PortfolioSummary } from '../core/models';
import { Change } from '../shared/change';
import { SortHeader, TableSort } from '../shared/table-sort';

@Component({
  selector: 'app-holdings-table',
  imports: [RouterLink, MatTooltip, Change, SortHeader, ...FORMAT_PIPES],
  template: `
    @if (holdings().length === 0 && cash().length === 0) {
      <div class="empty">
        <p>No holdings yet. Record a buy, or a transfer in for shares you already own, and enter the cash in the account.</p>
        @if (!readonly()) {
          <div class="links">
            <button type="button" class="link" (click)="add.emit()">Add a transaction</button>
            <button type="button" class="link" (click)="editCash.emit(null)">Set cash balance</button>
          </div>
        }
      </div>
    } @else {
      <div class="scroll">
        <table class="data">
          <thead>
            <tr>
              <th appSort="symbol" [sort]="sort">Holding</th>
              <th class="right hide-s" appSort="quantity" [sort]="sort" defaultDirection="desc">Shares</th>
              <th class="right hide-m" appSort="averageCost" [sort]="sort" defaultDirection="desc">Average cost</th>
              <th class="right hide-s" appSort="price" [sort]="sort" defaultDirection="desc">Price</th>
              <th class="right" appSort="marketValue" [sort]="sort" defaultDirection="desc">Market value</th>
              @if (auth.showGains()) {
                <th class="right" appSort="unrealizedGain" [sort]="sort" defaultDirection="desc">Unrealized gain</th>
              }
              <th class="right hide-m" appSort="weight" [sort]="sort" defaultDirection="desc">Weight</th>
            </tr>
          </thead>
          <tbody>
            @for (h of sortedHoldings(); track h.securityId) {
              <tr class="clickable" (click)="open.emit(h.securityId)">
                <td>
                  <a class="ticker" [routerLink]="['holdings', h.securityId]" (click)="$event.stopPropagation()">{{ h.symbol }}</a>
                  <div class="name muted">{{ h.name }}</div>
                  <div class="compact muted">{{ h.quantity | qty }} shares at {{ h.price ?? h.averageCost | price: h.currency }}</div>
                </td>
                <td class="right num hide-s">{{ h.quantity | qty }}</td>
                <td class="right num hide-m">{{ h.averageCost | price: h.currency }}</td>
                <td class="right num hide-s">
                  @if (h.priceMissing) {
                    <span class="muted" matTooltip="No price yet; shown at cost">—</span>
                  } @else {
                    {{ h.price | price: h.currency }}
                    @if (auth.showGains()) {
                      <div class="small"><app-change [percent]="h.dayChangePercent" [showArrow]="false" /></div>
                    }
                  }
                </td>
                <td class="right num">
                  {{ h.marketValue | money: summary().baseCurrency }}
                  @if (h.currency !== summary().baseCurrency) {
                    <div class="small muted local">{{ h.marketValueLocal | money: h.currency }}</div>
                  }
                </td>
                @if (auth.showGains()) {
                  <td class="right">
                    <app-change [amount]="h.unrealizedGain" [currency]="summary().baseCurrency" [showArrow]="false" />
                    <div class="small"><app-change [percent]="h.unrealizedGainPercent" [showArrow]="false" /></div>
                  </td>
                }
                <td class="right num hide-m">{{ h.weight | pct: false : 1 }}</td>
              </tr>
            }
            @for (c of cash(); track c.currency) {
              <tr class="cash">
                <td>
                  <span class="cash-label">Cash</span>
                  <span class="currency-code">{{ c.currency }}</span>
                  @if (!readonly()) {
                    <button type="button" class="link edit" (click)="editCash.emit(c.currency)">Edit</button>
                  }
                  <div class="small muted">as of {{ c.asOf | day }}</div>
                </td>
                <td class="hide-s"></td>
                <td class="hide-m"></td>
                <td class="right num muted hide-s">
                  @if (c.currency !== summary().baseCurrency) {
                    <span [matTooltip]="'Exchange rate to ' + summary().baseCurrency">× {{ c.fxRate }}</span>
                  }
                </td>
                <td class="right num" [class.loss]="c.balance < 0">
                  {{ c.value | money: summary().baseCurrency }}
                  @if (c.currency !== summary().baseCurrency) {
                    <div class="small muted">{{ c.balance | money: c.currency }}</div>
                  }
                </td>
                @if (auth.showGains()) {
                  <td></td>
                }
                <td class="hide-m"></td>
              </tr>
            }
            @if (cash().length === 0) {
              <tr class="cash">
                <td [attr.colspan]="auth.showGains() ? 7 : 6">
                  <span class="cash-label">Cash</span>
                  <span class="muted">not entered yet.</span>
                  @if (!readonly()) {
                    <button type="button" class="link edit" (click)="editCash.emit(null)">Set cash balance</button>
                  }
                </td>
              </tr>
            }
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td class="hide-s"></td>
              <td class="hide-m"></td>
              <td class="hide-s"></td>
              <td class="right num">{{ summary().totalValue | money: summary().baseCurrency }}</td>
              @if (auth.showGains()) {
                <td class="right"><app-change [amount]="unrealized()" [currency]="summary().baseCurrency" [showArrow]="false" /></td>
              }
              <td class="hide-m"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    }
  `,
  styles: `
    :host { display: block; }
    .scroll { overflow-x: auto; }
    .ticker { color: var(--ink); font-size: 0.9375rem; text-decoration: none; }
    .ticker:hover { text-decoration: underline; }
    .name { max-width: 260px; overflow: hidden; font-size: 0.8125rem; text-overflow: ellipsis; white-space: nowrap; }
    .small { font-size: 0.8125rem; }
    .cash td { background: color-mix(in srgb, var(--wash) 55%, transparent); }
    .cash-label { margin-right: 8px; font-weight: 600; }
    .empty { display: grid; gap: 8px; justify-items: start; padding: 24px 4px; color: var(--ink-2); }
    .link { padding: 0; border: 0; background: none; color: var(--harbour-ink); font: inherit; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
    .links { display: flex; gap: 16px; }
    .edit { margin-left: 10px; font-size: 0.8125rem; }
    .compact { display: none; font-size: 0.8125rem; }
    @media (max-width: 900px) { .hide-m { display: none; } }
    @media (max-width: 600px) {
      .hide-s, .local { display: none; }
      .compact { display: block; }
      .name { max-width: 130px; }
      table.data th, table.data td { padding-left: 6px; padding-right: 6px; }
    }
  `,
})
export class HoldingsTable {
  readonly holdings = input.required<Holding[]>();
  readonly cash = input.required<CashBalance[]>();
  readonly summary = input.required<PortfolioSummary>();
  readonly unrealized = input.required<number>();
  /** True for a portfolio shared to view: no cash editing or adding. */
  readonly readonly = input(false);
  readonly open = output<string>();
  readonly add = output<void>();
  readonly editCash = output<Currency | null>();

  protected readonly auth = inject(Auth);
  protected readonly sort = new TableSort({ key: 'marketValue', direction: 'desc' });
  protected readonly sortedHoldings = computed(() => this.sort.apply(this.holdings(), {
    symbol: h => h.symbol,
    quantity: h => h.quantity,
    averageCost: h => h.averageCost,
    price: h => h.price,
    marketValue: h => h.marketValue,
    unrealizedGain: h => h.unrealizedGain,
    weight: h => h.weight,
  }));
}
