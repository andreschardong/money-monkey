import { httpResource } from '@angular/common/http';
import { Component, computed, effect, inject, input, linkedSignal, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { Auth } from '../../core/auth';
import { FORMAT_PIPES } from '../../core/format';
import { HoldingDetail, PricePoint, Range, Transaction } from '../../core/models';
import { PortfolioList } from '../../core/stores';
import {
  ManualSecurityDialog,
  ManualSecurityDialogData,
} from '../../organisms/manual-security-dialog/manual-security-dialog';
import { TransactionsTable } from '../../organisms/transactions-table/transactions-table';
import { Busy } from '../../atoms/busy/busy';
import { Change } from '../../atoms/change/change';
import { PageHeader } from '../../molecules/page-header/page-header';
import { Panel } from '../../molecules/panel/panel';
import { StateMessage } from '../../molecules/state-message/state-message';
import { TransactionCommands } from '../../organisms/transaction-dialog/transaction-commands';
import { PriceChart } from '../../organisms/price-chart/price-chart';

@Component({
  selector: 'app-holding-page',
  imports: [
    RouterLink,
    MatButtonModule,
    MatIcon,
    Busy,
    Change,
    PageHeader,
    Panel,
    PriceChart,
    StateMessage,
    TransactionsTable,
    ...FORMAT_PIPES,
  ],
  templateUrl: './holding.page.html',
  styleUrl: './holding.page.scss',
})
export class HoldingPage {
  private readonly commands = inject(TransactionCommands);
  private readonly list = inject(PortfolioList);
  private readonly title = inject(Title);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  protected readonly auth = inject(Auth);

  readonly id = input.required<string>();
  readonly securityId = input.required<string>();
  protected readonly range = signal<Range>('1Y');

  private readonly detailResource = httpResource<HoldingDetail>(
    () => `/api/portfolios/${this.id()}/holdings/${this.securityId()}`,
  );
  private readonly pricesResource = httpResource<PricePoint[]>(
    () => `/api/securities/${this.securityId()}/prices?range=${this.range()}`,
    { defaultValue: [] },
  );

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

  protected readonly portfolioName = computed(
    () =>
      (this.list.resource.hasValue() ? this.list.resource.value() : []).find((p) => p.id === this.id())?.name ??
      'Portfolio',
  );
  protected readonly notFound = computed(
    () => (this.detailResource.error() as { status?: number } | undefined)?.status === 404,
  );
  protected readonly failed = computed(() => !!this.detailResource.error() && !this.notFound() && !this.detail());
  protected readonly isProperty = computed(() => this.detail()?.security.assetType === 'RealEstate');

  constructor() {
    effect(() => {
      const symbol = this.detail()?.security.symbol;
      if (symbol) {
        this.title.setTitle(`${symbol} | Money Monkey`);
      }
    });
  }

  protected async add(): Promise<void> {
    const d = this.detail()!;
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
    const d = this.detail()!;
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

  protected updatePrice(): void {
    const security = this.detail()!.security;
    this.dialog
      .open<ManualSecurityDialog, ManualSecurityDialogData, boolean>(ManualSecurityDialog, {
        data: { security },
        autoFocus: 'first-tabbable',
        maxWidth: '96vw',
      })
      .afterClosed()
      .subscribe((saved) => {
        if (saved) {
          this.snack.open(this.isProperty() ? 'Value saved.' : 'Price saved.');
          this.reload();
        }
      });
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
