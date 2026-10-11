import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { startWith } from 'rxjs';
import { Api, problemMessage } from '../core/api';
import { formatDate, formatMoney, formatPrice, formatQuantity, formatRate, fromIsoDate, toIsoDate } from '../core/format';
import { Currency, FxRates, Holding, IsoDate, PORTFOLIO_CURRENCIES, Transaction, TransactionRequest, TransactionType } from '../core/models';
import { PickedSecurity, SecurityPicker } from './security-picker';

export interface TransactionPreset {
  type: TransactionType;
  security?: PickedSecurity;
  date?: IsoDate;
  quantity?: number;
  price?: number;
  amount?: number;
  fee?: number;
  currency?: Currency;
  splitFrom?: number;
  splitTo?: number;
  note?: string;
}

export interface TransactionDialogData {
  portfolioId: string;
  baseCurrency: Currency;
  holdings: Holding[];
  cashCurrencies: Currency[];
  transaction?: Transaction;
  preset?: TransactionPreset;
}

export interface TransactionDialogResult {
  message: string;
}

type Kind = 'trade' | 'split' | 'dividend' | 'cash';

const TYPES: readonly { type: TransactionType; label: string; icon: string }[] = [
  { type: 'Buy', label: 'Buy', icon: 'shopping_cart' },
  { type: 'Sell', label: 'Sell', icon: 'sell' },
  { type: 'Dividend', label: 'Dividend', icon: 'payments' },
  { type: 'Deposit', label: 'Deposit', icon: 'south' },
  { type: 'Withdrawal', label: 'Withdrawal', icon: 'north' },
  { type: 'Split', label: 'Split', icon: 'call_split' },
  { type: 'Interest', label: 'Interest', icon: 'savings' },
  { type: 'Fee', label: 'Fee', icon: 'receipt_long' },
  { type: 'TransferIn', label: 'Transfer in', icon: 'login' },
];

const ACTION: Record<TransactionType, [button: string, done: string]> = {
  Buy: ['Record buy', 'Buy recorded.'],
  Sell: ['Record sale', 'Sale recorded.'],
  Dividend: ['Record dividend', 'Dividend recorded.'],
  Deposit: ['Record deposit', 'Deposit recorded.'],
  Withdrawal: ['Record withdrawal', 'Withdrawal recorded.'],
  Split: ['Record split', 'Split recorded.'],
  Interest: ['Record interest', 'Interest recorded.'],
  Fee: ['Record fee', 'Fee recorded.'],
  TransferIn: ['Record transfer', 'Transfer recorded.'],
};

function kindOf(type: TransactionType): Kind {
  switch (type) {
    case 'Buy':
    case 'Sell':
    case 'TransferIn':
      return 'trade';
    case 'Split':
      return 'split';
    case 'Dividend':
      return 'dividend';
    default:
      return 'cash';
  }
}

@Component({
  selector: 'app-transaction-dialog',
  imports: [
    ReactiveFormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatDatepickerModule, MatCheckboxModule, MatIcon, SecurityPicker,
  ],
  templateUrl: './transaction-dialog.html',
  styleUrl: './transaction-dialog.scss',
})
export class TransactionDialog {
  private readonly api = inject(Api);
  private readonly ref = inject<MatDialogRef<TransactionDialog, TransactionDialogResult>>(MatDialogRef);
  protected readonly data = inject<TransactionDialogData>(MAT_DIALOG_DATA);

  protected readonly types = TYPES;
  protected readonly base = this.data.baseCurrency;
  protected readonly editing = !!this.data.transaction;
  protected readonly maxDate = new Date();

  private readonly start = this.initialValues();
  protected readonly type = signal<TransactionType>(this.start.type);
  protected readonly security = signal<PickedSecurity | null>(this.start.security ?? null);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly fx = signal<FxRates | null>(null);
  private readonly priceOn = signal<{ date: IsoDate | null; close: number | null; symbol: string } | null>(null);

  // A value the user typed is never overwritten by a looked-up one.
  private priceEdited = this.editing || this.data.preset?.price !== undefined;
  private fxKey: string | null = null;
  private fxEdited = this.editing;
  private currencyEdited = this.editing || this.data.preset?.currency !== undefined;

