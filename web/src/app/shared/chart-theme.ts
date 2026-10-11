import { Currency } from '../core/models';

/**
 * Chart colours per theme. The four categorical slots were validated (OKLCH lightness band, chroma floor,
 * protan/deutan separation, normal-vision floor, 3:1 contrast) against the card surface of each theme.
 * Keep in sync with the --chart-* tokens in styles.scss.
 */
export interface ChartTheme {
  surface: string;
  ink: string;
  ink2: string;
  ink3: string;
  grid: string;
  axis: string;
  series: readonly [string, string, string, string];
  other: string;
  gain: string;
  loss: string;
  tooltipBg: string;
  tooltipBorder: string;
}

export const LIGHT: ChartTheme = {
  surface: '#ffffff',
  ink: '#172430',
  ink2: '#4e5c68',
  ink3: '#687582',
  grid: '#e7ebee',
  axis: '#c3ccd3',
  series: ['#1c6bb0', '#b07a1f', '#7a5bd6', '#d55181'],
  other: '#98a3ac',
  gain: '#137a4b',
  loss: '#b3261e',
  tooltipBg: '#ffffff',
  tooltipBorder: '#dce2e6',
};

export const DARK: ChartTheme = {
  surface: '#162027',
  ink: '#e4eaee',
  ink2: '#a9b6c0',
  ink3: '#8795a0',
  grid: '#22303a',
  axis: '#35444f',
  series: ['#4c93d6', '#bf8a2c', '#9085e9', '#d55181'],
  other: '#5d6b75',
  gain: '#4cc38a',
  loss: '#f28b82',
  tooltipBg: '#1b2730',
  tooltipBorder: '#35444f',
};

export function chartTheme(dark: boolean): ChartTheme {
  return dark ? DARK : LIGHT;
}

/** Colour follows the entity: each currency keeps its slot whatever else is on screen. */
const CURRENCY_SLOTS: Record<string, number> = { CAD: 0, USD: 1, EUR: 2, GBP: 3 };

export function currencyColour(theme: ChartTheme, currency: Currency): string {
  const slot = CURRENCY_SLOTS[currency];
  return slot === undefined ? theme.other : theme.series[slot];
}

const ASSET_SLOTS: Record<string, number> = { Stock: 0, Etf: 1, Fund: 2, Crypto: 3 };

export function assetTypeColour(theme: ChartTheme, key: string): string {
  if (key === 'Cash') {
    return theme.ink3;
  }
  const slot = ASSET_SLOTS[key];
  return slot === undefined ? theme.other : theme.series[slot];
}
