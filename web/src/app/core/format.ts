import { Pipe, PipeTransform } from '@angular/core';
import { Currency, IsoDate, TransactionType } from './models';

const LOCALE = 'en-CA';
const MINUS = '−';
const cache = new Map<string, Intl.NumberFormat>();

function numberFormat(key: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  let format = cache.get(key);
  if (!format) {
    format = new Intl.NumberFormat(LOCALE, options);
    cache.set(key, format);
  }
  return format;
}

/** Typographic minus instead of a hyphen. */
function withMinus(text: string): string {
  return text.replace('-', MINUS);
}

/** "$1,234.56" for CAD, "US$1,234.56" for USD, "€1,234.56" for EUR: the Canadian convention. */
export function formatMoney(value: number | null | undefined, currency: Currency, options: { signed?: boolean; decimals?: number } = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  const decimals = options.decimals ?? (Math.abs(value) >= 1_000_000 ? 0 : 2);
  const key = `m|${currency}|${options.signed ? 's' : ''}|${decimals}`;
  const format = numberFormat(key, {
    style: 'currency',
    currency,
    currencyDisplay: 'symbol',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    signDisplay: options.signed ? 'exceptZero' : 'auto',
  });
  return withMinus(format.format(value));
}

/** A per-share price: two decimals, more when the price needs them (penny stocks). */
export function formatPrice(value: number | null | undefined, currency: Currency): string {
  if (value === null || value === undefined) {
    return '—';
  }
  const decimals = Math.abs(value) < 1 && value !== 0 ? 4 : 2;
  const key = `p|${currency}|${decimals}`;
  return withMinus(numberFormat(key, {
    style: 'currency',
    currency,
    currencyDisplay: 'symbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  }).format(value));
}

/** "$1.2M", "$150K"; `digits` fixes the decimals shown ("$1.20M" with 2). */
export function formatCompactMoney(value: number, currency: Currency, digits = 1): string {
  return withMinus(numberFormat(`c|${currency}|${digits}`, {
    style: 'currency',
    currency,
    currencyDisplay: 'symbol',
    notation: 'compact',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value));
}

/** The tick interval ECharts picks for a span: 1, 2, 3, 5 or 10 times a power of ten. */
function niceInterval(span: number, ticks: number): number {
  const raw = span / ticks;
  const base = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / base;
  return (f < 1.5 ? 1 : f < 2.5 ? 2 : f < 4 ? 3 : f < 7 ? 5 : 10) * base;
}

/**
 * Compact money for a chart axis whose ticks are `ticks` apart over the plotted `values`: the decimals follow the
 * tick spacing, so a zoomed-in axis reads "$1.16M, $1.18M, $1.20M" rather than "$1.2M" three times, while a wide
 * one keeps "$100K, $150K". Ticks closer than a thousandth of their unit fall back to the full amount.
 */
export function compactAxisFormatter(values: readonly number[], currency: Currency, ticks = 4): (value: number) => string {
  const finite = values.filter(v => Number.isFinite(v));
  const span = finite.length ? Math.max(...finite) - Math.min(...finite) : 0;
  const interval = span > 0 ? niceInterval(span, ticks) : 0;
  const intervalExponent = interval > 0 ? Math.floor(Math.log10(interval) + 1e-9) : 0;
  return (value: number) => {
    const magnitude = Math.abs(value);
    const unitExponent = magnitude >= 1e9 ? 9 : magnitude >= 1e6 ? 6 : magnitude >= 1e3 ? 3 : 0;
    const digits = interval > 0 ? Math.max(0, unitExponent - intervalExponent) : 1;
    return digits > 3 ? formatMoney(value, currency, { decimals: 0 }) : formatCompactMoney(value, currency, digits);
  };
}

/** Ratios arrive as fractions (0.0123); shown as "+1.23%". */
export function formatPercent(value: number | null | undefined, options: { signed?: boolean; decimals?: number } = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  const decimals = options.decimals ?? 2;
  const key = `%|${options.signed ?? true}|${decimals}`;
  return withMinus(numberFormat(key, {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    signDisplay: options.signed ?? true ? 'exceptZero' : 'auto',
  }).format(value));
}

export function formatQuantity(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '—';
  }
  return withMinus(numberFormat('q', { maximumFractionDigits: 6 }).format(value));
}

export function formatRate(value: number): string {
  return numberFormat('r', { minimumFractionDigits: 4, maximumFractionDigits: 6 }).format(value);
}

const dateFormat = new Intl.DateTimeFormat(LOCALE, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
const shortDateFormat = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const weekdayFormat = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Dates from the API are calendar days; they are formatted in UTC so no time zone shifts them. */
export function formatDate(iso: IsoDate | null | undefined, style: 'long' | 'short' | 'weekday' = 'long'): string {
  if (!iso) {
    return '—';
  }
  const date = new Date(`${iso}T00:00:00Z`);
  return (style === 'short' ? shortDateFormat : style === 'weekday' ? weekdayFormat : dateFormat).format(date);
}

/** "Today" when a day change is from today's session, otherwise that session's date, such as "Fri, Oct 9". */
export function sessionLabel(session: IsoDate | null | undefined, today: IsoDate | null | undefined): string {
  return !session || !today || session === today ? 'Today' : formatDate(session, 'weekday');
}

export function formatDateTime(timestamp: string | null | undefined): string {
  return timestamp ? dateTimeFormat.format(new Date(timestamp)) : '—';
}

/** Local calendar day of a Date (from the date picker) as YYYY-MM-DD, without a UTC shift. */
export function toIsoDate(date: Date): IsoDate {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function fromIsoDate(iso: IsoDate): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function todayIso(): IsoDate {
  return toIsoDate(new Date());
}

/** Money changes under half a cent, or ratios under 0.005 %, count as unchanged. */
export function direction(value: number | null | undefined, threshold = 0.005): 'gain' | 'loss' | '' {
  if (!value || Math.abs(value) < threshold) {
    return '';
  }
  return value > 0 ? 'gain' : 'loss';
}

export const TRANSACTION_LABELS: Record<TransactionType, string> = {
  Buy: 'Buy',
  Sell: 'Sell',
  Split: 'Split',
  Deposit: 'Deposit',
  Withdrawal: 'Withdrawal',
  Dividend: 'Dividend',
  Interest: 'Interest',
  Fee: 'Fee',
  TransferIn: 'Transfer in',
};

@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(value: number | null | undefined, currency: Currency, signed = false): string {
    return formatMoney(value, currency, { signed });
  }
}

@Pipe({ name: 'price' })
export class PricePipe implements PipeTransform {
  transform(value: number | null | undefined, currency: Currency): string {
    return formatPrice(value, currency);
  }
}

@Pipe({ name: 'pct' })
export class PercentPipe implements PipeTransform {
  transform(value: number | null | undefined, signed = true, decimals = 2): string {
    return formatPercent(value, { signed, decimals });
  }
}

@Pipe({ name: 'qty' })
export class QuantityPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return formatQuantity(value);
  }
}

@Pipe({ name: 'day' })
export class DayPipe implements PipeTransform {
  transform(value: IsoDate | null | undefined, style: 'long' | 'short' | 'weekday' = 'long'): string {
    return formatDate(value, style);
  }
}

@Pipe({ name: 'when' })
export class WhenPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return formatDateTime(value);
  }
}

@Pipe({ name: 'txLabel' })
export class TransactionLabelPipe implements PipeTransform {
  transform(value: TransactionType): string {
    return TRANSACTION_LABELS[value];
  }
}

export const FORMAT_PIPES = [MoneyPipe, PricePipe, PercentPipe, QuantityPipe, DayPipe, WhenPipe, TransactionLabelPipe] as const;