  protected readonly form = new FormGroup({
    date: new FormControl<Date>(fromIsoDate(this.start.date), { nonNullable: true }),
    quantity: new FormControl<number | null>(this.start.quantity ?? null),
    price: new FormControl<number | null>(this.start.price ?? null),
    fee: new FormControl<number | null>(this.start.fee ?? null),
    amount: new FormControl<number | null>(this.start.amount ?? null),
    currency: new FormControl<Currency>(this.start.currency ?? this.base, { nonNullable: true }),
    splitFrom: new FormControl<number | null>(this.start.splitFrom ?? 1),
    splitTo: new FormControl<number | null>(this.start.splitTo ?? null),
    fxRate: new FormControl<number | null>(this.start.fxRate ?? null),
    note: new FormControl<string>(this.start.note ?? '', { nonNullable: true }),
  });

  protected readonly values = toSignal(this.form.valueChanges.pipe(startWith(null)), { initialValue: null });
  private readonly raw = computed(() => {
    this.values();
    return this.form.getRawValue();
  });

  protected readonly kind = computed(() => kindOf(this.type()));
  /** Null while the date field is empty or holds text that isn't a date. */
  protected readonly dateIso = computed(() => {
    const date = this.raw().date as Date | null;
    return date instanceof Date && !Number.isNaN(date.getTime()) ? toIsoDate(date) : null;
  });
  protected readonly needsSecurity = computed(() => ['trade', 'split', 'dividend'].includes(this.kind()));

  /** The currency the cash moves in. */
  protected readonly currency = computed<Currency>(() => {
    const kind = this.kind();
    if (kind === 'trade' || kind === 'split') {
      return this.security()?.currency ?? this.base;
    }
    return this.raw().currency;
  });

  protected readonly showFxRate = computed(() =>
    (this.kind() === 'trade' || this.kind() === 'dividend' || this.kind() === 'cash') && this.currency() !== this.base);

  protected readonly currencyOptions = computed(() => {
    const set = new Set<Currency>([...PORTFOLIO_CURRENCIES, ...this.data.cashCurrencies]);
    const security = this.security();
    if (security) {
      set.add(security.currency);
    }
    return [...set];
  });

  protected readonly held = computed(() => {
    const id = this.security()?.securityId;
    return id ? this.data.holdings.find(h => h.securityId === id) ?? null : null;
  });

  protected readonly pickerHoldings = computed(() => this.data.holdings);
  protected readonly actionLabel = computed(() => (this.editing ? 'Save changes' : ACTION[this.type()][0]));

  protected readonly priceHint = computed(() => {
    const info = this.priceOn();
    if (!info || info.close === null || info.symbol !== this.security()?.symbol) {
      return '';
    }
    return `Close on ${formatDate(info.date)}: ${formatPrice(info.close, this.currency())}`;
  });

  /** Units of the base currency per unit of a currency, from the day's published rates. */
  private rateToBase(currency: Currency, rates: FxRates | null): number | null {
    if (!rates) {
      return null;
    }
    const cad = (c: Currency) => rates.rates.find(r => r.from === c)?.rate ?? null;
    const from = cad(currency);
    const to = cad(this.base);
    return from && to ? from / to : null;
  }

  /** The published rates, but only once they are the rates for the chosen day. */
  private readonly ratesForDate = computed(() => {
    const rates = this.fx();
    return rates && rates.date === this.dateIso() ? rates : null;
  });

  protected readonly fxHint = computed(() => {
    const rates = this.ratesForDate();
    const published = this.rateToBase(this.currency(), rates);
    if (!rates?.ratesDate || published === null) {
      return 'Leave it empty to use the Bank of Canada rate for that day.';
    }
    return `Bank of Canada, ${formatDate(rates.ratesDate, 'short')}: ${formatRate(published)}. Use your broker's rate if you have it.`;
  });

