import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Api, problemMessage } from '../core/api';
import { toIsoDate } from '../core/format';
import { AssetType, Currency, Security } from '../core/models';

export interface ManualSecurityDialogData {
  /** When set, only a new price for this security is asked for. */
  security?: Security;
}

const CURRENCIES: readonly Currency[] = ['CAD', 'USD', 'EUR', 'GBP', 'CHF', 'JPY', 'AUD'];
const TYPES: readonly { value: AssetType; label: string }[] = [
  { value: 'Fund', label: 'Fund' },
  { value: 'Stock', label: 'Stock' },
  { value: 'Etf', label: 'ETF' },
  { value: 'Crypto', label: 'Crypto' },
  { value: 'Other', label: 'Other (GIC, bond, private)' },
];

/** For holdings Yahoo Finance doesn't quote: GICs, private funds, some mutual funds. */
@Component({
  selector: 'app-manual-security-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatDatepickerModule],
  template: `
    <h2 mat-dialog-title>{{ security ? 'Update ' + word + ' of ' + security.symbol : 'Add a manually priced security' }}</h2>
    <form [formGroup]="form" (ngSubmit)="save()">
      <mat-dialog-content>
        @if (!security) {
          <p class="intro">Use this for holdings without a market quote. You update the price yourself.</p>
          <div class="grid">
            <mat-form-field>
              <mat-label>Short name or code</mat-label>
              <input matInput formControlName="symbol" maxlength="32" placeholder="GIC-2027">
            </mat-form-field>
            <mat-form-field>
              <mat-label>Type</mat-label>
              <mat-select formControlName="assetType">
                @for (t of types; track t.value) {
                  <mat-option [value]="t.value">{{ t.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field class="wide">
              <mat-label>Name</mat-label>
              <input matInput formControlName="name" maxlength="200" placeholder="EQ Bank 2-year GIC">
            </mat-form-field>
            <mat-form-field>
              <mat-label>Currency</mat-label>
              <mat-select formControlName="currency">
                @for (c of currencies; track c) {
                  <mat-option [value]="c">{{ c }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          </div>
        }
        <div class="grid">
          <mat-form-field>
            <mat-label>{{ property ? 'Value' : 'Price per unit' }}</mat-label>
            <input matInput type="number" formControlName="price" min="0" step="any" inputmode="decimal">
          </mat-form-field>
          <mat-form-field>
            <mat-label>As of</mat-label>
            <input matInput [matDatepicker]="picker" formControlName="date" [max]="today">
            <mat-datepicker-toggle matIconSuffix [for]="picker" />
            <mat-datepicker #picker />
          </mat-form-field>
        </div>
        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="saving()">{{ security ? 'Save ' + word : 'Add security' }}</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    mat-dialog-content { display: grid; gap: 12px; width: min(520px, 86vw); }
    .intro { color: var(--ink-2); }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .wide { grid-column: 1 / -1; }
    .error { color: var(--loss); }
  `,
})
export class ManualSecurityDialog {
  private readonly api = inject(Api);
  private readonly ref = inject<MatDialogRef<ManualSecurityDialog, boolean>>(MatDialogRef);
  private readonly data = inject<ManualSecurityDialogData | null>(MAT_DIALOG_DATA, { optional: true });

  protected readonly security = this.data?.security;
  /** A property has a value, not a price per unit. */
  protected readonly property = this.security?.assetType === 'RealEstate';
  protected readonly word = this.property ? 'value' : 'price';
  protected readonly currencies = CURRENCIES;
  protected readonly types = TYPES;
  protected readonly today = new Date();
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = new FormGroup({
    symbol: new FormControl('', { nonNullable: true, validators: this.security ? [] : [Validators.required] }),
    name: new FormControl('', { nonNullable: true, validators: this.security ? [] : [Validators.required] }),
    currency: new FormControl<Currency>('CAD', { nonNullable: true }),
    assetType: new FormControl<AssetType>('Fund', { nonNullable: true }),
    price: new FormControl<number | null>(this.security?.lastPrice ?? null, [Validators.required, Validators.min(0.0000001)]),
    date: new FormControl<Date>(new Date(), { nonNullable: true }),
  });

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.error.set(this.security ? `Enter a ${this.word} greater than zero.` : 'Fill in the code, name and a price greater than zero.');
      return;
    }
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    try {
      if (this.security) {
        await this.api.setManualPrice(this.security.id, toIsoDate(v.date), v.price!);
      } else {
        await this.api.createManualSecurity(v.symbol.trim(), v.name.trim(), v.currency, v.assetType, v.price, toIsoDate(v.date));
      }
      this.ref.close(true);
    } catch (error) {
      this.error.set(problemMessage(error));
    } finally {
      this.saving.set(false);
    }
  }
}
