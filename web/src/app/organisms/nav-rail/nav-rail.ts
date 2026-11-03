import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { Auth } from '../../core/auth';
import { FORMAT_PIPES } from '../../core/format';
import { MarketStatus, PortfolioSummary } from '../../core/models';
import { Pwa } from '../../core/pwa';
import { MarketStatusStore, PortfolioList, VersionStore } from '../../core/stores';
import { Theme } from '../../core/theme';
import { PortfolioDialog } from '../portfolio-dialog/portfolio-dialog';

/**
 * The signed-in navigation: the wordmark, the main pages, the person's portfolios (with a way to add one), and
 * the footer with the price-freshness badge, account, theme, install and version links. It reads its own lists
 * from the shared stores; the shell around it only decides when the drawer is open.
 */
@Component({
  // An attribute selector keeps the native nav element (and its landmark role) instead of wrapping it.
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'nav[appNavRail]',
  imports: [RouterLink, RouterLinkActive, MatButtonModule, MatIcon, MatTooltip, ...FORMAT_PIPES],
  templateUrl: './nav-rail.html',
  styleUrl: './nav-rail.scss',
  host: { 'aria-label': 'Main' },
})
export class NavRail {
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly list = inject(PortfolioList);
  private readonly market = inject(MarketStatusStore);
  protected readonly theme = inject(Theme);
  protected readonly auth = inject(Auth);
  protected readonly pwa = inject(Pwa);
  protected readonly version = inject(VersionStore).value;

  protected readonly portfolios = computed(() => (this.list.resource.hasValue() ? this.list.resource.value() : []));
  protected readonly listLoaded = this.list.loaded;
  protected readonly status = computed(() => (this.market.resource.hasValue() ? this.market.resource.value() : null));

  protected readonly themeLabel = computed(
    () => ({ system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' })[this.theme.preference()],
  );
  protected readonly themeIcon = computed(
    () => ({ system: 'contrast', light: 'light_mode', dark: 'dark_mode' })[this.theme.preference()],
  );

  /** Quotes are stale when the last refresh failed or the newest close is more than four days old. */
  protected stale(status: MarketStatus): boolean {
    if (status.lastRun?.status === 'Failed') {
      return true;
    }
    if (!status.pricesAsOf) {
      return true;
    }
    const age = (Date.parse(status.today) - Date.parse(status.pricesAsOf)) / 86_400_000;
    return age > 4;
  }

  protected newPortfolio(): void {
    this.dialog
      .open(PortfolioDialog, { autoFocus: 'first-tabbable' })
      .afterClosed()
      .subscribe((created?: PortfolioSummary) => {
        if (created) {
          this.list.reload();
          void this.router.navigate(['/portfolios', created.id]);
        }
      });
  }
}
