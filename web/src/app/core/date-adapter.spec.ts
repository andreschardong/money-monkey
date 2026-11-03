import { TestBed } from '@angular/core/testing';
import { DateAdapter, MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { LocalDateAdapter } from './date-adapter';

describe('LocalDateAdapter', () => {
  let adapter: LocalDateAdapter;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideNativeDateAdapter(),
        { provide: DateAdapter, useClass: LocalDateAdapter },
        { provide: MAT_DATE_LOCALE, useValue: 'en-CA' },
      ],
    });
    adapter = TestBed.inject(DateAdapter) as LocalDateAdapter;
  });

  it('reads a typed ISO date as that calendar day in local time', () => {
    const date = adapter.parse('2026-10-09')!;
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([2026, 9, 9, 0]);
  });

  it('accepts single-digit months and days and surrounding spaces', () => {
    const date = adapter.parse('  2026-1-5 ')!;
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2026, 0, 5]);
  });

  it('accepts a leap day', () => {
    expect(adapter.parse('2024-02-29')!.getDate()).toBe(29);
  });

  it.each(['2026-02-30', '2026-13-01', '2026-00-10', '2025-02-29', '2026-04-31'])(
    'treats the impossible day %s as invalid',
    (input) => {
      const parsed = adapter.parse(input);
      expect(adapter.isValid(parsed!)).toBe(false);
    },
  );

  it('leaves other text to the native parser', () => {
    expect(adapter.parse('October 9, 2026')).toEqual(new Date(Date.parse('October 9, 2026')));
  });

  it('treats text the native parser cannot read as invalid', () => {
    expect(adapter.isValid(adapter.parse('nonsense')!)).toBe(false);
  });

  it('passes non-string values on, so a Date or null keeps working', () => {
    const date = new Date(2026, 9, 9);
    expect(adapter.parse(date)).toEqual(date);
    expect(adapter.parse(null)).toBeNull();
    expect(adapter.parse(1_760_000_000_000)).toEqual(new Date(1_760_000_000_000));
  });
});
