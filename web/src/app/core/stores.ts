import { httpResource } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Auth } from './auth';
import { Currency, MarketStatus, PORTFOLIO_CURRENCIES, PortfolioSummary, Version } from './models';

/** The portfolio list shown in the navigation rail; reloaded after any change to a portfolio. */
@Injectable({ providedIn: 'root' })
export class PortfolioList {
  private readonly auth = inject(Auth);

  // Idle until someone is signed in, so a signed-out visit doesn't trigger a 401. The account is part of the
  // request so a switch to another account (via an email link) refetches instead of keeping the old list.
  readonly resource = httpResource<PortfolioSummary[]>(
    () => (this.auth.signedIn() ? `/api/portfolios?account=${encodeURIComponent(this.auth.email() ?? '')}` : undefined),
    { defaultValue: [] });

  /** True once the list has come back; the default empty list doesn't count as "no portfolios". */
  readonly loaded = computed(() => this.resource.status() === 'resolved' || this.resource.status() === 'local');

  reload(): void {
    this.resource.reload();
  }
}

/** Freshness of quotes and rates, shown in the rail and on the Prices & rates page. */
@Injectable({ providedIn: 'root' })
export class MarketStatusStore {
  private readonly auth = inject(Auth);

  readonly resource = httpResource<MarketStatus>(
    () => (this.auth.signedIn() ? `/api/market/status?account=${encodeURIComponent(this.auth.email() ?? '')}` : undefined));

  reload(): void {
    this.resource.reload();
  }
}

const DISPLAY_KEY = 'folio.displayCurrency';

/** The running build's version, for the nav footer and the Account page. Anonymous, so it loads once for everyone. */
@Injectable({ providedIn: 'root' })
export class VersionStore {
  readonly resource = httpResource<Version>(() => '/api/version');
  readonly value = computed(() => (this.resource.hasValue() ? this.resource.value() : null));
}

/** The currency the overview totals are shown in. */
@Injectable({ providedIn: 'root' })
export class DisplayCurrency {
  readonly value = signal<Currency>(readDisplayCurrency());

  set(currency: Currency): void {
    this.value.set(currency);
    try {
      localStorage.setItem(DISPLAY_KEY, currency);
    } catch {
      // Storage unavailable: the choice lasts for this visit.
    }
  }
}

function readDisplayCurrency(): Currency {
  try {
    const stored = localStorage.getItem(DISPLAY_KEY);
    return stored && PORTFOLIO_CURRENCIES.includes(stored) ? stored : 'CAD';
  } catch {
    return 'CAD';
  }
}
