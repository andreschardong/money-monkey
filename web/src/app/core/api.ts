import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import {
  AssetType,
  CashEntry,
  Currency,
  FxRates,
  ImportResult,
  IsoDate,
  PortfolioKind,
  PortfolioSummary,
  PriceOn,
  Problem,
  Security,
  SetCashRequest,
  Share,
  SymbolMatch,
  Transaction,
  TransactionRequest,
  CorporateActionKind,
} from './models';

/** Commands against the API. Reads that drive a view use httpResource in the component instead. */
@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);

  createPortfolio(name: string, baseCurrency: Currency, description: string | null, country: string | null, kind: PortfolioKind) {
    return this.send(this.http.post<PortfolioSummary>('/api/portfolios', { name, baseCurrency, description, country, kind }));
  }

  updatePortfolio(id: string, name: string, baseCurrency: Currency, description: string | null, country: string | null, kind: PortfolioKind) {
    return this.send(this.http.put<PortfolioSummary>(`/api/portfolios/${id}`, { name, baseCurrency, description, country, kind }));
  }

  deletePortfolio(id: string) {
    return this.send(this.http.delete<void>(`/api/portfolios/${id}`));
  }

  addTransaction(portfolioId: string, request: TransactionRequest) {
    return this.send(this.http.post<Transaction[]>(`/api/portfolios/${portfolioId}/transactions`, request));
  }

  updateTransaction(portfolioId: string, transactionId: string, request: TransactionRequest) {
    return this.send(this.http.put<Transaction>(`/api/portfolios/${portfolioId}/transactions/${transactionId}`, request));
  }

  deleteTransaction(portfolioId: string, transactionId: string) {
    return this.send(this.http.delete<void>(`/api/portfolios/${portfolioId}/transactions/${transactionId}`));
  }

  cashEntries(portfolioId: string) {
    return this.send(this.http.get<CashEntry[]>(`/api/portfolios/${portfolioId}/cash`));
  }

  setCash(portfolioId: string, request: SetCashRequest) {
    return this.send(this.http.put<CashEntry>(`/api/portfolios/${portfolioId}/cash`, request));
  }

  deleteCash(portfolioId: string, currency: Currency, date: IsoDate) {
    return this.send(this.http.delete<void>(`/api/portfolios/${portfolioId}/cash/${encodeURIComponent(currency)}/${date}`));
  }

  dismissSuggestion(portfolioId: string, securityId: string, date: IsoDate, kind: CorporateActionKind) {
    return this.send(this.http.post<void>(`/api/portfolios/${portfolioId}/suggestions/dismiss`, { securityId, date, kind }));
  }

  searchSecurities(query: string) {
    return this.http.get<SymbolMatch[]>('/api/securities/search', { params: { q: query } });
  }

  resolveSecurity(symbol: string, historyFrom: IsoDate | null) {
    return this.send(this.http.post<Security>('/api/securities', { symbol, historyFrom }));
  }

  createManualSecurity(symbol: string, name: string, currency: Currency, assetType: AssetType, price: number | null, date: IsoDate | null) {
    return this.send(this.http.post<Security>('/api/securities/manual', { symbol, name, currency, assetType, price, date }));
  }

  setManualPrice(securityId: string, date: IsoDate, close: number) {
    return this.send(this.http.post<void>(`/api/securities/${securityId}/prices`, { date, close }));
  }

  priceOn(securityId: string, date: IsoDate) {
    return this.send(this.http.get<PriceOn>(`/api/securities/${securityId}/price-on`, { params: { date } }));
  }

  fxRates(date: IsoDate) {
    return this.send(this.http.get<FxRates>('/api/fx', { params: { date } }));
  }

  shares(portfolioId: string) {
    return this.send(this.http.get<Share[]>(`/api/portfolios/${portfolioId}/shares`));
  }

  share(portfolioId: string, email: string, canEdit: boolean) {
    return this.send(this.http.put<Share[]>(`/api/portfolios/${portfolioId}/shares`, { email, canEdit }));
  }

  unshare(portfolioId: string, email: string) {
    return this.send(this.http.delete<Share[]>(`/api/portfolios/${portfolioId}/shares`, { params: { email } }));
  }

  importData(file: unknown) {
    return this.send(this.http.post<ImportResult>('/api/import', file));
  }

  refreshMarketData() {
    return this.send(this.http.post<void>('/api/market/refresh', null));
  }

  private send<T>(request: Observable<T>): Promise<T> {
    return firstValueFrom(request);
  }
}

/** The message to show for a failed request: the API's problem detail when there is one. */
export function problemMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const problem = error.error as Problem | null;
    if (problem && typeof problem === 'object' && problem.detail) {
      return problem.detail;
    }
    if (error.status === 0) {
      return 'The Money Monkey server is not reachable. Check that it is running.';
    }
    if (error.status === 409 && typeof error.error === 'string') {
      return error.error;
    }
    return `The request failed (${error.status} ${error.statusText}).`;
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}
