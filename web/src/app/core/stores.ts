import { httpResource } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Auth } from './auth';
import { Currency, MarketStatus, PORTFOLIO_CURRENCIES, PortfolioSummary } from './models';

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
  private readonly list = inject(PortfolioList);
  private lastFinished = '';

  readonly resource = httpResource<MarketStatus>(
    () => (this.auth.signedIn() ? `/api/market/status?account=${encodeURIComponent(this.auth.email() ?? '')}` : undefined));

  /** Today in the market's time zone, for labelling day changes. */
  readonly today = computed(() => (this.resource.hasValue() ? this.resource.value().today : null));

  /** Goes up each time a refresh finishes, so pages showing prices can reload. */
  readonly pricesVersion = signal(0);

  constructor() {
    // Quotes refresh every 15 minutes while markets are open; look for a newer run while the page is in view.
    setInterval(() => {
      if (this.auth.signedIn() && document.visibilityState === 'visible') {
        this.resource.reload();
      }
    }, 5 * 60 * 1000);

    effect(() => {
      const finished = this.resource.hasValue() ? this.resource.value().lastRun?.finishedAt ?? '' : '';
      if (finished && this.lastFinished && finished !== this.lastFinished) {
        untracked(() => {
          this.pricesVersion.update(v => v + 1);
          this.list.reload();
        });
      }
      if (finished) {
        this.lastFinished = finished;
      }
    });
  }

  reload(): void {
    this.resource.reload();
  }
}

const DISPLAY_KEY = 'folio.displayCurrency';

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
