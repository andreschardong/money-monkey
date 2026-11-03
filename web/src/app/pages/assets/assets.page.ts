import { httpResource } from '@angular/common/http';
import { Component, computed, effect, inject, linkedSignal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { Auth } from '../../core/auth';
import { FORMAT_PIPES, sessionLabel } from '../../core/format';
import { AssetHolding, Assets, IsoDate } from '../../core/models';
import { DisplayCurrency, MarketStatusStore, PortfolioList } from '../../core/stores';
import { CurrencySwitch } from '../../molecules/currency-switch/currency-switch';
import { Panel } from '../../molecules/panel/panel';
import { StateMessage } from '../../molecules/state-message/state-message';
import { Busy } from '../../atoms/busy/busy';
import { Change } from '../../atoms/change/change';
import { HeroFigure } from '../../atoms/hero-figure/hero-figure';
import { Notice } from '../../atoms/notice/notice';
import { SortHeader, TableSort } from '../../atoms/table-sort/table-sort';

/** Everything held across all portfolios: one line per security and per cash currency. */
@Component({
  selector: 'app-assets-page',
  imports: [
    RouterLink,
    MatButtonModule,
    Busy,
    Change,
    HeroFigure,
    Notice,
    CurrencySwitch,
    Panel,
    SortHeader,
    StateMessage,
    ...FORMAT_PIPES,
  ],
  templateUrl: './assets.page.html',
  styleUrl: './assets.page.scss',
})
export class AssetsPage {
  private readonly list = inject(PortfolioList);
  protected readonly display = inject(DisplayCurrency);
  protected readonly auth = inject(Auth);
  private readonly marketStatus = inject(MarketStatusStore);

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
  protected sortedHoldings(a: Assets): AssetHolding[] {
    return this.sort.apply(a.holdings, {
      symbol: (h) => h.symbol,
      quantity: (h) => h.quantity,
      averageCost: (h) => h.averageCost,
      price: (h) => h.price,
      marketValue: (h) => h.marketValue,
      unrealizedGain: (h) => h.unrealizedGain,
      weight: (h) => h.weight,
    });
  }

  protected readonly loading = computed(() => this.resource.isLoading());
  protected readonly failed = computed(() => !!this.resource.error() && !this.assets());
  protected readonly empty = computed(() => this.list.loaded() && this.list.resource.value().length === 0);

  protected retry(): void {
    this.resource.reload();
  }
}
