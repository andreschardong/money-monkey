import { Component, computed, inject, input, model, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { catchError, debounceTime, distinctUntilChanged, map, of, startWith, switchMap } from 'rxjs';
import { Api, problemMessage } from '../core/api';
import { AssetType, Currency, Holding, SymbolMatch } from '../core/models';

export interface PickedSecurity {
  securityId: string;
  symbol: string;
  name: string;
  currency: Currency;
  exchange: string | null;
}

interface Option {
  symbol: string;
  name: string;
  exchange: string | null;
  assetType: AssetType;
  securityId: string | null;
  currency: Currency | null;
}

/** Search across exchanges, with the portfolio's own holdings offered first. */
@Component({
  selector: 'app-security-picker',
  imports: [FormsModule, MatAutocompleteModule, MatFormFieldModule, MatInputModule, MatIcon, MatProgressSpinner],
  template: `
    <mat-form-field>
      <mat-label>{{ label() }}</mat-label>
      <mat-icon matPrefix svgIcon="search" class="prefix" />
      <input
        matInput
        [ngModel]="text()"
        (ngModelChange)="onType($event)"
        [matAutocomplete]="auto"
        [disabled]="disabled()"
        placeholder="Symbol or company, e.g. SHOP.TO or Apple"
        autocomplete="off"
        spellcheck="false">
      @if (resolving()) {
        <mat-spinner matSuffix diameter="18" />
      }
      @if (value(); as v) {
        <mat-hint>{{ v.name }}{{ v.exchange ? ' on ' + v.exchange : '' }}, priced in {{ v.currency }}</mat-hint>
      }
      @if (error()) {
        <mat-hint class="error">{{ error() }}</mat-hint>
      }
    </mat-form-field>

    <mat-autocomplete #auto="matAutocomplete" (optionSelected)="choose($event)" [hideSingleSelectionIndicator]="true">
      @if (ownOptions().length) {
        <mat-optgroup label="Your holdings">
          @for (o of ownOptions(); track o.symbol) {
            <mat-option [value]="o">
              <span class="sym">{{ o.symbol }}</span><span class="nm">{{ o.name }}</span><span class="ex">{{ o.exchange }}</span>
            </mat-option>
          }
        </mat-optgroup>
      }
      @if (searchOptions().length) {
        <mat-optgroup label="Search results">
          @for (o of searchOptions(); track o.symbol) {
            <mat-option [value]="o">
              <span class="sym">{{ o.symbol }}</span><span class="nm">{{ o.name }}</span><span class="ex">{{ o.exchange }}</span>
            </mat-option>
          }
        </mat-optgroup>
      }
    </mat-autocomplete>
  `,
  styles: `
    :host { display: block; }
    .prefix { width: 20px; height: 20px; margin: 0 4px 0 10px; color: var(--ink-3); }
    .error { color: var(--loss); }
    .sym { display: inline-block; min-width: 84px; font-stretch: 80%; font-weight: 700; }
    .nm { color: var(--ink-2); }
    .ex { margin-left: 8px; color: var(--ink-3); font-size: 0.8125rem; }
  `,
})
export class SecurityPicker {
  private readonly api = inject(Api);

  readonly label = input('Stock or fund');
  readonly holdings = input<Holding[]>([]);
  readonly disabled = input(false);
  readonly value = model<PickedSecurity | null>(null);

  protected readonly query = signal('');
  protected readonly resolving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly text = computed(() => this.query() || this.value()?.symbol || '');

  private readonly results = toSignal(
    toObservable(this.query).pipe(
      debounceTime(250),
      map(q => q.trim()),
      distinctUntilChanged(),
      switchMap(q => (q.length < 1
        ? of([] as SymbolMatch[])
        : this.api.searchSecurities(q).pipe(startWith([] as SymbolMatch[]), catchError(() => of([] as SymbolMatch[])))))),
    { initialValue: [] as SymbolMatch[] });

  protected readonly ownOptions = computed<Option[]>(() => {
    const q = this.query().trim().toLowerCase();
    return this.holdings()
      .filter(h => !q || h.symbol.toLowerCase().includes(q) || h.name.toLowerCase().includes(q))
      .map(h => ({ symbol: h.symbol, name: h.name, exchange: h.exchange, assetType: h.assetType, securityId: h.securityId, currency: h.currency }));
  });

  protected readonly searchOptions = computed<Option[]>(() => {
    const own = new Set(this.ownOptions().map(o => o.symbol));
    return this.results()
      .filter(r => !own.has(r.symbol))
      .map(r => ({ ...r, currency: null }));
  });

  protected onType(text: string): void {
    this.query.set(text);
    this.error.set(null);
    if (this.value() && text !== this.value()!.symbol) {
      this.value.set(null);
    }
  }

  private pick = 0;

  protected async choose(event: MatAutocompleteSelectedEvent): Promise<void> {
    const option = event.option.value as Option;
    const pick = ++this.pick;
    this.query.set('');
    if (option.securityId && option.currency) {
      this.value.set({ securityId: option.securityId, symbol: option.symbol, name: option.name, currency: option.currency, exchange: option.exchange });
      return;
    }

    // New to Money Monkey: look it up, which also stores its currency and recent prices.
    this.resolving.set(true);
    try {
      const security = await this.api.resolveSecurity(option.symbol, null);
      if (pick === this.pick) {
        this.value.set({ securityId: security.id, symbol: security.symbol, name: security.name, currency: security.currency, exchange: security.exchange });
      }
    } catch (error) {
      if (pick === this.pick) {
        this.value.set(null);
        this.query.set(option.symbol);
        this.error.set(problemMessage(error));
      }
    } finally {
      if (pick === this.pick) {
        this.resolving.set(false);
      }
    }
  }
}
