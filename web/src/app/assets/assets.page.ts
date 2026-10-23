import { httpResource } from '@angular/common/http';
import { Component, computed, effect, inject, linkedSignal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIcon } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';
import { Auth } from '../core/auth';
import { FORMAT_PIPES, formatMoney, formatQuantity, sessionLabel } from '../core/format';
import { AssetCash, AssetHolding, Assets, IsoDate, PORTFOLIO_CURRENCIES } from '../core/models';
import { DisplayCurrency, MarketStatusStore, PortfolioList } from '../core/stores';
import { Busy } from '../shared/busy';
import { Change } from '../shared/change';
import { HeroFigure } from '../shared/hero-figure';
import { SortHeader, TableSort } from '../shared/table-sort';

/** Everything held across all portfolios: one line per security and per cash currency. */
@Component({
  selector: 'app-assets-page',
  imports: [RouterLink, MatButtonModule, MatButtonToggleModule, MatIcon, Busy, Change, HeroFigure, SortHeader, ...FORMAT_PIPES],
  templateUrl: './assets.page.html',
  styleUrl: './assets.page.scss',
})
export class AssetsPage {
  private readonly router = inject(Router);
  private readonly list = inject(PortfolioList);
  protected readonly display = inject(DisplayCurrency);
  protected readonly auth = inject(Auth);
  private readonly marketStatus = inject(MarketStatusStore);
  protected readonly currencies = PORTFOLIO_CURRENCIES;

  private readonly resource = httpResource<Assets>(() => `/api/assets?currency=${this.display.value()}`);

  /** The last loaded value stays on screen while another currency loads. */
  private readonly reloadOnNewPrices = effect(() => {
    if (this.marketStatus.pricesVersion() > 0) {
      untracked(() => this.resource.reload());
    }
  });

  protected dayLabel(session: IsoDate | null): string {
    return sessionLabel(session, this.marketStatus.today());
  }

  protected readonly assets = linkedSignal<Assets | undefined, Assets | undefined>({
    source: () => (this.resource.hasValue() ? this.resource.value() : undefined),
    computation: (next, previous) => next ?? previous?.value,
  });

  protected readonly sort = new TableSort({ key: 'marketValue', direction: 'desc' });
  protected readonly sortedHoldings = computed(() => this.sort.apply(this.assets()?.holdings ?? [], {
    symbol: h => h.symbol,
    quantity: h => h.quantity,
    averageCost: h => h.averageCost,
    price: h => h.price,
    marketValue: h => h.marketValue,
    unrealizedGain: h => h.unrealizedGain,
    weight: h => h.weight,
  }));

  protected readonly loading = computed(() => this.resource.isLoading());
  protected readonly failed = computed(() => !!this.resource.error() && !this.assets());
  protected readonly empty = computed(() => this.list.loaded() && this.list.resource.value().length === 0);

  protected retry(): void {
    this.resource.reload();
  }

  protected open(portfolioId: string): void {
    void this.router.navigate(['/portfolios', portfolioId]);
  }

  /** "TFSA Andre 100 · RSP Andre 20": where the shares sit. */
  protected sharesBreakdown(h: AssetHolding): string {
    return h.portfolios.map(p => `${p.portfolioName} ${formatQuantity(p.quantity)}`).join(' · ');
  }

  protected cashBreakdown(c: AssetCash): string {
    return c.portfolios.map(p => `${p.portfolioName} ${formatMoney(p.quantity, c.currency)}`).join(' · ');
  }
}
