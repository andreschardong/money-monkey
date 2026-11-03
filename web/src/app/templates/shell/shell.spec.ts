import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, Routes } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import {
  FakeAuth,
  FakeMarketStatusStore,
  FakePortfolioList,
  FakeSwUpdate,
  FakeVersionStore,
  me,
  provideAppTesting,
  provideFakeAuth,
  provideFakeMarketStatusStore,
  provideFakePortfolioList,
  provideFakeVersionStore,
  signedOutMe,
  stubMatchMedia,
} from '../../../testing';
import { Shell } from './shell';

@Component({ template: '<p class="page">A page</p>' })
class Page {}

describe('Shell', () => {
  let gate: { promise: Promise<boolean>; resolve: (allow: boolean) => void };

  const routes: Routes = [
    { path: 'fast', component: Page },
    { path: 'other', component: Page },
    { path: 'slow', component: Page, canActivate: [() => gate.promise] },
    { path: 'broken', component: Page, canActivate: [() => Promise.reject(new Error('guard failed'))] },
  ];

  function render(options: { signedIn?: boolean; wide?: boolean; settled?: boolean } = {}) {
    const { signedIn = true, wide = true, settled = true } = options;
    let resolve!: (allow: boolean) => void;
    const promise = new Promise<boolean>((r) => (resolve = r));
    gate = { promise, resolve };
    stubMatchMedia({ '(min-width: 960px)': wide });
    const auth = new FakeAuth(signedIn ? me() : signedOutMe());
    auth.settled.set(settled);
    TestBed.configureTestingModule({
      providers: [
        provideAppTesting({ routes }),
        provideFakeAuth(auth),
        provideFakePortfolioList(new FakePortfolioList()),
        provideFakeMarketStatusStore(new FakeMarketStatusStore()),
        provideFakeVersionStore(new FakeVersionStore()),
        { provide: SwUpdate, useValue: new FakeSwUpdate() },
      ],
    });
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const router = TestBed.inject(Router);
    return {
      fixture,
      el,
      auth,
      router,
      rail: () => el.querySelector('mat-sidenav'),
      opened: () => el.querySelector('mat-sidenav')?.classList.contains('mat-drawer-opened') ?? false,
      menuButton: () => el.querySelector<HTMLButtonElement>('button[aria-label="Open navigation"]'),
      bar: () => el.querySelector('mat-progress-bar'),
    };
  }

  describe('when signed in on a wide screen', () => {
    it('keeps the navigation rail open beside the page, with no top bar or menu button', async () => {
      const { el, rail, opened, menuButton } = render();

      expect(rail()).not.toBeNull();
      expect(rail()?.classList).toContain('mat-drawer-side');
      expect(opened()).toBe(true);
      expect(el.querySelector('nav[appNavRail]')).not.toBeNull();
      expect(el.querySelector('header.topbar')).toBeNull();
      expect(menuButton()).toBeNull();
      expect(el.querySelector('button.bare-theme')).toBeNull();
    });

    it('shows the routed page in the single outlet', async () => {
      const { el, router, fixture } = render();

      await router.navigateByUrl('/fast');
      fixture.detectChanges();

      expect(el.querySelectorAll('router-outlet')).toHaveLength(1);
      expect(el.querySelector('main .page')?.textContent).toBe('A page');
    });
  });

  describe('when signed in on a phone', () => {
    it('hides the rail behind a top bar with the product name and a menu button', () => {
      const { el, rail, opened, menuButton } = render({ wide: false });

      expect(rail()?.classList).toContain('mat-drawer-over');
      expect(opened()).toBe(false);
      expect(el.querySelector('header.topbar a.brand')?.textContent).toBe('Money Monkey');
      expect(menuButton()).not.toBeNull();
    });

    it('opens the drawer from the menu button', () => {
      const { fixture, menuButton, opened } = render({ wide: false });

      menuButton()!.click();
      fixture.detectChanges();

      expect(opened()).toBe(true);
    });

    it('closes the drawer when the person taps outside it', () => {
      const { fixture, el, menuButton, opened } = render({ wide: false });
      menuButton()!.click();
      fixture.detectChanges();

      el.querySelector<HTMLElement>('.mat-drawer-backdrop')!.click();
      fixture.detectChanges();

      expect(opened()).toBe(false);
    });

    it('closes the drawer after navigating to a page', async () => {
      const { fixture, router, menuButton, opened } = render({ wide: false });
      menuButton()!.click();
      fixture.detectChanges();
      expect(opened()).toBe(true);

      await router.navigateByUrl('/fast');
      await fixture.whenStable();

      expect(opened()).toBe(false);
    });
  });

  describe('when signed out', () => {
    it('has no rail or top bar, and offers a theme button that cycles system, light and dark', () => {
      const { fixture, el, rail, menuButton } = render({ signedIn: false });
      const button = () => el.querySelector<HTMLButtonElement>('button.bare-theme')!;
      const labels: (string | null)[] = [];
      const icons: (string | null | undefined)[] = [];

      for (let i = 0; i < 3; i++) {
        labels.push(button().getAttribute('aria-label'));
        icons.push(button().querySelector('mat-icon svg')?.getAttribute('data-icon'));
        button().click();
        fixture.detectChanges();
      }

      expect(rail()).toBeNull();
      expect(menuButton()).toBeNull();
      expect(el.querySelector('.content')?.classList).toContain('bare');
      expect(labels).toEqual(['Theme: system', 'Theme: light', 'Theme: dark']);
      expect(icons).toEqual(['contrast', 'light_mode', 'dark_mode']);
    });

    it('still has exactly one router outlet', () => {
      expect(render({ signedIn: false }).el.querySelectorAll('router-outlet')).toHaveLength(1);
    });
  });

  describe('while the first session check is running', () => {
    it('shows the boot spinner above the outlet until the session settles', () => {
      const { fixture, el, auth } = render({ signedIn: false, settled: false });

      expect(el.querySelector('app-busy')?.textContent).toContain('Loading Money Monkey…');
      expect(el.querySelectorAll('router-outlet')).toHaveLength(1);

      auth.settled.set(true);
      fixture.detectChanges();

      expect(el.querySelector('app-busy')).toBeNull();
    });

    it('does not show the progress bar for a navigation, even a slow one', async () => {
      vi.useFakeTimers();
      try {
        const { fixture, router, bar } = render({ signedIn: false, settled: false });

        const navigation = router.navigateByUrl('/slow');
        await vi.advanceTimersByTimeAsync(500);
        fixture.detectChanges();

        expect(bar()).toBeNull();
        gate.resolve(true);
        await navigation;
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('navigation progress bar', () => {
    it('stays hidden for a page that arrives at once', async () => {
      vi.useFakeTimers();
      try {
        const { fixture, router, bar } = render();

        await router.navigateByUrl('/fast');
        await vi.advanceTimersByTimeAsync(500);
        fixture.detectChanges();

        expect(bar()).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('appears after a 200 ms grace while a page is on its way, and goes when it arrives', async () => {
      vi.useFakeTimers();
      try {
        const { fixture, router, bar } = render();

        const navigation = router.navigateByUrl('/slow');
        await vi.advanceTimersByTimeAsync(199);
        fixture.detectChanges();
        expect(bar()).toBeNull();

        await vi.advanceTimersByTimeAsync(1);
        fixture.detectChanges();
        expect(bar()).not.toBeNull();
        expect(bar()?.getAttribute('aria-label')).toBe('Loading the page');

        gate.resolve(true);
        await navigation;
        fixture.detectChanges();
        expect(bar()).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('goes when the navigation is cancelled by a guard', async () => {
      vi.useFakeTimers();
      try {
        const { fixture, router, bar } = render();

        const navigation = router.navigateByUrl('/slow');
        await vi.advanceTimersByTimeAsync(250);
        fixture.detectChanges();
        expect(bar()).not.toBeNull();

        gate.resolve(false);
        await navigation;
        fixture.detectChanges();
        expect(bar()).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('goes when the navigation fails', async () => {
      vi.useFakeTimers();
      try {
        const { fixture, router, bar } = render();

        await router.navigateByUrl('/broken').catch(() => false);
        await vi.advanceTimersByTimeAsync(500);
        fixture.detectChanges();

        expect(bar()).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('goes when a navigation to the current address is skipped', async () => {
      vi.useFakeTimers();
      try {
        const { fixture, router, bar } = render();
        await router.navigateByUrl('/fast');

        await router.navigateByUrl('/fast');
        await vi.advanceTimersByTimeAsync(500);
        fixture.detectChanges();

        expect(bar()).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('restarts the grace period when a second navigation supersedes a pending one', async () => {
      vi.useFakeTimers();
      try {
        const { fixture, router, bar } = render();

        void router.navigateByUrl('/slow');
        await vi.advanceTimersByTimeAsync(150);
        const second = router.navigateByUrl('/other');
        await second;
        await vi.advanceTimersByTimeAsync(500);
        fixture.detectChanges();

        expect(bar()).toBeNull();
        gate.resolve(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
