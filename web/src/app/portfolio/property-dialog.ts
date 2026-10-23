import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Api, problemMessage } from '../core/api';
import { toIsoDate } from '../core/format';
import { Currency } from '../core/models';

export interface PropertyDialogData {
  portfolioId: string;
  baseCurrency: Currency;
}

/**
 * A property is one holding priced by hand: what was paid on the purchase date, and what it is worth today. Its value
 * is updated later from the property's own page.
 */
@Component({
  selector: 'app-property-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatDatepickerModule],
  template: `
    <h2 mat-dialog-title>Add a property</h2>
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <mat-dialog-content>
        <p class="intro">Enter what you paid and what the property is worth now. You can update its value any time from its page.</p>
        <div class="grid">
          <mat-form-field>
            <mat-label>Short name</mat-label>
            <input matInput formControlName="name" maxlength="32" placeholder="Cottage">
            <mat-hint>Shown in lists, like a ticker</mat-hint>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Purchase date</mat-label>
            <input matInput [matDatepicker]="picker" formControlName="purchaseDate" [max]="today">
            <mat-datepicker-toggle matIconSuffix [for]="picker" />
            <mat-datepicker #picker />
          </mat-form-field>
          <mat-form-field class="wide">
            <mat-label>Address or description (optional)</mat-label>
            <input matInput formControlName="description" maxlength="200" placeholder="12 Lake Road, Muskoka">
          </mat-form-field>
          <mat-form-field>
            <mat-label>Purchase price</mat-label>
            <input matInput type="number" formControlName="purchasePrice" min="0" step="any" inputmode="decimal">
            <span matTextSuffix>{{ data.baseCurrency }}</span>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Closing costs (optional)</mat-label>
            <input matInput type="number" formControlName="closingCosts" min="0" step="any" inputmode="decimal" placeholder="0">
            <span matTextSuffix>{{ data.baseCurrency }}</span>
            <mat-hint>Land transfer tax, legal fees</mat-hint>
          </mat-form-field>
          <mat-form-field class="wide">
            <mat-label>Value today (optional)</mat-label>
            <input matInput type="number" formControlName="currentValue" min="0" step="any" inputmode="decimal">
            <span matTextSuffix>{{ data.baseCurrency }}</span>
            <mat-hint>An appraisal or a recent sale nearby. Left empty, the purchase price is used.</mat-hint>
          </mat-form-field>
        </div>
        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="saving()">Add property</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    mat-dialog-content { display: grid; gap: 12px; width: min(560px, 86vw); max-width: 100%; }
    .intro { max-width: 60ch; color: var(--ink-2); font-size: 0.9375rem; line-height: 1.5; }
    .grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; gap: 12px 16px; }
    .wide { grid-column: 1 / -1; }
    .error { color: var(--loss); }
    @media (max-width: 480px) {
      mat-dialog-content { width: auto; }
      .grid { grid-template-columns: minmax(0, 1fr); }
    }
  `,
})
export class PropertyDialog {
  private readonly api = inject(Api);
  private readonly ref = inject<MatDialogRef<PropertyDialog, boolean>>(MatDialogRef);
  protected readonly data = inject<PropertyDialogData>(MAT_DIALOG_DATA);

  protected readonly today = new Date();
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    description: new FormControl('', { nonNullable: true }),
    purchaseDate: new FormControl<Date | null>(null, [Validators.required]),
    purchasePrice: new FormControl<number | null>(null, [Validators.required, Validators.min(0.01)]),
    closingCosts: new FormControl<number | null>(null, [Validators.min(0)]),
    currentValue: new FormControl<number | null>(null, [Validators.min(0.01)]),
  });

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.error.set('Fill in a short name, the purchase date and a purchase price greater than zero.');
      return;
    }
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.api.addProperty(this.data.portfolioId, {
        name: v.name.trim(),
        description: v.description.trim() || null,
        purchaseDate: toIsoDate(v.purchaseDate!),
        purchasePrice: v.purchasePrice!,
        closingCosts: v.closingCosts,
        currentValue: v.currentValue,
      });
      this.ref.close(true);
    } catch (error) {
      this.error.set(problemMessage(error));
    } finally {
      this.saving.set(false);
    }
  }
}
