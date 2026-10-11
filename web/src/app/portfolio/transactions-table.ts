import { Component, computed, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { FORMAT_PIPES, formatMoney, formatPrice, formatQuantity, TRANSACTION_LABELS } from '../core/format';
import { Transaction, TransactionType } from '../core/models';
import { SortHeader, TableSort } from '../shared/table-sort';

const ICONS: Record<TransactionType, string> = {
  Buy: 'shopping_cart',
  Sell: 'sell',
  Split: 'call_split',
  Deposit: 'south',
  Withdrawal: 'north',
  Dividend: 'payments',
  Interest: 'savings',
  Fee: 'receipt_long',
  TransferIn: 'login',
};

/** Every transaction, newest first, with a quick text filter. */
@Component({
  selector: 'app-transactions-table',
  imports: [MatButtonModule, MatIcon, MatMenuModule, SortHeader, ...FORMAT_PIPES],
  template: `
    <div class="filter">
      <label class="search">
        <mat-icon svgIcon="search" aria-hidden="true" />
        <input type="search" placeholder="Filter by symbol, type or note" [value]="query()" (input)="query.set($any($event.target).value)" aria-label="Filter transactions">
      </label>
      <span class="count muted">{{ filtered().length }} of {{ transactions().length }}</span>
    </div>

    @if (filtered().length === 0) {
      <p class="empty muted">{{ transactions().length ? 'No transactions match the filter.' : 'No transactions yet.' }}</p>
    } @else {
      <div class="scroll">
        <table class="data">
          <thead>
            <tr>
              <th appSort="date" [sort]="sort" defaultDirection="desc">Date</th>
              <th class="hide-s" appSort="type" [sort]="sort">Type</th>
              <th appSort="symbol" [sort]="sort">Details</th>
              <th class="right" appSort="total" [sort]="sort" defaultDirection="desc">Total</th>
              <th><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (t of sorted(); track t.id) {
              <tr>
                <td class="num date">{{ t.date | day }}</td>
                <td class="hide-s">
                  <span class="type"><mat-icon [svgIcon]="icon(t.type)" aria-hidden="true" />{{ t.type | txLabel }}</span>
                </td>
                <td class="details">
                  <span class="type-inline">{{ t.type | txLabel }}</span>
                  @if (t.symbol) {
                    <span class="ticker">{{ t.symbol }}</span>
                  }
                  <span>{{ describe(t) }}</span>
                  @if (t.note) {
                    <div class="note muted">{{ t.note }}</div>
                  }
                </td>
                <td class="right num">
                  @if (t.total !== 0) {
                    {{ t.total | money: t.currency }}
                  } @else {
                    <span class="muted">—</span>
                  }
                </td>
                <td class="right actions">
                  @if (!readonly()) {
                    <button mat-icon-button [matMenuTriggerFor]="menu" [attr.aria-label]="'Actions for ' + (t.type | txLabel) + ' on ' + (t.date | day)">
                      <mat-icon svgIcon="more_vert" />
                    </button>
                    <mat-menu #menu="matMenu" xPosition="before">
                      <button mat-menu-item (click)="edit.emit(t)"><mat-icon svgIcon="edit" />Edit</button>
                      <button mat-menu-item (click)="remove.emit(t)"><mat-icon svgIcon="delete" />Delete</button>
                    </mat-menu>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styles: `
    :host { display: block; }
    .filter { display: flex; align-items: center; gap: 16px; margin: 4px 0 8px; }
    .search {
      display: flex; flex: 0 1 360px; align-items: center; gap: 8px; padding: 6px 12px;
      border: 1px solid var(--rule-strong); border-radius: 999px; background: var(--card);
      mat-icon { width: 18px; height: 18px; color: var(--ink-3); }
      input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--ink); font: inherit; font-size: 0.875rem; }
      &:focus-within { border-color: var(--harbour); }
    }
    .count { font-size: 0.8125rem; }
    .scroll { overflow-x: auto; }
    .date { color: var(--ink-2); white-space: nowrap; }
    .type-inline { display: none; margin-right: 6px; padding: 1px 6px; border-radius: 999px; background: var(--wash, rgba(0, 0, 0, 0.06)); color: var(--ink-2); font-size: 0.75rem; font-weight: 600; }
    @media (max-width: 599px) { .type-inline { display: inline-block; } }
    .type { display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; mat-icon { width: 18px; height: 18px; color: var(--ink-3); } }
    .details .ticker { margin-right: 8px; }
    .note { max-width: 360px; overflow: hidden; font-size: 0.8125rem; text-overflow: ellipsis; white-space: nowrap; }
    .actions { width: 48px; padding-top: 2px; padding-bottom: 2px; }
    .empty { padding: 20px 4px; }
  `,
})
export class TransactionsTable {
  readonly transactions = input.required<Transaction[]>();
  /** True for a portfolio shared to view: no edit or delete. */
  readonly readonly = input(false);
  readonly edit = output<Transaction>();
  readonly remove = output<Transaction>();

  protected readonly query = signal('');

  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) {
      return this.transactions();
    }
    return this.transactions().filter(t =>
      (t.symbol ?? '').toLowerCase().includes(q) ||
      (t.securityName ?? '').toLowerCase().includes(q) ||
      TRANSACTION_LABELS[t.type].toLowerCase().includes(q) ||
      (t.note ?? '').toLowerCase().includes(q) ||
      t.currency.toLowerCase().includes(q));
  });

  protected readonly sort = new TableSort({ key: 'date', direction: 'desc' });
  protected readonly sorted = computed(() => this.sort.apply(this.filtered(), {
    date: t => t.date + t.createdAt,
    type: t => TRANSACTION_LABELS[t.type],
    symbol: t => t.symbol ?? '',
    total: t => t.total,
  }));

  protected icon(type: TransactionType): string {
    return ICONS[type];
  }

  protected describe(t: Transaction): string {
    switch (t.type) {
      case 'Buy':
      case 'Sell':
        return `${formatQuantity(t.quantity)} at ${formatPrice(t.price, t.currency)}` +
          (t.fee ? `, ${formatMoney(t.fee, t.currency)} commission` : '');
      case 'TransferIn':
        return `${formatQuantity(t.quantity)} at a cost of ${formatPrice(t.price, t.currency)}`;
      case 'Split':
        return `${formatQuantity(t.splitFrom)} share${t.splitFrom === 1 ? '' : 's'} became ${formatQuantity(t.splitTo)}`;
      case 'Dividend':
        return t.fee ? `${formatMoney(t.amount, t.currency)} less ${formatMoney(t.fee, t.currency)} withheld` : formatMoney(t.amount, t.currency);
      default:
        return t.currency;
    }
  }
}
