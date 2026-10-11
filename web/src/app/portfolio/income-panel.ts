import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FORMAT_PIPES } from '../core/format';
import { RealizedReport } from '../core/models';
import { SortHeader, TableSort } from '../shared/table-sort';

/** Realized gains (adjusted cost base, average cost) and income, by calendar year. */
@Component({
  selector: 'app-income-panel',
  imports: [RouterLink, SortHeader, ...FORMAT_PIPES],
  template: `
    @if (report().years.length === 0) {
      <p class="empty muted">Sales, dividends and interest will be summarized here by year.</p>
    } @else {
      <h3>By year</h3>
      <p class="caption">
        Gains use the adjusted cost base (average cost) in {{ report().currency }}, converted at each trade's exchange rate.
      </p>
      <div class="scroll">
        <table class="data">
          <thead>
            <tr>
              <th appSort="year" [sort]="yearSort" defaultDirection="desc">Year</th>
              <th class="right hide-s" appSort="proceeds" [sort]="yearSort" defaultDirection="desc">Proceeds</th>
              <th class="right hide-s" appSort="costBasis" [sort]="yearSort" defaultDirection="desc">Book value sold</th>
              <th class="right" appSort="gain" [sort]="yearSort" defaultDirection="desc">Realized gain</th>
              <th class="right" appSort="dividends" [sort]="yearSort" defaultDirection="desc">Dividends</th>
              <th class="right hide-s" appSort="interest" [sort]="yearSort" defaultDirection="desc">Interest</th>
              <th class="right hide-s" appSort="taxWithheld" [sort]="yearSort" defaultDirection="desc">Tax withheld</th>
            </tr>
          </thead>
          <tbody>
            @for (y of years(); track y.year) {
              <tr>
                <td class="num year">{{ y.year }}</td>
                <td class="right num hide-s">{{ y.proceeds | money: report().currency }}</td>
                <td class="right num hide-s">{{ y.costBasis | money: report().currency }}</td>
                <td class="right num" [class.gain]="y.gain > 0" [class.loss]="y.gain < 0">{{ y.gain | money: report().currency : true }}</td>
                <td class="right num">{{ y.dividends | money: report().currency }}</td>
                <td class="right num hide-s">{{ y.interest | money: report().currency }}</td>
                <td class="right num hide-s">{{ y.taxWithheld | money: report().currency }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      @if (report().sales.length) {
        <h3 class="sales-title">Sales</h3>
        <div class="scroll">
          <table class="data">
            <thead>
              <tr>
                <th class="date" appSort="date" [sort]="salesSort" defaultDirection="desc">Date</th>
                <th appSort="symbol" [sort]="salesSort">Security</th>
                <th class="right hide-s" appSort="quantity" [sort]="salesSort" defaultDirection="desc">Shares</th>
                <th class="right" appSort="proceeds" [sort]="salesSort" defaultDirection="desc">Proceeds</th>
                <th class="right hide-s" appSort="costBasis" [sort]="salesSort" defaultDirection="desc">Book value</th>
                <th class="right" appSort="gain" [sort]="salesSort" defaultDirection="desc">Gain</th>
              </tr>
            </thead>
            <tbody>
              @for (s of sales(); track s.transactionId) {
                <tr>
                  <td class="num date">{{ s.date | day }}</td>
                  <td><a class="ticker" [routerLink]="['holdings', s.securityId]">{{ s.symbol }}</a></td>
                  <td class="right num hide-s">{{ s.quantity | qty }}</td>
                  <td class="right num">{{ s.proceeds | money: report().currency }}</td>
                  <td class="right num hide-s">{{ s.costBasis | money: report().currency }}</td>
                  <td class="right num" [class.gain]="s.gain > 0" [class.loss]="s.gain < 0">{{ s.gain | money: report().currency : true }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    }
  `,
  styles: `
    :host { display: block; padding-top: 8px; }
    h3 { margin-top: 8px; }
    .sales-title { margin-top: 28px; }
    .caption { margin: 4px 0 8px; color: var(--ink-3); font-size: 0.8125rem; }
    .scroll { overflow-x: auto; }
    .year { font-weight: 600; }
    .ticker { color: var(--ink); text-decoration: none; }
    .empty { padding: 20px 4px; }
  `,
})
export class IncomePanel {
  readonly report = input.required<RealizedReport>();

  protected readonly yearSort = new TableSort({ key: 'year', direction: 'desc' });
  protected readonly years = computed(() => this.yearSort.apply(this.report().years, {
    year: y => y.year, proceeds: y => y.proceeds, costBasis: y => y.costBasis, gain: y => y.gain,
    dividends: y => y.dividends, interest: y => y.interest, taxWithheld: y => y.taxWithheld,
  }));

  protected readonly salesSort = new TableSort({ key: 'date', direction: 'desc' });
  protected readonly sales = computed(() => this.salesSort.apply(this.report().sales, {
    date: s => s.date, symbol: s => s.symbol, quantity: s => s.quantity, proceeds: s => s.proceeds, costBasis: s => s.costBasis, gain: s => s.gain,
  }));
}
