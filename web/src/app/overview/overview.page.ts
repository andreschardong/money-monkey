import { httpResource } from '@angular/common/http';
import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';
import { FORMAT_PIPES } from '../core/format';
import { History, Overview, PORTFOLIO_CURRENCIES, PortfolioSummary, Range } from '../core/models';
import { DisplayCurrency, PortfolioList } from '../core/stores';
import { PortfolioDialog } from '../portfolio/portfolio-dialog';
import { AllocationBar } from '../shared/allocation-bar';
import { Change } from '../shared/change';
import { HeroFigure } from '../shared/hero-figure';
import { SortHeader, TableSort } from '../shared/table-sort';
import { ValueChart } from '../shared/value-chart';

@Component({
  selector: 'app-overview-page',
  imports: [RouterLink, MatButtonModule, MatButtonToggleModule, MatIcon, Change, HeroFigure, ValueChart, AllocationBar, SortHeader, ...FORMAT_PIPES],
  templateUrl: './overview.page.html',
  styleUrl: './overview.page.scss',
})
export class OverviewPage {
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly list = inject(PortfolioList);
  protected readonly display = inject(DisplayCurrency);

  protected readonly currencies = PORTFOLIO_CURRENCIES;
  protected readonly range = signal<Range>('1Y');

  private readonly overviewResource = httpResource<Overview>(() => `/api/overview?currency=${this.display.value()}`);
  private readonly historyResource = httpResource<History>(
    () => `/api/overview/history?currency=${this.display.value()}&range=${this.range()}`);

  /** The last loaded value is kept while a new currency or range loads, so the page never blanks. */
  protected readonly overview = linkedSignal<Overview | undefined, Overview | undefined>({
    source: () => (this.overviewResource.hasValue() ? this.overviewResource.value() : undefined),
    computation: (next, previous) => next ?? previous?.value,
  });
  protected readonly history = linkedSignal<History | undefined, History | undefined>({
    source: () => (this.historyResource.hasValue() ? this.historyResource.value() : undefined),
    computation: (next, previous) => next ?? previous?.value,
  });

  /** Creation order until a column is clicked. */
  protected readonly portfolioSort = new TableSort();
  protected readonly sortedPortfolios = computed(() => this.portfolioSort.apply(this.overview()?.portfolios ?? [], {
    name: p => p.name, value: p => p.valueInDisplay, today: p => p.dayChangeInDisplay, return: p => p.totalReturnInDisplay,
  }));

  protected readonly loadingOverview = computed(() => this.overviewResource.isLoading());
  protected readonly loadingHistory = computed(() => this.historyResource.isLoading());
  protected readonly failed = computed(() => !!this.overviewResource.error() && !this.overview());
  protected readonly empty = computed(() => this.list.loaded() && this.list.resource.value().length === 0);

  protected open(id: string): void {
    void this.router.navigate(['/portfolios', id]);
  }

  protected createPortfolio(): void {
    this.dialog.open(PortfolioDialog, { autoFocus: 'first-tabbable' }).afterClosed().subscribe((created?: PortfolioSummary) => {
      if (created) {
        this.list.reload();
        void this.router.navigate(['/portfolios', created.id]);
      }
    });
  }

  protected retry(): void {
    this.overviewResource.reload();
    this.historyResource.reload();
  }
}
