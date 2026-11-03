import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { Auth } from '../../core/auth';
import { registerIcons } from '../../core/icons';
import { MarketStatus, PortfolioSummary, Version } from '../../core/models';
import { Pwa } from '../../core/pwa';
import { MarketStatusStore, PortfolioList, VersionStore } from '../../core/stores';
import { Theme, ThemePreference } from '../../core/theme';
import { NavRail } from './nav-rail';

const portfolio = (id: string, over: Partial<PortfolioSummary> = {}) =>
  ({
    id,
    name: `Portfolio ${id}`,
    baseCurrency: 'CAD',
    totalValue: 1234.5,
    access: 'Owner',
    ownerEmail: null,
    ...over,
  }) as PortfolioSummary;

const marketStatus = (over: Partial<MarketStatus> = {}) =>
  ({ lastRun: null, pricesAsOf: '2026-11-02', today: '2026-11-03', securitiesTracked: 3, ...over }) as MarketStatus;

describe('NavRail', () => {
  const portfolios = signal<PortfolioSummary[]>([]);
  const hasPortfolios = signal(true);
  const loaded = signal(true);
  const status = signal<MarketStatus | null>(null);
  const preference = signal<ThemePreference>('system');
  const canInstall = signal(false);
  const version = signal<Version | null>(null);
  const reload = vi.fn();
  const cycle = vi.fn();
  const install = vi.fn();
  let created: PortfolioSummary | undefined;
  const open = vi.fn(() => ({ afterClosed: () => of(created) }));

  async function render() {
    TestBed.configureTestingModule({
      imports: [NavRail],
      providers: [
        provideRouter([]),
        { provide: MatDialog, useValue: { open } },
        { provide: Auth, useValue: { email: signal('me@example.com') } },
        { provide: Pwa, useValue: { canInstall, install } },
        { provide: Theme, useValue: { preference, cycle } },
        { provide: VersionStore, useValue: { value: version } },
        {
          provide: PortfolioList,
          useValue: { resource: { hasValue: () => hasPortfolios(), value: () => portfolios() }, loaded, reload },
        },
        {
          provide: MarketStatusStore,
          useValue: { resource: { hasValue: () => status() !== null, value: () => status() } },
        },
      ],
    });
    TestBed.runInInjectionContext(registerIcons);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(NavRail);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    return { fixture, element, navigate };
  }

  beforeEach(() => {
    portfolios.set([]);
    hasPortfolios.set(true);
    loaded.set(true);
    status.set(null);
    preference.set('system');
    canInstall.set(false);
    version.set(null);
    created = undefined;
    vi.clearAllMocks();
  });

  it('is the main navigation with the wordmark, the pages and the account email', async () => {
    const { element } = await render();

    expect(element.getAttribute('aria-label')).toBe('Main');
    expect(element.querySelector('a.brand')?.textContent).toBe('Money Monkey');
    const links = Array.from(element.querySelectorAll('a.nav-item'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/', '/assets', '/quotes', '/market', '/account']);
    expect(links.map((a) => a.querySelector('span')?.textContent)).toEqual([
      'Overview',
      'All assets',
      'Quotes',
      'Prices and rates',
      'me@example.com',
    ]);
  });

  it('lists each portfolio with its value and marks shared ones', async () => {
    portfolios.set([portfolio('a'), portfolio('b', { access: 'View', ownerEmail: 'owner@example.com' })]);
    const { element } = await render();

    const links = Array.from(element.querySelectorAll('a.portfolio'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/portfolios/a', '/portfolios/b']);
    expect(links[0].querySelector('.value')?.textContent).toBe('$1,234.50');
    expect(links[0].querySelector('mat-icon.shared')).toBeNull();
    expect(links[1].querySelector('mat-icon.shared')).not.toBeNull();
  });

  it('treats a list that has not arrived as empty', async () => {
    hasPortfolios.set(false);
    portfolios.set([portfolio('a')]);
    const { element } = await render();

    expect(element.querySelectorAll('a.portfolio').length).toBe(0);
  });

  it('offers to create the first portfolio once the list has loaded empty', async () => {
    const { element } = await render();

    const first = element.querySelector('button.first') as HTMLButtonElement;
    expect(first.textContent).toBe('Create your first portfolio');
    first.click();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('does not offer a first portfolio while the list is still loading', async () => {
    loaded.set(false);
    const { element } = await render();

    expect(element.querySelector('button.first')).toBeNull();
  });

  it('reloads the list and opens a portfolio that was created', async () => {
    created = portfolio('new');
    const { element, navigate } = await render();

    (element.querySelector('button.add') as HTMLButtonElement).click();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/portfolios', 'new']);
  });

  it('does nothing when the new-portfolio dialog is dismissed', async () => {
    const { element, navigate } = await render();

    (element.querySelector('button.add') as HTMLButtonElement).click();

    expect(reload).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  describe('price freshness', () => {
    const badge = (element: HTMLElement) => element.querySelector('.freshness') as HTMLElement | null;

    it('shows nothing before the status arrives or when no securities are tracked', async () => {
      const first = await render();
      expect(badge(first.element)).toBeNull();

      status.set(marketStatus({ securitiesTracked: 0 }));
      await first.fixture.whenStable();
      expect(badge(first.element)).toBeNull();
    });

    it('shows the date of the newest close while quotes are fresh', async () => {
      status.set(marketStatus());
      const { element } = await render();

      expect(badge(element)?.classList).not.toContain('stale');
      expect(badge(element)?.textContent?.trim()).not.toBe('Check');
      expect(badge(element)?.textContent?.trim()).not.toBe('');
    });

    it('asks for a check when the last refresh failed', async () => {
      status.set(marketStatus({ lastRun: { status: 'Failed' } as MarketStatus['lastRun'] }));
      const { element } = await render();

      expect(badge(element)?.textContent?.trim()).toBe('Check');
      expect(badge(element)?.classList).toContain('stale');
    });

    it('asks for a check when there is no close at all', async () => {
      status.set(marketStatus({ pricesAsOf: null }));
      const { element } = await render();

      expect(badge(element)?.textContent?.trim()).toBe('Check');
    });

    it('asks for a check when the newest close is more than four days old', async () => {
      status.set(marketStatus({ pricesAsOf: '2026-10-28' }));
      const { element } = await render();

      expect(badge(element)?.textContent?.trim()).toBe('Check');
    });
  });

  it('labels the theme button for each preference and cycles on click', async () => {
    const { fixture, element } = await render();
    const button = () => element.querySelector('button.theme') as HTMLButtonElement;

    expect(button().getAttribute('aria-label')).toBe('Theme: system');
    expect(button().querySelector('mat-icon')?.getAttribute('data-mat-icon-name')).toBe('contrast');

    preference.set('light');
    await fixture.whenStable();
    expect(button().getAttribute('aria-label')).toBe('Theme: light');
    expect(button().querySelector('mat-icon')?.getAttribute('data-mat-icon-name')).toBe('light_mode');

    preference.set('dark');
    await fixture.whenStable();
    expect(button().getAttribute('aria-label')).toBe('Theme: dark');
    expect(button().querySelector('mat-icon')?.getAttribute('data-mat-icon-name')).toBe('dark_mode');

    button().click();
    expect(cycle).toHaveBeenCalledTimes(1);
  });

  it('offers to install the app only when the browser allows it', async () => {
    const { fixture, element } = await render();
    const installButton = () =>
      Array.from(element.querySelectorAll('button.nav-item')).find((b) => b.textContent?.includes('Install app')) as
        HTMLButtonElement | undefined;
    expect(installButton()).toBeUndefined();

    canInstall.set(true);
    await fixture.whenStable();
    installButton()?.click();

    expect(install).toHaveBeenCalledTimes(1);
  });

  it('shows the version, with the commit as its tooltip when known', async () => {
    const { fixture, element } = await render();
    expect(element.querySelector('a.version')).toBeNull();

    version.set({ version: '1.4.0', commit: null, builtAt: null });
    await fixture.whenStable();
    expect(element.querySelector('a.version')?.textContent).toBe('v1.4.0');
    expect(element.querySelector('a.version')?.hasAttribute('title')).toBe(false);

    version.set({ version: '1.4.0', commit: '0d02bd0', builtAt: null });
    await fixture.whenStable();
    expect(element.querySelector('a.version')?.getAttribute('title')).toBe('Built from commit 0d02bd0');
  });
});
