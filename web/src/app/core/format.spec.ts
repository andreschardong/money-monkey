import { TestBed } from '@angular/core/testing';
import { MAT_DATE_LOCALE } from '@angular/material/core';
import { direction, formatDate, formatMoney, formatPercent, formatPrice, formatQuantity, fromIsoDate, toIsoDate } from './format';
import { LocalDateAdapter } from './date-adapter';

describe('formatMoney', () => {
  it('uses the Canadian convention for each currency', () => {
    expect(formatMoney(1234.5, 'CAD')).toBe('$1,234.50');
    expect(formatMoney(1234.5, 'USD')).toBe('US$1,234.50');
    expect(formatMoney(1234.5, 'EUR')).toBe('€1,234.50');
  });

  it('signs changes with a typographic minus', () => {
    expect(formatMoney(12.3, 'CAD', { signed: true })).toBe('+$12.30');
    expect(formatMoney(-12.3, 'CAD', { signed: true })).toBe('−$12.30');
    expect(formatMoney(0, 'CAD', { signed: true })).toBe('$0.00');
  });

  it('drops cents from amounts in the millions and shows a dash for missing values', () => {
    expect(formatMoney(2_500_000.75, 'CAD')).toBe('$2,500,001');
    expect(formatMoney(null, 'CAD')).toBe('—');
  });
});

describe('formatPrice', () => {
  it('keeps extra decimals only for sub-dollar prices', () => {
    expect(formatPrice(243.83, 'CAD')).toBe('$243.83');
    expect(formatPrice(0.0123, 'USD')).toBe('US$0.0123');
  });
});

describe('formatPercent and formatQuantity', () => {
  it('formats ratios as signed percentages', () => {
    expect(formatPercent(0.0412)).toBe('+4.12%');
    expect(formatPercent(-0.0052)).toBe('−0.52%');
    expect(formatPercent(0.309, { signed: false, decimals: 1 })).toBe('30.9%');
  });

  it('trims trailing zeros from share counts', () => {
    expect(formatQuantity(120)).toBe('120');
    expect(formatQuantity(3.33333333)).toBe('3.333333');
  });
});

describe('dates', () => {
  it('formats API calendar days without shifting them across time zones', () => {
    expect(formatDate('2026-10-09')).toBe('Oct 9, 2026');
    expect(formatDate('2026-01-01', 'short')).toBe('Jan 1');
  });

  it('round-trips local dates through ISO strings', () => {
    expect(toIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toIsoDate(fromIsoDate('2024-02-29'))).toBe('2024-02-29');
  });

  it('parses typed ISO dates as local days in the date picker', () => {
    TestBed.configureTestingModule({ providers: [{ provide: MAT_DATE_LOCALE, useValue: 'en-CA' }] });
    const adapter = TestBed.runInInjectionContext(() => new LocalDateAdapter());
    const parsed = adapter.parse('2026-10-09', null)!;
    expect([parsed.getFullYear(), parsed.getMonth(), parsed.getDate()]).toEqual([2026, 9, 9]);
    expect(adapter.isValid(adapter.parse('2026-13-40', null)!)).toBe(false);
  });
});

describe('direction', () => {
  it('ignores rounding noise', () => {
    expect(direction(0.001)).toBe('');
    expect(direction(5)).toBe('gain');
    expect(direction(-5)).toBe('loss');
    expect(direction(null)).toBe('');
  });
});
