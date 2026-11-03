import {
  Allocation,
  AssetHolding,
  Assets,
  CashBalance,
  Holding,
  History,
  HistoryPoint,
  MarketStatus,
  Me,
  Mover,
  Overview,
  OverviewPortfolio,
  Passkey,
  PortfolioDetail,
  PortfolioSummary,
  RefreshRun,
  Security,
  Share,
  SymbolMatch,
  Transaction,
  Version,
} from '../app/core/models';

// Each builder returns a complete, plausible DTO; pass the fields a spec cares about as `overrides`.
// Defaults are round numbers in CAD, so expected text in a spec is easy to read.

export function portfolioSummary(overrides: Partial<PortfolioSummary> = {}): PortfolioSummary {
  return {
    id: 'p1',
    name: 'Retirement',
    baseCurrency: 'CAD',
    description: null,
    country: 'CA',
    kind: 'Investment',
    totalValue: 10_000,
    holdingsValue: 9_000,
    cashValue: 1_000,
    dayChange: 100,
    dayChangePercent: 0.01,
    totalReturn: 1_000,
    totalReturnPercent: 0.1,
    annualizedReturn: 0.08,
    netContributions: 9_000,
    holdingsCount: 2,
    transactionsCount: 5,
    pricesAsOf: '2026-10-30',
    firstTransactionDate: '2024-01-15',
    access: 'Owner',
    ownerEmail: null,
    sharedWith: 0,
    dayChangeDate: '2026-10-30',
    ...overrides,
  };
}

export function holding(overrides: Partial<Holding> = {}): Holding {
  return {
    securityId: 's1',
    symbol: 'XYZ',
    name: 'XYZ Corp',
    exchange: 'TSX',
    assetType: 'Stock',
    currency: 'CAD',
    quantity: 10,
    averageCost: 90,
    costBasis: 900,
    price: 100,
    priceDate: '2026-10-30',
    previousClose: 98,
    dayChangePercent: 0.0204,
    marketValue: 1_000,
    marketValueLocal: 1_000,
    dayChange: 20,
    unrealizedGain: 100,
    unrealizedGainPercent: 0.111,
    realizedGain: 0,
    dividends: 0,
    weight: 0.5,
    fxRate: 1,
    priceMissing: false,
    ...overrides,
  };
}

export function cashBalance(overrides: Partial<CashBalance> = {}): CashBalance {
  return { currency: 'CAD', balance: 500, asOf: '2026-10-30', fxRate: 1, value: 500, ...overrides };
}

export function portfolioDetail(overrides: Partial<PortfolioDetail> = {}): PortfolioDetail {
  return {
    summary: portfolioSummary(),
    costBasis: 900,
    unrealizedGain: 100,
    unrealizedGainPercent: 0.111,
    realizedGain: 0,
    dividends: 0,
    interest: 0,
    fees: 0,
    taxWithheld: 0,
    holdings: [holding()],
    cash: [cashBalance()],
    warnings: [],
    ...overrides,
  };
}

export function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 't1',
    type: 'Buy',
    date: '2026-10-01',
    securityId: 's1',
    symbol: 'XYZ',
    securityName: 'XYZ Corp',
    currency: 'CAD',
    quantity: 10,
    price: 90,
    amount: 0,
    fee: 0,
    fxRate: 1,
    splitFrom: 0,
    splitTo: 0,
    note: null,
    total: 900,
    createdAt: '2026-10-01T14:00:00Z',
    ...overrides,
  };
}

export function security(overrides: Partial<Security> = {}): Security {
  return {
    id: 's1',
    symbol: 'XYZ',
    name: 'XYZ Corp',
    currency: 'CAD',
    exchange: 'TSX',
    assetType: 'Stock',
    priceSource: 'Yahoo',
    lastPrice: 100,
    lastPriceDate: '2026-10-30',
    previousClose: 98,
    dayChangePercent: 0.0204,
    lastRefreshAt: '2026-10-30T21:00:00Z',
    lastRefreshError: null,
    inUse: true,
    ...overrides,
  };
}

export function symbolMatch(overrides: Partial<SymbolMatch> = {}): SymbolMatch {
  return { symbol: 'XYZ', name: 'XYZ Corp', exchange: 'TSX', assetType: 'Stock', securityId: null, ...overrides };
}

export function overviewPortfolio(overrides: Partial<OverviewPortfolio> = {}): OverviewPortfolio {
  return {
    id: 'p1',
    name: 'Retirement',
    baseCurrency: 'CAD',
    value: 10_000,
    valueInDisplay: 10_000,
    dayChangeInDisplay: 100,
    dayChangePercent: 0.01,
    totalReturnInDisplay: 1_000,
    totalReturnPercent: 0.1,
    holdingsCount: 2,
    access: 'Owner',
    ownerEmail: null,
    country: 'CA',
    kind: 'Investment',
    ...overrides,
  };
}