  protected readonly summary = computed<{ label: string; value: string; extra?: string } | null>(() => {
    const raw = this.raw();
    const currency = this.currency();
    const rate = raw.fxRate && raw.fxRate > 0 ? raw.fxRate : null;
    const inBase = (amount: number) =>
      currency !== this.base && rate ? `about ${formatMoney(amount * rate, this.base)}` : undefined;

    switch (this.type()) {
      case 'Buy': {
        if (!raw.quantity || raw.price === null) return null;
        const total = raw.quantity * raw.price + (raw.fee ?? 0);
        return { label: 'Total cost', value: formatMoney(total, currency), extra: inBase(total) };
      }
      case 'Sell': {
        if (!raw.quantity || raw.price === null) return null;
        const total = raw.quantity * raw.price - (raw.fee ?? 0);
        return { label: 'Proceeds', value: formatMoney(total, currency), extra: inBase(total) };
      }
      case 'TransferIn': {
        if (!raw.quantity || raw.price === null) return null;
        const total = raw.quantity * raw.price;
        return { label: 'Book value', value: formatMoney(total, currency), extra: inBase(total) };
      }
      case 'Dividend': {
        if (!raw.amount) return null;
        const net = raw.amount - (raw.fee ?? 0);
        return { label: 'Received', value: formatMoney(net, currency), extra: raw.fee ? `after ${formatMoney(raw.fee, currency)} withheld` : inBase(net) };
      }
      case 'Split': {
        if (!raw.splitFrom || !raw.splitTo) return null;
        const held = this.held();
        const example = held ? `${formatQuantity(held.quantity)} shares today would become ${formatQuantity(held.quantity * raw.splitTo / raw.splitFrom)}` : undefined;
        return { label: 'Ratio', value: `${formatQuantity(raw.splitFrom)} becomes ${formatQuantity(raw.splitTo)}`, extra: example };
      }
      default: {
        if (!raw.amount) return null;
        return { label: 'Amount', value: formatMoney(raw.amount, currency), extra: inBase(raw.amount) };
      }
    }
  });

  constructor() {
    // Published rates for the chosen day: used for the rate field and the conversion helper.
    effect(() => {
      const date = this.dateIso();
      if (!date) {
        return;
      }
      void this.api.fxRates(date).then(rates => {
        if (date === untracked(this.dateIso)) {
          this.fx.set(rates);
        }
      }).catch(() => this.fx.set(null));
    });

    // Fill the rate to the base currency unless the user typed one. A typed (or stored) rate belongs to its date and
    // currency: when either changes, the field is cleared and refilled with the published rate for the new pair.
    effect(() => {
      const show = this.showFxRate();
      const key = `${this.currency()}|${this.dateIso()}`;
      const rate = this.rateToBase(this.currency(), this.ratesForDate());
      untracked(() => {
        if (this.fxKey !== null && key !== this.fxKey) {
          this.fxEdited = false;
          this.form.controls.fxRate.setValue(null, { emitEvent: false });
        }
        this.fxKey = key;
        if (!show) {
          this.form.controls.fxRate.setValue(null, { emitEvent: false });
        } else if (!this.fxEdited && rate !== null) {
          this.form.controls.fxRate.setValue(Math.round(rate * 1e6) / 1e6);
        }
      });
    });

    // Fill the price with that day's close unless the user typed one.
    effect(() => {
      const security = this.security();
      const date = this.dateIso();
      if (!security || !date || this.kind() !== 'trade') {
        return;
      }
      void this.api.priceOn(security.securityId, date).then(result => {
        if (untracked(this.security)?.securityId !== security.securityId || untracked(this.dateIso) !== date) {
          return;
        }
        this.priceOn.set({ date: result.date, close: result.close, symbol: security.symbol });
        if (!this.priceEdited && result.close !== null) {
          this.form.controls.price.setValue(result.close);
        }
      }).catch(() => this.priceOn.set(null));
    });

    // An error describes the values it was raised for; any change makes it stale.
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.error.set(null));

