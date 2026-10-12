// Mirrors the API contracts in src/Folio.Api/Endpoints/Contracts.cs.

export type Currency = string;
export type IsoDate = string;

export type TransactionType =
  | 'Buy'
  | 'Sell'
  | 'Split'
  | 'Deposit'
  | 'Withdrawal'
  | 'Dividend'
  | 'Interest'
  | 'Fee'
  | 'TransferIn';

export type AssetType = 'Stock' | 'Etf' | 'Fund' | 'Crypto' | 'Other';
export type PriceSource = 'Yahoo' | 'Manual' | 'AlphaVantage';
export type CorporateActionKind = 'Split' | 'Dividend';
export type RefreshStatus = 'Running' | 'Succeeded' | 'PartiallySucceeded' | 'Failed';
export type Range = '1M' | '3M' | '6M' | 'YTD' | '1Y' | '3Y' | '5Y' | 'ALL';

export const PORTFOLIO_CURRENCIES: readonly Currency[] = ['CAD', 'USD', 'EUR'];

/** Owner: everything. Edit: transactions and cash. View: look only. */
export type PortfolioAccess = 'Owner' | 'Edit' | 'View';

export interface PortfolioSummary {
  id: string;
  name: string;
  baseCurrency: Currency;
  description: string | null;
  totalValue: number;
  holdingsValue: number;
  cashValue: number;
  dayChange: number;
  dayChangePercent: number | null;
  totalReturn: number | null;
  totalReturnPercent: number | null;
  annualizedReturn: number | null;
  netContributions: number;
  holdingsCount: number;
  transactionsCount: number;
  pricesAsOf: IsoDate | null;
  firstTransactionDate: IsoDate | null;
  access: PortfolioAccess;
  ownerEmail: string | null;
  sharedWith: number;
  /** The trading session the day change is from; today once markets have opened. */
  dayChangeDate: IsoDate | null;
}

export interface Holding {
  securityId: string;
  symbol: string;
  name: string;
  exchange: string | null;
  assetType: AssetType;
  currency: Currency;
  quantity: number;
  averageCost: number;
  costBasis: number;
  price: number | null;
  priceDate: IsoDate | null;
  previousClose: number | null;
  dayChangePercent: number | null;
  marketValue: number;
  marketValueLocal: number;
  dayChange: number;
  unrealizedGain: number;
  unrealizedGainPercent: number | null;
  realizedGain: number;
  dividends: number;
  weight: number;
  fxRate: number;
  priceMissing: boolean;
}

export interface CashBalance {
  currency: Currency;
  balance: number;
  asOf: IsoDate;
  fxRate: number;
  value: number;
}

export interface CashEntry {
  currency: Currency;
  date: IsoDate;
  balance: number;
  note: string | null;
}

export interface SetCashRequest {
  currency: Currency;
  balance: number;
  date: IsoDate | null;
  note: string | null;
}

export interface PortfolioDetail {
  summary: PortfolioSummary;
  costBasis: number;
  unrealizedGain: number;
  unrealizedGainPercent: number | null;
  realizedGain: number;
  dividends: number;
  interest: number;
  fees: number;
  taxWithheld: number;
  holdings: Holding[];
  cash: CashBalance[];
  warnings: string[];
}

export interface Transaction {
  id: string;
  type: TransactionType;
  date: IsoDate;
  securityId: string | null;
  symbol: string | null;
  securityName: string | null;
  currency: Currency;
  quantity: number;
  price: number;
  amount: number;
  fee: number;
  fxRate: number;
  splitFrom: number;
  splitTo: number;
  note: string | null;
  total: number;
  createdAt: string;
}

export interface TransactionRequest {
  type: TransactionType;
  date: IsoDate;
  securityId?: string | null;
  symbol?: string | null;
  currency?: Currency | null;
  quantity?: number | null;
  price?: number | null;
  amount?: number | null;
  fee?: number | null;
  fxRate?: number | null;
  splitFrom?: number | null;
  splitTo?: number | null;
  note?: string | null;
}

export interface HistoryPoint {
  date: IsoDate;
  value: number;
  netContributions: number;
}

export interface History {
  currency: Currency;
  range: Range;
  points: HistoryPoint[];
}

export interface RealizedGain {
  transactionId: string;
  date: IsoDate;
  securityId: string;
  symbol: string;
  name: string;
  quantity: number;
  currency: Currency;
  proceedsLocal: number;
  costLocal: number;
  gainLocal: number;
  proceeds: number;
  costBasis: number;
  gain: number;
}

export interface IncomeYear {
  year: number;
  proceeds: number;
  costBasis: number;
  gain: number;
  dividends: number;
  interest: number;
  taxWithheld: number;
}

export interface RealizedReport {
  currency: Currency;
  years: IncomeYear[];
  sales: RealizedGain[];
}

export interface Security {
  id: string;
  symbol: string;
  name: string;
  currency: Currency;
  exchange: string | null;
  assetType: AssetType;
  priceSource: PriceSource;
  lastPrice: number | null;
  lastPriceDate: IsoDate | null;
  previousClose: number | null;
  dayChangePercent: number | null;
  lastRefreshAt: string | null;
  lastRefreshError: string | null;
  inUse: boolean;
}

