import { httpResource } from '@angular/common/http';
import { Component, computed, effect, inject, input, linkedSignal, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute, Router } from '@angular/router';
import { Api, problemMessage } from '../core/api';
import { Auth } from '../core/auth';
import { FORMAT_PIPES } from '../core/format';
import { CorporateAction, PricePoint, Range, Security, Transaction } from '../core/models';
import { PriceChart } from '../holding/price-chart';
import { Change } from '../shared/change';
import { SortHeader, TableSort } from '../shared/table-sort';
import { PickedSecurity, SecurityPicker } from '../transactions/security-picker';

interface RecentClose {
  date: string;
  close: number;
  change: number | null;
  changePercent: number | null;
}

/** Look up any symbol: latest quote, a history chart, recent closes, and the dividends and splits on record. */
@Component({
  selector: 'app-quotes-page',
  imports: [MatButtonModule, SecurityPicker, PriceChart, Change, SortHeader, ...FORMAT_PIPES],
  templateUrl: './quotes.page.html',
  styleUrl: './quotes.page.scss',
})
export class QuotesPage {
  private readonly api = inject(Api);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly auth = inject(Auth);

  /** From the address bar (?symbol=SHOP.TO), so a quote can be linked to. */
  readonly symbol = input<string>();

  protected readonly picked = signal<PickedSecurity | null>(null);
  protected readonly range = signal<Range>('1Y');
  protected readonly lookupError = signal<string | null>(null);
  protected readonly noTrades: Transaction[] = [];

  private readonly id = computed(() => this.picked()?.securityId ?? null);
  private readonly securityResource = httpResource<Security>(() => (this.id() ? `/api/securities/${this.id()}` : undefined));
  private readonly pricesResource = httpResource<PricePoint[]>(
    () => (this.id() ? `/api/securities/${this.id()}/prices?range=${this.range()}` : undefined), { defaultValue: [] });
  private readonly actionsResource = httpResource<CorporateAction[]>(
    () => (this.id() ? `/api/securities/${this.id()}/actions` : undefined), { defaultValue: [] });

  protected readonly security = computed(() => (this.securityResource.hasValue() ? this.securityResource.value() : undefined));
  protected readonly actions = computed(() => (this.actionsResource.hasValue() ? this.actionsResource.value() : []));
  protected readonly loadingPrices = computed(() => this.pricesResource.isLoading());

  /** Keeps the previous line on screen only while a new range of the same security is loading. */
  protected readonly prices = linkedSignal<{ id: string | null; loading: boolean; points: PricePoint[] }, PricePoint[]>({
    source: () => ({
      id: this.id(),
      loading: this.pricesResource.isLoading(),
      points: this.pricesResource.hasValue() ? this.pricesResource.value() : [],
    }),
    computation: (next, previous) => (next.loading && previous && previous.source.id === next.id ? previous.value : next.points),
  });

  protected readonly stats = computed(() => {
    const points = this.prices();
    if (points.length < 2) {
      return null;
    }
    const first = points[0];
    const last = points[points.length - 1];
    let high = first;
    let low = first;
    for (const point of points) {
      if (point.close > high.close) high = point;
      if (point.close < low.close) low = point;
    }
    return {
      first,
      last,
      change: last.close - first.close,
      changePercent: first.close > 0 ? (last.close - first.close) / first.close : null,
      high,
      low,
      days: points.length,
    };
  });

  protected readonly closeSort = new TableSort({ key: 'date', direction: 'desc' });
  protected readonly recent = computed<RecentClose[]>(() => {
    const points = this.prices();
    const rows: RecentClose[] = [];
    for (let i = points.length - 1; i >= 0 && rows.length < 15; i--) {
      const previous = points[i - 1];
      rows.push({
        date: points[i].date,
        close: points[i].close,
        change: previous ? points[i].close - previous.close : null,
        changePercent: previous && previous.close > 0 ? (points[i].close - previous.close) / previous.close : null,
      });
    }
    return this.closeSort.apply(rows, { date: r => r.date, close: r => r.close, change: r => r.change, changePercent: r => r.changePercent });
  });

  protected readonly actionSort = new TableSort({ key: 'date', direction: 'desc' });
  protected readonly sortedActions = computed(() =>
    this.actionSort.apply(this.actions(), { date: a => a.date, kind: a => a.kind, amount: a => (a.kind === 'Dividend' ? a.amount : a.numerator / a.denominator) }));

  constructor() {
    // A symbol in the address bar is looked up once.
    effect(() => {
      const symbol = this.symbol()?.trim();
      if (symbol && symbol.toUpperCase() !== untracked(this.picked)?.symbol) {
        void this.lookup(symbol);
      }
    });

    // The address bar follows the pick, so the page can be bookmarked or shared.
    effect(() => {
      const picked = this.picked();
      if (picked && picked.symbol !== untracked(this.symbol)) {
        void this.router.navigate([], { relativeTo: this.route, queryParams: { symbol: picked.symbol }, replaceUrl: true });
      }
    });
  }

  protected splitLabel(action: CorporateAction): string {
    return `${action.numerator}-for-${action.denominator}`;
  }

  private async lookup(symbol: string): Promise<void> {
    this.lookupError.set(null);
    try {
      const security = await this.api.resolveSecurity(symbol, null);
      this.picked.set({ securityId: security.id, symbol: security.symbol, name: security.name, currency: security.currency, exchange: security.exchange });
    } catch (error) {
      this.lookupError.set(problemMessage(error));
    }
  }
}