export function allocation(overrides: Partial<Allocation> = {}): Allocation {
  return { key: 'CAD', label: 'CAD', value: 10_000, weight: 1, ...overrides };
}

export function mover(overrides: Partial<Mover> = {}): Mover {
  return {
    securityId: 's1',
    symbol: 'XYZ',
    name: 'XYZ Corp',
    currency: 'CAD',
    price: 100,
    dayChangePercent: 0.05,
    ...overrides,
  };
}

export function overview(overrides: Partial<Overview> = {}): Overview {
  return {
    currency: 'CAD',
    totalValue: 10_000,
    dayChange: 100,
    dayChangePercent: 0.01,
    totalReturn: 1_000,
    totalReturnPercent: 0.1,
    netContributions: 9_000,
    cashValue: 1_000,
    pricesAsOf: '2026-10-30',
    portfolios: [overviewPortfolio()],
    byCurrency: [allocation()],
    byAssetType: [allocation({ key: 'Stock', label: 'Stocks' })],
    byCountry: [allocation({ key: 'CA', label: 'Canada' })],
    movers: [mover()],
    warnings: [],
    dayChangeDate: '2026-10-30',
    ...overrides,
  };
}

export function historyPoint(overrides: Partial<HistoryPoint> = {}): HistoryPoint {
  return { date: '2026-10-01', value: 10_000, netContributions: 9_000, ...overrides };
}

export function history(overrides: Partial<History> = {}): History {
  return {
    currency: 'CAD',
    range: '1M',
    points: [historyPoint(), historyPoint({ date: '2026-10-02', value: 10_100 })],
    ...overrides,
  };
}

export function assetHolding(overrides: Partial<AssetHolding> = {}): AssetHolding {
  return {
    securityId: 's1',
    symbol: 'XYZ',
    name: 'XYZ Corp',
    exchange: 'TSX',
    assetType: 'Stock',
    currency: 'CAD',
    quantity: 10,
    averageCost: 90,
    costBasis: 900,
    price: 100,
    priceDate: '2026-10-30',
    dayChangePercent: 0.0204,
    marketValue: 1_000,
    marketValueLocal: 1_000,
    dayChange: 20,
    unrealizedGain: 100,
    unrealizedGainPercent: 0.111,
    weight: 0.5,
    priceMissing: false,
    portfolios: [{ portfolioId: 'p1', portfolioName: 'Retirement', quantity: 10, value: 1_000 }],
    ...overrides,
  };
}

export function assets(overrides: Partial<Assets> = {}): Assets {
  return {
    currency: 'CAD',
    portfolioCount: 1,
    totalValue: 10_000,
    holdingsValue: 9_000,
    cashValue: 1_000,
    dayChange: 100,
    dayChangePercent: 0.01,
    costBasis: 8_000,
    unrealizedGain: 1_000,
    unrealizedGainPercent: 0.125,
    pricesAsOf: '2026-10-30',
    holdings: [assetHolding()],
    cash: [],
    warnings: [],
    dayChangeDate: '2026-10-30',
    ...overrides,
  };
}

export function me(overrides: Partial<Me> = {}): Me {
  return {
    signedIn: true,
    email: 'ada@example.com',
    passkeys: 0,
    inboxUrl: null,
    publicUrl: 'https://money.example.com',
    hideGains: false,
    ...overrides,
  };
}

export function signedOutMe(overrides: Partial<Me> = {}): Me {
  return me({ signedIn: false, email: null, publicUrl: '', ...overrides });
}

export function passkey(overrides: Partial<Passkey> = {}): Passkey {
  return { id: 'k1', name: 'Laptop', createdAt: '2026-09-01T12:00:00Z', backedUp: true, ...overrides };
}

export function share(overrides: Partial<Share> = {}): Share {
  return { email: 'grace@example.com', canEdit: false, createdAt: '2026-09-01T12:00:00Z', ...overrides };
}

export function refreshRun(overrides: Partial<RefreshRun> = {}): RefreshRun {
  return {
    id: 1,
    startedAt: '2026-10-30T20:55:00Z',
    finishedAt: '2026-10-30T21:00:00Z',
    trigger: 'Scheduled',
    status: 'Succeeded',
    securitiesUpdated: 10,
    securitiesFailed: 0,
    fxRatesStored: 3,
    log: null,
    ...overrides,
  };
}

export function marketStatus(overrides: Partial<MarketStatus> = {}): MarketStatus {
  return {
    running: false,
    lastRun: refreshRun(),
    nextScheduledRun: '2026-10-31T13:00:00Z',
    schedulerEnabled: true,
    fxAsOf: '2026-10-30',
    pricesAsOf: '2026-10-30',
    securitiesTracked: 10,
    securitiesWithErrors: 0,
    fallbackConfigured: false,
    today: '2026-10-30',
    ...overrides,
  };
}

export function version(overrides: Partial<Version> = {}): Version {
  return { version: '1.4.0', commit: 'abc1234', builtAt: '2026-10-23T12:00:00Z', ...overrides };
}
