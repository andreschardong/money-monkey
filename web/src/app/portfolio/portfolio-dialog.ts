import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Api, problemMessage } from '../core/api';
import { Currency, PORTFOLIO_CURRENCIES, PortfolioSummary } from '../core/models';

export interface PortfolioDialogData {
  portfolio?: PortfolioSummary;
}

/** Create a portfolio, or rename an existing one. */
@Component({
  selector: 'app-portfolio-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatButtonModule, MatButtonToggleModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>{{ editing ? 'Edit portfolio' : 'New portfolio' }}</h2>
    <form [formGroup]="form" (ngSubmit)="save()">
      <mat-dialog-content>
        <mat-form-field>
          <mat-label>Name</mat-label>
          <input matInput formControlName="name" maxlength="100" placeholder="TFSA, RRSP, US margin…" cdkFocusInitial>
        </mat-form-field>

        <div class="currency">
          <span id="currency-label" class="label">Currency</span>
          <mat-button-toggle-group formControlName="baseCurrency" aria-labelledby="currency-label" hideSingleSelectionIndicator>
            @for (c of currencies; track c) {
              <mat-button-toggle [value]="c">{{ c }}</mat-button-toggle>
            }
          </mat-button-toggle-group>
          <p class="hint">
            @if (currencyLocked) {
              The currency is fixed once transactions are recorded.
            } @else {
              Totals, book value and gains are reported in this currency. The portfolio can still hold cash and
              stocks in other currencies.
            }
          </p>
        </div>

        <mat-form-field>
          <mat-label>Description (optional)</mat-label>
          <textarea matInput formControlName="description" rows="2" maxlength="500"></textarea>
        </mat-form-field>

        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="saving()">{{ editing ? 'Save changes' : 'Create portfolio' }}</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    mat-dialog-content { display: grid; gap: 16px; width: min(440px, 80vw); }
    .currency { display: grid; gap: 8px; }
    .label { color: var(--ink-2); font-size: 0.8125rem; }
    .hint { color: var(--ink-3); font-size: 0.8125rem; max-width: 52ch; }
    .error { color: var(--loss); }
    mat-button-toggle-group { width: fit-content; }
  `,
})
export class PortfolioDialog {
  private readonly api = inject(Api);
  private readonly ref = inject<MatDialogRef<PortfolioDialog, PortfolioSummary>>(MatDialogRef);
  private readonly data = inject<PortfolioDialogData | null>(MAT_DIALOG_DATA, { optional: true });

  protected readonly currencies = PORTFOLIO_CURRENCIES;
  protected readonly editing = !!this.data?.portfolio;
  protected readonly currencyLocked = (this.data?.portfolio?.transactionsCount ?? 0) > 0;
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = new FormGroup({
    name: new FormControl(this.data?.portfolio?.name ?? '', { nonNullable: true, validators: [Validators.required, Validators.maxLength(100)] }),
    baseCurrency: new FormControl<Currency>({ value: this.data?.portfolio?.baseCurrency ?? 'CAD', disabled: this.currencyLocked }, { nonNullable: true }),
    description: new FormControl(this.data?.portfolio?.description ?? '', { nonNullable: true }),
  });

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Give the portfolio a name.');
      return;
    }

    const { name, baseCurrency, description } = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    try {
      const saved = this.editing
        ? await this.api.updatePortfolio(this.data!.portfolio!.id, name.trim(), baseCurrency, description.trim() || null)
        : await this.api.createPortfolio(name.trim(), baseCurrency, description.trim() || null);
      this.ref.close(saved);
    } catch (error) {
      this.error.set(problemMessage(error));
    } finally {
      this.saving.set(false);
    }
  }
}