export interface HoldingDetail {
  baseCurrency: Currency;
  security: Security;
  holding: Holding | null;
  realizedGain: number;
  dividends: number;
  transactions: Transaction[];
}

export interface Suggestion {
  kind: CorporateActionKind;
  securityId: string;
  symbol: string;
  name: string;
  date: IsoDate;
  currency: Currency;
  splitFrom: number | null;
  splitTo: number | null;
  perShare: number | null;
  quantity: number | null;
  amount: number | null;
}

export interface SymbolMatch {
  symbol: string;
  name: string;
  exchange: string | null;
  assetType: AssetType;
  securityId: string | null;
}

export interface PricePoint {
  date: IsoDate;
  close: number;
}

export interface CorporateAction {
  date: IsoDate;
  kind: CorporateActionKind;
  numerator: number;
  denominator: number;
  amount: number;
}

export interface PriceOn {
  securityId: string;
  requestedDate: IsoDate;
  date: IsoDate | null;
  close: number | null;
}

export interface FxRate {
  from: Currency;
  to: Currency;
  rate: number;
}

export interface FxRates {
  date: IsoDate;
  ratesDate: IsoDate | null;
  rates: FxRate[];
}

export interface RefreshRun {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  trigger: string;
  status: RefreshStatus;
  securitiesUpdated: number;
  securitiesFailed: number;
  fxRatesStored: number;
  log: string | null;
}

export interface MarketStatus {
  running: boolean;
  lastRun: RefreshRun | null;
  nextScheduledRun: string;
  schedulerEnabled: boolean;
  fxAsOf: IsoDate | null;
  pricesAsOf: IsoDate | null;
  securitiesTracked: number;
  securitiesWithErrors: number;
  fallbackConfigured: boolean;
  today: IsoDate;
}

export interface OverviewPortfolio {
  id: string;
  name: string;
  baseCurrency: Currency;
  value: number;
  valueInDisplay: number;
  dayChangeInDisplay: number;
  dayChangePercent: number | null;
  totalReturnInDisplay: number | null;
  totalReturnPercent: number | null;
  holdingsCount: number;
  access: PortfolioAccess;
  ownerEmail: string | null;
}

export interface Allocation {
  key: string;
  label: string;
  value: number;
  weight: number;
}

export interface Mover {
  securityId: string;
  symbol: string;
  name: string;
  currency: Currency;
  price: number;
  dayChangePercent: number;
}

export interface Overview {
  currency: Currency;
  totalValue: number;
  dayChange: number;
  dayChangePercent: number | null;
  totalReturn: number | null;
  totalReturnPercent: number | null;
  netContributions: number;
  cashValue: number;
  pricesAsOf: IsoDate | null;
  portfolios: OverviewPortfolio[];
  byCurrency: Allocation[];
  byAssetType: Allocation[];
  movers: Mover[];
  warnings: string[];
  dayChangeDate: IsoDate | null;
}

export interface Problem {
  title?: string;
  detail?: string;
  status?: number;
}

export interface Me {
  signedIn: boolean;
  email: string | null;
  passkeys: number;
  inboxUrl: string | null;
  /** Where Money Monkey is set up to be opened; passkeys work only there, or on localhost. */
  publicUrl: string;
}

export interface EmailLinkSent {
  email: string;
  inboxUrl: string | null;
}

export interface Passkey {
  id: string;
  name: string;
  createdAt: string;
  backedUp: boolean;
}

/** One portfolio's share of a consolidated holding (shares) or cash balance (amount). */
export interface AssetSlice {
  portfolioId: string;
  portfolioName: string;
  quantity: number;
  value: number;
}

export interface AssetHolding {
  securityId: string;
  symbol: string;
  name: string;
  exchange: string | null;
  assetType: AssetType;
  currency: Currency;
  quantity: number;
  averageCost: number;
  costBasis: number;
  price: number | null;
  priceDate: IsoDate | null;
  dayChangePercent: number | null;
  marketValue: number;
  marketValueLocal: number;
  dayChange: number;
  unrealizedGain: number;
  unrealizedGainPercent: number | null;
  weight: number;
  priceMissing: boolean;
  portfolios: AssetSlice[];
}

export interface AssetCash {
  currency: Currency;
  balance: number;
  value: number;
  weight: number;
  portfolios: AssetSlice[];
}

export interface Assets {
  currency: Currency;
  portfolioCount: number;
  totalValue: number;
  holdingsValue: number;
  cashValue: number;
  dayChange: number;
  dayChangePercent: number | null;
  costBasis: number;
  unrealizedGain: number;
  unrealizedGainPercent: number | null;
  pricesAsOf: IsoDate | null;
  holdings: AssetHolding[];
  cash: AssetCash[];
  warnings: string[];
  dayChangeDate: IsoDate | null;
}

export interface Share {
  email: string;
  canEdit: boolean;
  createdAt: string;
}

export interface ImportResult {
  portfolios: number;
  transactions: number;
  cashBalances: number;
  warnings: string[];
}
