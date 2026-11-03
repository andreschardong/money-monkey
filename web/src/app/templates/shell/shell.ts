import { BreakpointObserver } from '@angular/cdk/layout';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatSidenavModule } from '@angular/material/sidenav';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationSkipped,
  NavigationStart,
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';
import { filter, map, of, switchMap, timer } from 'rxjs';
import { Auth } from '../../core/auth';
import { Pwa } from '../../core/pwa';
import { Theme } from '../../core/theme';
import { Busy } from '../../atoms/busy/busy';
import { NavRail } from '../../organisms/nav-rail/nav-rail';

/**
 * The frame around every page: the navigation drawer (the rail when signed in, a top bar and menu button on
 * phones), the loading bar and boot spinner, and the one router outlet.
 */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, MatSidenavModule, MatButtonModule, MatIcon, MatProgressBar, Busy, NavRail],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  private readonly router = inject(Router);
  protected readonly theme = inject(Theme);
  protected readonly auth = inject(Auth);

  protected readonly wide = toSignal(
    inject(BreakpointObserver)
      .observe('(min-width: 960px)')
      .pipe(map((state) => state.matches)),
    { initialValue: true },
  );
  protected readonly menuOpen = signal(false);

  /**
   * A page on its way: its code is downloading or its guard is waiting. Shown after a short grace, so a page that
   * arrives at once never flashes a bar. The first session check has the spinner instead.
   */
  private readonly navigationPending = toSignal(
    this.router.events.pipe(
      filter(
        (e) =>
          e instanceof NavigationStart ||
          e instanceof NavigationEnd ||
          e instanceof NavigationCancel ||
          e instanceof NavigationError ||
          e instanceof NavigationSkipped,
      ),
      map((e) => e instanceof NavigationStart),
      switchMap((pending) => (pending ? timer(200).pipe(map(() => true)) : of(false))),
    ),
    { initialValue: false },
  );
  protected readonly navigating = computed(() => this.auth.settled() && this.navigationPending());

  protected readonly themeLabel = computed(
    () => ({ system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' })[this.theme.preference()],
  );
  protected readonly themeIcon = computed(
    () => ({ system: 'contrast', light: 'light_mode', dark: 'dark_mode' })[this.theme.preference()],
  );

  constructor() {
    // Instantiated here so update checks and the install prompt are live from the first page, signed in or not.
    inject(Pwa);
    // Close the drawer after navigating on small screens.
    const navigated = toSignal(this.router.events.pipe(filter((e) => e instanceof NavigationEnd)));
    effect(() => {
      navigated();
      this.menuOpen.set(false);
    });
  }
}
