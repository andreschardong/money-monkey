import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  FORMAT_PIPES,
  TRANSACTION_LABELS,
  compactAxisFormatter,
  direction,
  formatCompactMoney,
  formatDate,
  formatDateTime,
  formatMoney,
  formatPercent,
  formatPrice,
  formatQuantity,
  formatRate,
  fromIsoDate,
  sessionLabel,
  toIsoDate,
  todayIso,
} from './format';

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

describe('compactAxisFormatter', () => {
  it('shows as many decimals as the tick spacing needs', () => {
    const zoomed = compactAxisFormatter([1_150_000, 1_240_000], 'CAD'); // ticks 20K apart
    expect(zoomed(1_160_000)).toBe('$1.16M');
    expect(zoomed(1_200_000)).toBe('$1.20M');
    const wide = compactAxisFormatter([100_000, 350_000], 'USD'); // ticks 50K apart
    expect(wide(150_000)).toBe('US$150K');
    expect(wide(0)).toBe('US$0');
  });

  it('keeps whole dollars for share prices and falls back to the full amount when ticks are tiny', () => {
    expect(compactAxisFormatter([180, 330], 'CAD')(210)).toBe('$210');
    expect(compactAxisFormatter([1_200_100, 1_200_500], 'CAD')(1_200_300)).toBe('$1,200,300');
    expect(compactAxisFormatter([], 'CAD')(2_500_000)).toBe('$2.5M');
    expect(formatCompactMoney(-42_000, 'EUR')).toBe('−€42.0K');
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
});

describe('direction', () => {
  it('ignores rounding noise', () => {
    expect(direction(0.001)).toBe('');
    expect(direction(5)).toBe('gain');
    expect(direction(-5)).toBe('loss');
    expect(direction(null)).toBe('');
  });
});

describe('sessionLabel', () => {
  it('says Today when the day change is from today', () => {
    expect(sessionLabel('2026-10-12', '2026-10-12')).toBe('Today');
    expect(sessionLabel(null, '2026-10-12')).toBe('Today');
  });

  it("names the session's date before the open or at a weekend", () => {
    expect(sessionLabel('2026-10-09', '2026-10-12')).toBe('Fri, Oct 9');
  });
});

describe('formatMoney edge cases', () => {
  it.each([undefined, Number.NaN])('shows a dash for %s', (value) => {
    expect(formatMoney(value, 'CAD')).toBe('—');
  });

  it('honours an explicit number of decimals, even for millions', () => {
    expect(formatMoney(12.345, 'CAD', { decimals: 3 })).toBe('$12.345');
    expect(formatMoney(2_500_000.75, 'CAD', { decimals: 2 })).toBe('$2,500,000.75');
  });

  it('keeps cents just under a million and drops them for negative millions too', () => {
    expect(formatMoney(999_999.99, 'CAD')).toBe('$999,999.99');
    expect(formatMoney(-1_000_000.4, 'CAD')).toBe('−$1,000,000');
  });

  it('shows zero without a sign even when signed', () => {
    expect(formatMoney(0, 'USD', { signed: true })).toBe('US$0.00');
  });
});

describe('formatPrice edge cases', () => {
  it('shows a dash for a missing price', () => {
    expect(formatPrice(null, 'CAD')).toBe('—');
    expect(formatPrice(undefined, 'CAD')).toBe('—');
  });

  it('keeps two decimals for zero and whole prices, and uses a typographic minus for negatives', () => {
    expect(formatPrice(0, 'CAD')).toBe('$0.00');
    expect(formatPrice(1, 'CAD')).toBe('$1.00');
    expect(formatPrice(-0.5, 'CAD')).toBe('−$0.50');
    expect(formatPrice(-0.00123, 'CAD')).toBe('−$0.0012');
  });
});

describe('compactAxisFormatter edge cases', () => {
  it('ignores values that are not finite when working out the tick spacing', () => {
    const format = compactAxisFormatter([100_000, Number.NaN, 350_000, Number.POSITIVE_INFINITY], 'CAD');
    expect(format(150_000)).toBe('$150K');
  });

  it('rounds a tick spacing of seven or more units up to the next power of ten', () => {
    // 28 across 4 ticks is 7 per tick, which is drawn as 10: whole thousands are enough.
    expect(compactAxisFormatter([0, 28_000], 'CAD')(14_000)).toBe('$14K');
    expect(compactAxisFormatter([0, 28_000], 'CAD')(10_000)).toBe('$10K');
  });

  it('shows billions, and a single repeated value, with one decimal', () => {
    expect(compactAxisFormatter([3_000_000_000, 3_000_000_000], 'CAD')(3_000_000_000)).toBe('$3.0B');
  });
});

describe('formatPercent edge cases', () => {
  it.each([null, undefined, Number.NaN])('shows a dash for %s', (value) => {
    expect(formatPercent(value)).toBe('—');
  });

  it('shows zero without a sign', () => {
    expect(formatPercent(0)).toBe('0.00%');
    expect(formatPercent(0, { signed: false })).toBe('0.00%');
  });

  it('leaves the plus off when asked, negatives excepted', () => {
    expect(formatPercent(0.05, { signed: false })).toBe('5.00%');
    expect(formatPercent(-0.05, { signed: false })).toBe('−5.00%');
  });
});

describe('formatQuantity and formatRate edge cases', () => {
  it('shows a dash for a missing quantity and a minus for a short position', () => {
    expect(formatQuantity(null)).toBe('—');
    expect(formatQuantity(undefined)).toBe('—');
    expect(formatQuantity(-2.5)).toBe('−2.5');
  });

  it('shows exchange rates with at least four decimals', () => {
    expect(formatRate(1.3)).toBe('1.3000');
    expect(formatRate(0.7312345678)).toBe('0.731235');
  });
});

describe('dates edge cases', () => {
  it('shows a dash for a missing day', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('')).toBe('—');
  });

  it('formats the weekday style with the day name', () => {
    expect(formatDate('2026-10-09', 'weekday')).toBe('Fri, Oct 9');
  });

  it('formats a timestamp as month, day and time, and shows a dash when there is none', () => {
    expect(formatDateTime('2026-10-09T14:05:00')).toMatch(/^Oct 9,? 2:05\s?p\.?m\.?$/i);
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime(undefined)).toBe('—');
    expect(formatDateTime('')).toBe('—');
  });

  it('pads single-digit months and days', () => {
    expect(toIsoDate(new Date(2026, 8, 3))).toBe('2026-09-03');
    expect(toIsoDate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('reads ISO days as local midnight', () => {
    const date = fromIsoDate('2026-10-09');
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([2026, 9, 9, 0]);
  });

  it('knows today as a local calendar day', () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 2, 23, 59), toFake: ['Date'] });
    try {
      expect(todayIso()).toBe('2026-11-02');
    } finally {
      vi.useRealTimers();
    }
  });

  it('labels a session with today when the session or the market date is unknown', () => {
    expect(sessionLabel('2026-10-12', null)).toBe('Today');
    expect(sessionLabel(undefined, undefined)).toBe('Today');
  });
});

