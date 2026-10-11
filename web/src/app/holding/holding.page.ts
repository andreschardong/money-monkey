import { httpResource } from '@angular/common/http';
import { Component, computed, effect, inject, input, linkedSignal, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { FORMAT_PIPES } from '../core/format';
import { HoldingDetail, PricePoint, Range, Transaction } from '../core/models';
import { PortfolioList } from '../core/stores';
import { TransactionsTable } from '../portfolio/transactions-table';
import { Change } from '../shared/change';
import { TransactionCommands } from '../transactions/transaction-commands';
import { PriceChart } from './price-chart';

@Component({
  selector: 'app-holding-page',
  imports: [RouterLink, MatButtonModule, MatIcon, Change, PriceChart, TransactionsTable, ...FORMAT_PIPES],
  templateUrl: './holding.page.html',
  styleUrl: './holding.page.scss',
})
export class HoldingPage {
  private readonly commands = inject(TransactionCommands);
  private readonly list = inject(PortfolioList);
  private readonly title = inject(Title);

  readonly id = input.required<string>();
  readonly securityId = input.required<string>();
  protected readonly range = signal<Range>('1Y');

  private readonly detailResource = httpResource<HoldingDetail>(() => `/api/portfolios/${this.id()}/holdings/${this.securityId()}`);
  private readonly pricesResource = httpResource<PricePoint[]>(
    () => `/api/securities/${this.securityId()}/prices?range=${this.range()}`, { defaultValue: [] });

  protected readonly detail = linkedSignal<HoldingDetail | undefined, HoldingDetail | undefined>({
    source: () => (this.detailResource.hasValue() ? this.detailResource.value() : undefined),
    computation: (next, previous) => next ?? previous?.value,
  });
  /** Keeps the previous line on screen only while a new range is loading. */
  protected readonly prices = linkedSignal<{ loading: boolean; points: PricePoint[] }, PricePoint[]>({
    source: () => ({
      loading: this.pricesResource.isLoading(),
      points: this.pricesResource.hasValue() ? this.pricesResource.value() : [],
    }),
    computation: (next, previous) => (next.loading && previous ? previous.value : next.points),
  });

  protected readonly portfolioName = computed(() =>
    (this.list.resource.hasValue() ? this.list.resource.value() : []).find(p => p.id === this.id())?.name ?? 'Portfolio');
  protected readonly notFound = computed(() => (this.detailResource.error() as { status?: number } | undefined)?.status === 404);
  protected readonly failed = computed(() => !!this.detailResource.error() && !this.notFound() && !this.detail());

  constructor() {
    effect(() => {
      const symbol = this.detail()?.security.symbol;
      if (symbol) {
        this.title.setTitle(`${symbol} | Money Monkey`);
      }
    });
  }

  protected async add(): Promise<void> {
    const d = this.detail();
    if (!d) {
      return;
    }
    const s = d.security;
    const changed = await this.commands.open({
      portfolioId: this.id(),
      baseCurrency: d.baseCurrency,
      holdings: d.holding ? [d.holding] : [],
      cashCurrencies: [],
      preset: {
        type: 'Buy',
        security: { securityId: s.id, symbol: s.symbol, name: s.name, currency: s.currency, exchange: s.exchange },
      },
    });
    if (changed) {
      this.reload();
    }
  }

  protected async edit(transaction: Transaction): Promise<void> {
    const d = this.detail();
    if (!d) {
      return;
    }
    const changed = await this.commands.open({
      portfolioId: this.id(),
      baseCurrency: d.baseCurrency,
      holdings: d.holding ? [d.holding] : [],
      cashCurrencies: [],
      transaction,
    });
    if (changed) {
      this.reload();
    }
  }

  protected async remove(transaction: Transaction): Promise<void> {
    if (await this.commands.delete(this.id(), transaction)) {
      this.reload();
    }
  }

  protected retry(): void {
    this.reload();
  }

  private reload(): void {
    this.detailResource.reload();
    this.pricesResource.reload();
    this.list.reload();
  }
}