    // A dividend is usually paid in the security's own currency.
    effect(() => {
      const security = this.security();
      if (security && this.kind() === 'dividend' && !this.currencyEdited) {
        untracked(() => this.form.controls.currency.setValue(security.currency));
      }
    });
  }

  protected setType(type: TransactionType): void {
    this.type.set(type);
    this.error.set(null);
    const kind = kindOf(type);
    if (kind === 'cash' && !this.currencyEdited) {
      this.form.controls.currency.setValue(this.base);
    }
  }

  /** Arrow keys move through the types, as in any radio group. */
  protected onTypeKey(event: KeyboardEvent): void {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) {
      return;
    }
    event.preventDefault();
    const index = TYPES.findIndex(t => t.type === this.type());
    const next = TYPES[(index + step + TYPES.length) % TYPES.length].type;
    this.setType(next);
    const group = event.currentTarget as HTMLElement;
    queueMicrotask(() => group.querySelector<HTMLElement>(`[data-type="${next}"]`)?.focus());
  }

  protected markEdited(field: 'price' | 'fx' | 'currency'): void {
    if (field === 'price') this.priceEdited = true;
    if (field === 'fx') this.fxEdited = true;
    if (field === 'currency') this.currencyEdited = true;
  }

  protected sellAll(): void {
    const held = this.held();
    if (held) {
      this.form.controls.quantity.setValue(held.quantity);
    }
  }

  protected async save(): Promise<void> {
    const request = this.buildRequest();
    if (typeof request === 'string') {
      this.error.set(request);
      return;
    }

    this.saving.set(true);
    this.error.set(null);
    try {
      if (this.editing) {
        await this.api.updateTransaction(this.data.portfolioId, this.data.transaction!.id, request);
        this.ref.close({ message: 'Transaction updated.' });
      } else {
        await this.api.addTransaction(this.data.portfolioId, request);
        this.ref.close({ message: ACTION[request.type][1] });
      }
    } catch (error) {
      this.error.set(problemMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  /** The request to send, or the first thing that still needs filling in. */
  private buildRequest(): TransactionRequest | string {
    const raw = this.form.getRawValue();
    const type = this.type();
    const security = this.security();
    const note = raw.note.trim() || null;
    const date = this.dateIso();
    if (!date) {
      return 'Enter a valid date.';
    }
    // Without a rate (not loaded yet, or cleared) the server uses the Bank of Canada rate for the trade date.
    const fxRate = this.showFxRate() && raw.fxRate && raw.fxRate > 0 ? raw.fxRate : null;

    if (this.needsSecurity() && !security) {
      return 'Choose a stock or fund.';
    }

    switch (this.kind()) {
      case 'trade':
        if (!(raw.quantity && raw.quantity > 0)) return 'Enter the number of shares.';
        if (raw.price === null || raw.price < 0) return 'Enter the price per share.';
        return {
          type, date, note, fxRate, securityId: security!.securityId, quantity: raw.quantity, price: raw.price,
          fee: type === 'TransferIn' ? 0 : raw.fee ?? 0,
        };
      case 'split':
        if (!(raw.splitFrom && raw.splitFrom > 0 && raw.splitTo && raw.splitTo > 0)) return 'Enter both sides of the split ratio.';
        return { type, date, note, securityId: security!.securityId, splitFrom: raw.splitFrom, splitTo: raw.splitTo };
      case 'dividend':
        if (!(raw.amount && raw.amount > 0)) return 'Enter the dividend amount.';
        return { type, date, note, fxRate, securityId: security!.securityId, amount: raw.amount, fee: raw.fee ?? 0, currency: raw.currency };
      default:
        if (!(raw.amount && raw.amount > 0)) return 'Enter an amount greater than zero.';
        return { type, date, note, fxRate, amount: raw.amount, currency: raw.currency };
    }
  }

  private initialValues() {
    const t = this.data.transaction;
    if (t) {
      return {
        type: t.type,
        security: t.securityId
          ? { securityId: t.securityId, symbol: t.symbol ?? '', name: t.securityName ?? '', currency: t.currency, exchange: null }
          : undefined,
        date: t.date,
        quantity: t.quantity || null,
        price: kindOf(t.type) === 'trade' ? t.price : null,
        fee: t.fee || null,
        amount: t.amount || null,
        currency: t.currency,
        splitFrom: t.splitFrom || 1,
        splitTo: t.splitTo || null,
        fxRate: t.fxRate,
        note: t.note ?? '',
      };
    }

    const p = this.data.preset;
    return {
      type: p?.type ?? 'Buy',
      security: p?.security,
      date: p?.date ?? toIsoDate(new Date()),
      quantity: p?.quantity ?? null,
      price: p?.price ?? null,
      fee: p?.fee ?? null,
      amount: p?.amount ?? null,
      currency: p?.currency,
      splitFrom: p?.splitFrom ?? 1,
      splitTo: p?.splitTo ?? null,
      fxRate: null as number | null,
      note: p?.note ?? '',
    };
  }
}
