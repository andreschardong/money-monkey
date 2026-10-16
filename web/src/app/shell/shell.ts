import { BreakpointObserver } from '@angular/cdk/layout';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatTooltip } from '@angular/material/tooltip';
import {
  NavigationCancel, NavigationEnd, NavigationError, NavigationSkipped, NavigationStart, Router, RouterLink, RouterLinkActive, RouterOutlet,
} from '@angular/router';
import { filter, map, of, switchMap, timer } from 'rxjs';
import { Auth } from '../core/auth';
import { Pwa } from '../core/pwa';
import { FORMAT_PIPES } from '../core/format';
import { PortfolioSummary } from '../core/models';
import { MarketStatusStore, PortfolioList, VersionStore } from '../core/stores';
import { Theme } from '../core/theme';
import { PortfolioDialog } from '../portfolio/portfolio-dialog';
import { Busy } from '../shared/busy';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatSidenavModule, MatButtonModule, MatIcon, MatProgressBar, MatTooltip, Busy, ...FORMAT_PIPES],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly list = inject(PortfolioList);
  private readonly market = inject(MarketStatusStore);
  protected readonly theme = inject(Theme);
  protected readonly auth = inject(Auth);
  // Instantiated here so update checks and the install prompt are live from the first page.
  protected readonly pwa = inject(Pwa);
  protected readonly version = inject(VersionStore).value;

  protected readonly wide = toSignal(
    inject(BreakpointObserver).observe('(min-width: 960px)').pipe(map(state => state.matches)),
    { initialValue: true });
  protected readonly menuOpen = signal(false);

  /**
   * A page on its way: its code is downloading or its guard is waiting. Shown after a short grace, so a page that
   * arrives at once never flashes a bar. The first session check has the spinner instead.
   */
  private readonly navigationPending = toSignal(this.router.events.pipe(
    filter(e => e instanceof NavigationStart || e instanceof NavigationEnd || e instanceof NavigationCancel
      || e instanceof NavigationError || e instanceof NavigationSkipped),
    map(e => e instanceof NavigationStart),
    switchMap(pending => (pending ? timer(200).pipe(map(() => true)) : of(false)))), { initialValue: false });
  protected readonly navigating = computed(() => this.auth.settled() && this.navigationPending());

  protected readonly portfolios = computed(() => (this.list.resource.hasValue() ? this.list.resource.value() : []));
  protected readonly listLoaded = this.list.loaded;
  protected readonly status = computed(() => (this.market.resource.hasValue() ? this.market.resource.value() : null));

  protected readonly themeLabel = computed(() =>
    ({ system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' })[this.theme.preference()]);
  protected readonly themeIcon = computed(() =>
    ({ system: 'contrast', light: 'light_mode', dark: 'dark_mode' })[this.theme.preference()]);

  /** Quotes are stale when the last refresh failed or the newest close is more than four days old. */
  protected readonly stale = computed(() => {
    const status = this.status();
    if (!status || status.securitiesTracked === 0) {
      return false;
    }
    if (status.lastRun?.status === 'Failed') {
      return true;
    }
    if (!status.pricesAsOf) {
      return true;
    }
    const age = (Date.parse(status.today) - Date.parse(status.pricesAsOf)) / 86_400_000;
    return age > 4;
  });

  constructor() {
    // Close the drawer after navigating on small screens.
    const navigated = toSignal(this.router.events.pipe(filter(e => e instanceof NavigationEnd)));
    effect(() => {
      navigated();
      this.menuOpen.set(false);
    });
  }

  protected newPortfolio(): void {
    this.dialog.open(PortfolioDialog, { autoFocus: 'first-tabbable' }).afterClosed().subscribe((created?: PortfolioSummary) => {
      if (created) {
        this.list.reload();
        void this.router.navigate(['/portfolios', created.id]);
      }
    });
  }
}
