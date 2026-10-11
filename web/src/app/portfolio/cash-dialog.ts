import { Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Api, problemMessage } from '../core/api';
import { FORMAT_PIPES, fromIsoDate, toIsoDate } from '../core/format';
import { CashBalance, CashEntry, Currency, PORTFOLIO_CURRENCIES } from '../core/models';

export interface CashDialogData {
  portfolioId: string;
  baseCurrency: Currency;
  balances: CashBalance[];
  currency?: Currency;
}

const EXTRA_CURRENCIES: readonly Currency[] = ['GBP', 'CHF', 'JPY', 'AUD'];

/**
 * Cash is an asset you enter, not something worked out from trades: type the balance from your statement, per
 * currency, and the date it was true. Earlier entries stay so the chart knows what you held on past days.
 */
@Component({
  selector: 'app-cash-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatDatepickerModule, MatIcon, ...FORMAT_PIPES],
  template: `
    <h2 mat-dialog-title>Cash balance</h2>
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <mat-dialog-content>
        <p class="intro">
          Enter the cash in the account as it appears on your statement. Buys, sells and dividends don't change it;
          you update it whenever it changes.
        </p>
        <div class="grid">
          <mat-form-field>
            <mat-label>Currency</mat-label>
            <mat-select formControlName="currency">
              @for (c of currencies(); track c) {
                <mat-option [value]="c">{{ c }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Balance</mat-label>
            <input matInput type="number" formControlName="balance" step="any" inputmode="decimal" cdkFocusInitial>
            <span matTextSuffix>{{ form.controls.currency.value }}</span>
          </mat-form-field>
          <mat-form-field>
            <mat-label>As of</mat-label>
            <input matInput [matDatepicker]="picker" formControlName="date" [max]="today">
            <mat-datepicker-toggle matIconSuffix [for]="picker" />
            <mat-datepicker #picker />
          </mat-form-field>
        </div>
        <mat-form-field>
          <mat-label>Note (optional)</mat-label>
          <input matInput formControlName="note" maxlength="200" placeholder="Statement of Sep 30">
        </mat-form-field>

        @if (entriesForCurrency(); as entries) {
          @if (entries.length) {
            <h3>Earlier {{ form.controls.currency.value }} balances</h3>
            <ul class="entries">
              @for (e of entries; track e.date) {
                <li>
                  <span class="num">{{ e.date | day }}</span>
                  <span class="num amount">{{ e.balance | money: e.currency }}</span>
                  <span class="muted note">{{ e.note }}</span>
                  <button mat-icon-button type="button" (click)="remove(e)" [attr.aria-label]="'Remove the balance of ' + (e.date | day)">
                    <mat-icon svgIcon="delete" />
                  </button>
                </li>
              }
            </ul>
          }
        }

        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" [mat-dialog-close]="changed()">Close</button>
        <button mat-flat-button type="submit" [disabled]="saving()">Save balance</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    mat-dialog-content { display: grid; gap: 12px; width: min(560px, 86vw); max-width: 100%; }
    .intro { max-width: 60ch; color: var(--ink-2); font-size: 0.9375rem; line-height: 1.5; }
    .grid { display: grid; grid-template-columns: 120px minmax(0, 1fr) 170px; gap: 12px; }
    h3 { margin-top: 8px; font-size: 0.9375rem; }
    .entries { display: grid; margin: 0; padding: 0; list-style: none; }
    .entries li { display: grid; grid-template-columns: 110px 140px minmax(0, 1fr) 40px; align-items: center; gap: 12px; padding: 4px 0; border-top: 1px solid var(--rule); font-size: 0.875rem; }
    .amount { text-align: right; }
    .note { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .error { color: var(--loss); }
    @media (max-width: 560px) { .grid { grid-template-columns: 1fr 1fr; } }
    @media (max-width: 480px) {
      mat-dialog-content { width: auto; }
      .grid { grid-template-columns: 1fr; }
      .entries li { grid-template-columns: minmax(0, 1fr) auto 40px; }
      .note { display: none; }
    }
  `,
})
export class CashDialog {
  private readonly api = inject(Api);
  private readonly ref = inject<MatDialogRef<CashDialog, boolean>>(MatDialogRef);
  protected readonly data = inject<CashDialogData>(MAT_DIALOG_DATA);

  protected readonly today = new Date();
  protected readonly saving = signal(false);
  protected readonly changed = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly entries = signal<CashEntry[] | null>(null);

  protected readonly form = new FormGroup({
    currency: new FormControl<Currency>(this.data.currency ?? this.data.baseCurrency, { nonNullable: true }),
    balance: new FormControl<number | null>(this.data.balances.find(b => b.currency === (this.data.currency ?? this.data.baseCurrency))?.balance ?? null),
    date: new FormControl<Date>(new Date(), { nonNullable: true }),
    note: new FormControl('', { nonNullable: true }),
  });

  private readonly selectedCurrency = signal<Currency>(this.form.controls.currency.value);

  protected readonly currencies = computed(() => {
    const set = new Set<Currency>([this.data.baseCurrency, ...PORTFOLIO_CURRENCIES, ...this.data.balances.map(b => b.currency), ...EXTRA_CURRENCIES]);
    return [...set];
  });

  protected readonly entriesForCurrency = computed(() =>
    this.entries()?.filter(e => e.currency === this.selectedCurrency()).sort((a, b) => b.date.localeCompare(a.date)) ?? null);

  constructor() {
    this.form.controls.currency.valueChanges.subscribe(currency => {
      this.selectedCurrency.set(currency);
      const current = this.data.balances.find(b => b.currency === currency);
      this.form.controls.balance.setValue(current?.balance ?? null);
    });
    void this.load();
  }

  protected async save(): Promise<void> {
    const { currency, balance, date, note } = this.form.getRawValue();
    if (balance === null || Number.isNaN(balance)) {
      this.error.set('Enter the balance.');
      return;
    }
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      this.error.set('Enter a valid date.');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.api.setCash(this.data.portfolioId, { currency, balance, date: toIsoDate(date), note: note.trim() || null });
      this.changed.set(true);
      this.ref.close(true);
    } catch (error) {
      this.error.set(problemMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(entry: CashEntry): Promise<void> {
    try {
      await this.api.deleteCash(this.data.portfolioId, entry.currency, entry.date);
      this.changed.set(true);
      await this.load();
    } catch (error) {
      this.error.set(problemMessage(error));
    }
  }

  private async load(): Promise<void> {
    try {
      this.entries.set(await this.api.cashEntries(this.data.portfolioId));
    } catch {
      this.entries.set([]);
    }
  }

  /** Lets a caller preselect the as-of date, e.g. when correcting an older statement. */
  protected useDate(iso: string): void {
    this.form.controls.date.setValue(fromIsoDate(iso));
  }
}
