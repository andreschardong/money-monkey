import { httpResource } from '@angular/common/http';
import { Component, computed, effect, inject, input, linkedSignal, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { Api, problemMessage } from '../../core/api';
import { Auth } from '../../core/auth';
import { countryName } from '../../core/countries';
import { FORMAT_PIPES, formatDate, formatMoney, formatQuantity, sessionLabel } from '../../core/format';
import { History, IsoDate, PortfolioDetail, Range, RealizedReport, Suggestion, Transaction } from '../../core/models';
import { MarketStatusStore, PortfolioList } from '../../core/stores';
import { Busy } from '../../atoms/busy/busy';
import { Change } from '../../atoms/change/change';
import { confirm } from '../../molecules/confirm-dialog/confirm-dialog';
import { HeroFigure } from '../../atoms/hero-figure/hero-figure';
import { Notice } from '../../atoms/notice/notice';
import { PageHeader } from '../../molecules/page-header/page-header';
import { Panel } from '../../molecules/panel/panel';
import { StateMessage } from '../../molecules/state-message/state-message';
import { ValueChart } from '../../organisms/value-chart/value-chart';
import { TransactionCommands } from '../../organisms/transaction-dialog/transaction-commands';
import { TransactionDialogData, TransactionPreset } from '../../organisms/transaction-dialog/transaction-dialog';
import { HoldingsTable } from '../../organisms/holdings-table/holdings-table';
import { IncomePanel } from '../../organisms/income-panel/income-panel';
import { CashDialog, CashDialogData } from '../../organisms/cash-dialog/cash-dialog';
import { PortfolioDialog } from '../../organisms/portfolio-dialog/portfolio-dialog';
import { PropertyDialog, PropertyDialogData } from '../../organisms/property-dialog/property-dialog';
import { ShareDialog, ShareDialogData } from '../../organisms/share-dialog/share-dialog';
import { TransactionsTable } from '../../organisms/transactions-table/transactions-table';

@Component({
  selector: 'app-portfolio-page',
  imports: [
    MatButtonModule,
    MatIcon,
    MatMenuModule,
    MatTabsModule,
    Busy,
    Change,
    HeroFigure,
    Notice,
    PageHeader,
    Panel,
    StateMessage,
    ValueChart,
    HoldingsTable,
    TransactionsTable,
    IncomePanel,
    ...FORMAT_PIPES,
  ],
  templateUrl: './portfolio.page.html',
  styleUrl: './portfolio.page.scss',
})
export class PortfolioPage {
  private readonly api = inject(Api);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly title = inject(Title);
  private readonly list = inject(PortfolioList);
  private readonly market = inject(MarketStatusStore);
  private readonly commands = inject(TransactionCommands);
  protected readonly auth = inject(Auth);

  readonly id = input.required<string>();
  protected readonly range = signal<Range>('1Y');
  protected readonly tab = signal(0);
  protected readonly countryName = countryName;

  private readonly detailResource = httpResource<PortfolioDetail>(() => `/api/portfolios/${this.id()}`);
  private readonly historyResource = httpResource<History>(
    () => `/api/portfolios/${this.id()}/history?range=${this.range()}`,
  );
  private readonly transactionsResource = httpResource<Transaction[]>(
    () => `/api/portfolios/${this.id()}/transactions`,
    { defaultValue: [] },
  );
  private readonly suggestionsResource = httpResource<Suggestion[]>(() => `/api/portfolios/${this.id()}/suggestions`, {
    defaultValue: [],
  });
  private readonly realizedResource = httpResource<RealizedReport>(() =>
    this.tab() === 2 ? `/api/portfolios/${this.id()}/realized` : undefined,
  );

  protected readonly detail = linkedSignal<PortfolioDetail | undefined, PortfolioDetail | undefined>({
    source: () => (this.detailResource.hasValue() ? this.detailResource.value() : undefined),
    computation: (next, previous) => next ?? (previous?.value?.summary.id === this.id() ? previous?.value : undefined),
  });
  /** Keeps the chart in place while another range loads, but never shows a different portfolio's history. */
  protected readonly history = linkedSignal<{ id: string; value: History | undefined }, History | undefined>({
    source: () => ({
      id: this.id(),
      value: this.historyResource.hasValue() ? this.historyResource.value() : undefined,
    }),
    computation: (next, previous) => next.value ?? (previous?.source.id === next.id ? previous.value : undefined),
  });

  protected readonly transactions = computed(() =>
    this.transactionsResource.hasValue() ? this.transactionsResource.value() : [],
  );
  protected readonly suggestions = computed(() =>
    this.suggestionsResource.hasValue() ? this.suggestionsResource.value() : [],
  );
  protected readonly realized = computed(() =>
    this.realizedResource.hasValue() ? this.realizedResource.value() : undefined,
  );
  protected readonly notFound = computed(() => {
    const error = this.detailResource.error() as { status?: number } | undefined;
    return error?.status === 404;
  });
  protected readonly failed = computed(() => !!this.detailResource.error() && !this.notFound());
  protected readonly loadingHistory = computed(() => this.historyResource.isLoading());
  protected dayLabel(session: IsoDate | null): string {
    return sessionLabel(session, this.market.today());
  }

  constructor() {
    // Reload when a quote refresh finishes, so "Today" keeps up while the page stays open.
    effect(() => {
      if (this.market.pricesVersion() > 0) {
        untracked(() => this.refresh());
      }
    });

    // Keep the browser tab title in step with the portfolio name.
    effect(() => {
      const name = this.detail()?.summary.name;
      if (name) {
        this.title.setTitle(`${name} | Money Monkey`);
      }
    });
  }

  protected refresh(): void {
    this.detailResource.reload();
    this.historyResource.reload();
    this.transactionsResource.reload();
    this.suggestionsResource.reload();
    this.realizedResource.reload();
    this.list.reload();
    this.market.reload();
  }

  protected openHolding(securityId: string): void {
    void this.router.navigate(['holdings', securityId], { relativeTo: this.route });
  }

  protected editCash(detail: PortfolioDetail, currency: string | null = null): void {
    const data: CashDialogData = {
      portfolioId: this.id(),
      baseCurrency: detail.summary.baseCurrency,
      balances: detail.cash,
      currency: currency ?? undefined,
    };
    this.dialog
      .open<CashDialog, CashDialogData, boolean>(CashDialog, { data, autoFocus: 'first-tabbable', maxWidth: '96vw' })
      .afterClosed()
      .subscribe((changed) => {
        if (changed) {
          this.snack.open('Cash balance saved.');
          this.refresh();
        }
      });
  }

  protected addTransaction(detail: PortfolioDetail, preset?: TransactionPreset): void {
    void this.openTransactionDialog(detail, { preset });
  }

  protected addProperty(detail: PortfolioDetail): void {
    const data: PropertyDialogData = { portfolioId: this.id(), baseCurrency: detail.summary.baseCurrency };
    this.dialog
      .open<PropertyDialog, PropertyDialogData, boolean>(PropertyDialog, {
        data,
        autoFocus: 'first-tabbable',
        maxWidth: '96vw',
      })
      .afterClosed()
      .subscribe((added) => {
        if (added) {
          this.snack.open('Property added.');
          this.refresh();
        }
      });
  }

  protected editTransaction(detail: PortfolioDetail, transaction: Transaction): void {
    void this.openTransactionDialog(detail, { transaction });
  }

  protected async deleteTransaction(transaction: Transaction): Promise<void> {
    if (await this.commands.delete(this.id(), transaction)) {
      this.refresh();
    }
  }

  protected recordSuggestion(detail: PortfolioDetail, s: Suggestion): void {
    const security = { securityId: s.securityId, symbol: s.symbol, name: s.name, currency: s.currency, exchange: null };
    this.addTransaction(
      detail,
      s.kind === 'Split'
        ? { type: 'Split', security, date: s.date, splitFrom: s.splitFrom ?? 1, splitTo: s.splitTo ?? 1 }
        : { type: 'Dividend', security, date: s.date, amount: s.amount ?? undefined, currency: s.currency },
    );
  }

  protected async dismissSuggestion(s: Suggestion): Promise<void> {
    try {
      await this.api.dismissSuggestion(this.id(), s.securityId, s.date, s.kind);
      this.suggestionsResource.reload();
    } catch (error) {
      this.snack.open(problemMessage(error), 'Close');
    }
  }

  protected describeSuggestion(s: Suggestion): string {
    if (s.kind === 'Split') {
      return (
        `${s.symbol} split ${formatQuantity(s.splitTo)}-for-${formatQuantity(s.splitFrom)} on ${formatDate(s.date)}. ` +
        'Until the split is recorded, its value and chart are off.'
      );
    }
    return (
      `${s.symbol} went ex-dividend on ${formatDate(s.date)}: ${formatMoney(s.perShare, s.currency)} a share on ` +
      `${formatQuantity(s.quantity)} shares is about ${formatMoney(s.amount, s.currency)}.`
    );
  }

  protected share(detail: PortfolioDetail): void {
    const data: ShareDialogData = { portfolioId: this.id(), name: detail.summary.name };
    this.dialog
      .open<ShareDialog, ShareDialogData, boolean>(ShareDialog, { data, autoFocus: 'first-tabbable', maxWidth: '96vw' })
      .afterClosed()
      .subscribe((changed) => {
        if (changed) {
          this.refresh();
        }
      });
  }

  protected editPortfolio(detail: PortfolioDetail): void {
    this.dialog
      .open(PortfolioDialog, { data: { portfolio: detail.summary } })
      .afterClosed()
      .subscribe((saved) => {
        if (saved) {
          this.snack.open('Portfolio saved.');
          this.refresh();
        }
      });
  }

  protected async deletePortfolio(detail: PortfolioDetail): Promise<void> {
    const count = detail.summary.transactionsCount;
    const confirmed = await confirm(this.dialog, {
      title: `Delete ${detail.summary.name}?`,
      message: `This removes the portfolio and its ${count} transaction${count === 1 ? '' : 's'}. It cannot be undone.`,
      confirm: 'Delete portfolio',
      destructive: true,
    });
    if (!confirmed) {
      return;
    }
    try {
      await this.api.deletePortfolio(this.id());
      this.list.reload();
      this.snack.open('Portfolio deleted.');
      void this.router.navigate(['/']);
    } catch (error) {
      this.snack.open(problemMessage(error), 'Close');
    }
  }

  private async openTransactionDialog(
    detail: PortfolioDetail,
    options: Pick<TransactionDialogData, 'preset' | 'transaction'>,
  ): Promise<void> {
    const changed = await this.commands.open({
      portfolioId: this.id(),
      baseCurrency: detail.summary.baseCurrency,
      holdings: detail.holdings,
      cashCurrencies: detail.cash.map((c) => c.currency),
      ...options,
    });
    if (changed) {
      this.refresh();
    }
  }
}
