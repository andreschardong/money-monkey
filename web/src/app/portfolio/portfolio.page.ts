import { httpResource } from '@angular/common/http';
import { Component, computed, effect, inject, input, linkedSignal, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { Api, problemMessage } from '../core/api';
import { FORMAT_PIPES, formatDate, formatMoney, formatQuantity } from '../core/format';
import { History, PortfolioDetail, Range, RealizedReport, Suggestion, Transaction } from '../core/models';
import { MarketStatusStore, PortfolioList } from '../core/stores';
import { Change } from '../shared/change';
import { confirm } from '../shared/confirm-dialog';
import { HeroFigure } from '../shared/hero-figure';
import { ValueChart } from '../shared/value-chart';
import { TransactionCommands } from '../transactions/transaction-commands';
import { TransactionDialogData, TransactionPreset } from '../transactions/transaction-dialog';
import { HoldingsTable } from './holdings-table';
import { IncomePanel } from './income-panel';
import { CashDialog, CashDialogData } from './cash-dialog';
import { PortfolioDialog } from './portfolio-dialog';
import { ShareDialog, ShareDialogData } from './share-dialog';
import { TransactionsTable } from './transactions-table';

@Component({
  selector: 'app-portfolio-page',
  imports: [
    MatButtonModule, MatIcon, MatMenuModule, MatTabsModule, Change, HeroFigure, ValueChart, HoldingsTable,
    TransactionsTable, IncomePanel, ...FORMAT_PIPES,
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

  readonly id = input.required<string>();
  protected readonly range = signal<Range>('1Y');
  protected readonly tab = signal(0);

  private readonly detailResource = httpResource<PortfolioDetail>(() => `/api/portfolios/${this.id()}`);
  private readonly historyResource = httpResource<History>(() => `/api/portfolios/${this.id()}/history?range=${this.range()}`);
  private readonly transactionsResource = httpResource<Transaction[]>(() => `/api/portfolios/${this.id()}/transactions`, { defaultValue: [] });
  private readonly suggestionsResource = httpResource<Suggestion[]>(() => `/api/portfolios/${this.id()}/suggestions`, { defaultValue: [] });
  private readonly realizedResource = httpResource<RealizedReport>(
    () => (this.tab() === 2 ? `/api/portfolios/${this.id()}/realized` : undefined));

  protected readonly detail = linkedSignal<PortfolioDetail | undefined, PortfolioDetail | undefined>({
    source: () => (this.detailResource.hasValue() ? this.detailResource.value() : undefined),
    computation: (next, previous) => (next ?? (previous?.value?.summary.id === this.id() ? previous?.value : undefined)),
  });
  /** Keeps the chart in place while another range loads, but never shows a different portfolio's history. */
  protected readonly history = linkedSignal<{ id: string; value: History | undefined }, History | undefined>({
    source: () => ({ id: this.id(), value: this.historyResource.hasValue() ? this.historyResource.value() : undefined }),
    computation: (next, previous) => next.value ?? (previous?.source.id === next.id ? previous.value : undefined),
  });

  protected readonly transactions = computed(() => (this.transactionsResource.hasValue() ? this.transactionsResource.value() : []));
  protected readonly suggestions = computed(() => (this.suggestionsResource.hasValue() ? this.suggestionsResource.value() : []));
  protected readonly realized = computed(() => (this.realizedResource.hasValue() ? this.realizedResource.value() : undefined));
  protected readonly notFound = computed(() => {
    const error = this.detailResource.error() as { status?: number } | undefined;
    return error?.status === 404;
  });
  protected readonly failed = computed(() => !!this.detailResource.error() && !this.notFound());
  protected readonly loadingHistory = computed(() => this.historyResource.isLoading());
  /** Shared "to view" hides every way of changing the portfolio. */
  protected readonly canEdit = computed(() => this.detail()?.summary.access !== 'View');
  protected readonly isOwner = computed(() => (this.detail()?.summary.access ?? 'Owner') === 'Owner');

  constructor() {
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

  protected editCash(currency: string | null = null): void {
    const detail = this.detail();
    if (!detail) {
      return;
    }
    const data: CashDialogData = {
      portfolioId: this.id(),
      baseCurrency: detail.summary.baseCurrency,
      balances: detail.cash,
      currency: currency ?? undefined,
    };
    this.dialog.open<CashDialog, CashDialogData, boolean>(CashDialog, { data, autoFocus: 'first-tabbable', maxWidth: '96vw' })
      .afterClosed()
      .subscribe(changed => {
        if (changed) {
          this.snack.open('Cash balance saved.');
          this.refresh();
        }
      });
  }

  protected addTransaction(preset?: TransactionPreset): void {
    void this.openTransactionDialog({ preset });
  }

  protected editTransaction(transaction: Transaction): void {
    void this.openTransactionDialog({ transaction });
  }

  protected async deleteTransaction(transaction: Transaction): Promise<void> {
    if (await this.commands.delete(this.id(), transaction)) {
      this.refresh();
    }
  }

  protected recordSuggestion(s: Suggestion): void {
    const security = { securityId: s.securityId, symbol: s.symbol, name: s.name, currency: s.currency, exchange: null };
    this.addTransaction(s.kind === 'Split'
      ? { type: 'Split', security, date: s.date, splitFrom: s.splitFrom ?? 1, splitTo: s.splitTo ?? 1 }
      : { type: 'Dividend', security, date: s.date, amount: s.amount ?? undefined, currency: s.currency });
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
      return `${s.symbol} split ${formatQuantity(s.splitTo)}-for-${formatQuantity(s.splitFrom)} on ${formatDate(s.date)}. ` +
        'Until the split is recorded, its value and chart are off.';
    }
    return `${s.symbol} went ex-dividend on ${formatDate(s.date)}: ${formatMoney(s.perShare, s.currency)} a share on ` +
      `${formatQuantity(s.quantity)} shares is about ${formatMoney(s.amount, s.currency)}.`;
  }

  protected share(): void {
    const detail = this.detail();
    if (!detail) {
      return;
    }
    const data: ShareDialogData = { portfolioId: this.id(), name: detail.summary.name };
    this.dialog.open<ShareDialog, ShareDialogData, boolean>(ShareDialog, { data, autoFocus: 'first-tabbable', maxWidth: '96vw' })
      .afterClosed()
      .subscribe(changed => {
        if (changed) {
          this.refresh();
        }
      });
  }

  protected editPortfolio(): void {
    const detail = this.detail();
    if (!detail) {
      return;
    }
    this.dialog.open(PortfolioDialog, { data: { portfolio: detail.summary } }).afterClosed().subscribe(saved => {
      if (saved) {
        this.snack.open('Portfolio saved.');
        this.refresh();
      }
    });
  }

  protected async deletePortfolio(): Promise<void> {
    const detail = this.detail();
    if (!detail) {
      return;
    }
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

  private async openTransactionDialog(options: Pick<TransactionDialogData, 'preset' | 'transaction'>): Promise<void> {
    const detail = this.detail();
    if (!detail) {
      return;
    }
    const changed = await this.commands.open({
      portfolioId: this.id(),
      baseCurrency: detail.summary.baseCurrency,
      holdings: detail.holdings,
      cashCurrencies: detail.cash.map(c => c.currency),
      ...options,
    });
    if (changed) {
      this.refresh();
    }
  }
}
