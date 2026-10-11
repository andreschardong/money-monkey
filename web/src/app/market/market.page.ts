import { httpResource } from '@angular/common/http';
import { Component, DestroyRef, computed, effect, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { Api, problemMessage } from '../core/api';
import { FORMAT_PIPES, formatRate } from '../core/format';
import { FxRates, RefreshStatus, Security } from '../core/models';
import { MarketStatusStore, PortfolioList } from '../core/stores';
import { Change } from '../shared/change';
import { SortHeader, TableSort } from '../shared/table-sort';
import { ManualSecurityDialog } from './manual-security-dialog';

const STATUS_TEXT: Record<RefreshStatus, string> = {
  Running: 'Running now',
  Succeeded: 'Up to date',
  PartiallySucceeded: 'Some quotes failed',
  Failed: 'Failed',
};

@Component({
  selector: 'app-market-page',
  imports: [RouterLink, MatButtonModule, MatIcon, MatTooltip, Change, SortHeader, ...FORMAT_PIPES],
  templateUrl: './market.page.html',
  styleUrl: './market.page.scss',
})
export class MarketPage {
  private readonly api = inject(Api);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly store = inject(MarketStatusStore);
  private readonly list = inject(PortfolioList);

  private readonly fxResource = httpResource<FxRates>(() => '/api/fx');
  private readonly securitiesResource = httpResource<Security[]>(() => '/api/securities', { defaultValue: [] });

  protected readonly status = computed(() => (this.store.resource.hasValue() ? this.store.resource.value() : undefined));
  protected readonly fx = computed(() => (this.fxResource.hasValue() ? this.fxResource.value() : undefined));
  protected readonly securities = computed(() => (this.securitiesResource.hasValue() ? this.securitiesResource.value() : []));
  protected readonly running = computed(() => this.status()?.running ?? false);
  protected readonly statusText = computed(() => {
    const run = this.status()?.lastRun;
    return run ? STATUS_TEXT[this.running() ? 'Running' : run.status] : 'Never refreshed';
  });

  /** Rates against CAD, plus the USD and EUR crosses most people need. */
  protected readonly rates = computed(() => {
    const fx = this.fx();
    if (!fx) {
      return [];
    }
    const cad = (c: string) => fx.rates.find(r => r.from === c)?.rate;
    const rows = fx.rates
      .filter(r => r.from !== 'CAD')
      .map(r => ({ pair: `${r.from} to CAD`, value: r.rate, rate: formatRate(r.rate), inverse: `CAD to ${r.from}`, inverseRate: formatRate(1 / r.rate) }));
    const usd = cad('USD');
    const eur = cad('EUR');
    if (usd && eur) {
      rows.push({ pair: 'EUR to USD', value: eur / usd, rate: formatRate(eur / usd), inverse: 'USD to EUR', inverseRate: formatRate(usd / eur) });
    }
    return rows;
  });

  protected readonly rateSort = new TableSort();
  protected readonly sortedRates = computed(() => this.rateSort.apply(this.rates(), { pair: r => r.pair, rate: r => r.value }));

  protected readonly securitySort = new TableSort({ key: 'symbol', direction: 'asc' });
  protected readonly sortedSecurities = computed(() => this.securitySort.apply(this.securities(), {
    symbol: s => s.symbol,
    name: s => s.name,
    exchange: s => s.exchange,
    lastPrice: s => s.lastPrice,
    change: s => s.dayChangePercent,
    date: s => s.lastPriceDate,
    source: s => (s.lastRefreshError ? 'Failed' : s.priceSource === 'Manual' ? 'Manual' : 'Yahoo'),
  }));

  constructor() {
    // While a refresh runs, poll its status; when it finishes, reload what it changed.
    let timer: ReturnType<typeof setInterval> | undefined;
    let wasRunning = false;
    effect(() => {
      const running = this.running();
      if (running && !timer) {
        timer = setInterval(() => this.store.reload(), 1500);
      } else if (!running && timer) {
        clearInterval(timer);
        timer = undefined;
      }
      if (wasRunning && !running) {
        this.securitiesResource.reload();
        this.fxResource.reload();
        this.list.reload();
      }
      wasRunning = running;
    });
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected async refresh(): Promise<void> {
    try {
      await this.api.refreshMarketData();
      this.snack.open('Refreshing quotes and exchange rates.');
    } catch (error) {
      this.snack.open(problemMessage(error), 'Close');
    }
    this.store.reload();
  }

  protected addManual(): void {
    this.dialog.open(ManualSecurityDialog, { autoFocus: 'first-tabbable' }).afterClosed().subscribe(saved => {
      if (saved) {
        this.snack.open('Security added. Find it by its code when you add a transaction.');
        this.securitiesResource.reload();
      }
    });
  }

  protected updatePrice(security: Security): void {
    this.dialog.open(ManualSecurityDialog, { data: { security }, autoFocus: 'first-tabbable' }).afterClosed().subscribe(saved => {
      if (saved) {
        this.snack.open(`Price of ${security.symbol} saved.`);
        this.securitiesResource.reload();
        this.list.reload();
      }
    });
  }
}