describe('direction edge cases', () => {
  it('treats zero, undefined and NaN as unchanged', () => {
    expect(direction(0)).toBe('');
    expect(direction(undefined)).toBe('');
    expect(direction(Number.NaN)).toBe('');
  });

  it('uses the threshold given, inclusive of the boundary', () => {
    expect(direction(0.00004, 0.00005)).toBe('');
    expect(direction(0.00005, 0.00005)).toBe('gain');
    expect(direction(-0.00005, 0.00005)).toBe('loss');
    expect(direction(0.005)).toBe('gain');
  });
});

@Component({
  imports: [FORMAT_PIPES],
  template: `
    <p id="money">{{ amount | money: 'CAD' }}|{{ amount | money: 'USD' : true }}|{{ none | money: 'CAD' }}</p>
    <p id="price">{{ cheap | price: 'CAD' }}|{{ amount | price: 'CAD' }}</p>
    <p id="pct">{{ ratio | pct }}|{{ ratio | pct: false : 0 }}</p>
    <p id="qty">{{ 1.5 | qty }}|{{ none | qty }}</p>
    <p id="day">{{ '2026-10-09' | day }}|{{ '2026-10-09' | day: 'short' }}|{{ none | day }}</p>
    <p id="when">{{ none | when }}|{{ '2026-10-09T14:05:00' | when }}</p>
    <p id="tx">{{ 'TransferIn' | txLabel }}|{{ 'Buy' | txLabel }}</p>
  `,
})
class PipesHost {
  amount = 1234.5;
  none = null;
  cheap = 0.0123;
  ratio = 0.1234;
}

describe('pipes', () => {
  const text = (id: string) => {
    const fixture = TestBed.createComponent(PipesHost);
    fixture.detectChanges();
    return (fixture.nativeElement.querySelector(`#${id}`) as HTMLElement).textContent!.split('|');
  };

  it('money formats with the currency, signed on request, and dashes a missing value', () => {
    expect(text('money')).toEqual(['$1,234.50', '+US$1,234.50', '—']);
  });

  it('price keeps extra decimals for small prices', () => {
    expect(text('price')).toEqual(['$0.0123', '$1,234.50']);
  });

  it('pct is signed with two decimals unless told otherwise', () => {
    expect(text('pct')).toEqual(['+12.34%', '12%']);
  });

  it('qty trims trailing zeros and dashes a missing value', () => {
    expect(text('qty')).toEqual(['1.5', '—']);
  });

  it('day defaults to the long style and dashes a missing value', () => {
    expect(text('day')).toEqual(['Oct 9, 2026', 'Oct 9', '—']);
  });

  it('when formats a timestamp and dashes a missing one', () => {
    const [missing, formatted] = text('when');
    expect(missing).toBe('—');
    expect(formatted).toContain('Oct 9');
  });

  it('txLabel gives a readable label', () => {
    expect(text('tx')).toEqual(['Transfer in', 'Buy']);
  });

  it('every transaction type has a label, and every pipe is listed for components to import', () => {
    expect(Object.keys(TRANSACTION_LABELS)).toHaveLength(9);
    expect(FORMAT_PIPES).toHaveLength(7);
  });
});
