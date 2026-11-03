import { DARK, LIGHT, assetTypeColour, chartTheme, currencyColour, slotColour } from './chart-theme';

describe('chartTheme', () => {
  it('picks the palette for the theme', () => {
    expect(chartTheme(false)).toBe(LIGHT);
    expect(chartTheme(true)).toBe(DARK);
  });

  it('gives each theme four distinct series colours', () => {
    for (const theme of [LIGHT, DARK]) {
      expect(new Set(theme.series).size).toBe(4);
    }
  });
});

describe('currencyColour', () => {
  it.each([
    ['CAD', 0],
    ['USD', 1],
    ['EUR', 2],
    ['GBP', 3],
  ])('keeps %s in slot %i whatever else is on screen', (currency, slot) => {
    expect(currencyColour(LIGHT, currency)).toBe(LIGHT.series[slot]);
    expect(currencyColour(DARK, currency)).toBe(DARK.series[slot]);
  });

  it('uses the neutral colour for a currency without a slot', () => {
    expect(currencyColour(LIGHT, 'JPY')).toBe(LIGHT.other);
  });
});

describe('slotColour', () => {
  it('takes the palette in order and wraps around after four', () => {
    expect([0, 1, 2, 3, 4, 5].map((slot) => slotColour(LIGHT, slot, 'x'))).toEqual([
      ...LIGHT.series,
      LIGHT.series[0],
      LIGHT.series[1],
    ]);
  });

  it('shows "not set" in grey', () => {
    expect(slotColour(DARK, 2, '')).toBe(DARK.other);
  });
});

describe('assetTypeColour', () => {
  it.each([
    ['Stock', 0],
    ['Etf', 1],
    ['Fund', 2],
    ['Crypto', 3],
    ['RealEstate', 3],
  ])('colours %s from slot %i', (key, slot) => {
    expect(assetTypeColour(LIGHT, key)).toBe(LIGHT.series[slot]);
  });

  it('shows cash in the muted ink', () => {
    expect(assetTypeColour(LIGHT, 'Cash')).toBe(LIGHT.ink3);
  });

  it('uses the neutral colour for any other type', () => {
    expect(assetTypeColour(DARK, 'Other')).toBe(DARK.other);
  });
});
