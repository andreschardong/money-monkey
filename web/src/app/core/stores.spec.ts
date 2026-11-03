import { TestBed } from '@angular/core/testing';
import { provideAppTesting } from '../../testing/app-testing';
import { FakeAuth, provideFakeAuth } from '../../testing/fakes';
import { marketStatus, portfolioSummary, refreshRun, version } from '../../testing/fixtures';
import {
  expectRequest,
  flush,
  httpController,
  flushProblem,
  settle,
  verifyNoOutstandingRequests,
} from '../../testing/http';
import { DisplayCurrency, MarketStatusStore, PortfolioList, RealEstateFilter, VersionStore } from './stores';

describe('PortfolioList', () => {
  let auth: FakeAuth;

  beforeEach(() => {
    auth = new FakeAuth();
    TestBed.configureTestingModule({ providers: [provideAppTesting(), provideFakeAuth(auth)] });
  });

  afterEach(() => verifyNoOutstandingRequests());

  it('asks for nothing while nobody is signed in', async () => {
    auth.signOutLocally();
    const list = TestBed.inject(PortfolioList);
    await settle();
    expect(list.resource.value()).toEqual([]);
    expect(list.loaded()).toBe(false);
  });

  it("loads the signed-in account's portfolios and reports when they have arrived", async () => {
    const list = TestBed.inject(PortfolioList);
    await settle();
    expect(list.loaded()).toBe(false);
    await flush('GET', '/api/portfolios?account=ada%40example.com', [portfolioSummary()]);
    expect(list.loaded()).toBe(true);
    expect(list.resource.value()).toHaveLength(1);
  });

  it('asks again for another account after a switch', async () => {
    const list = TestBed.inject(PortfolioList);
    await settle();
    await flush('GET', '/api/portfolios?account=ada%40example.com', []);
    auth.email.set('grace@example.com');
    await settle();
    await flush('GET', '/api/portfolios?account=grace%40example.com', [portfolioSummary({ name: 'Other' })]);
    expect(list.resource.value()[0].name).toBe('Other');
  });

  it('uses an empty account when the email is unknown', async () => {
    auth.email.set(null);
    TestBed.inject(PortfolioList);
    await settle();
    await flush('GET', '/api/portfolios?account=', []);
  });

  it('reloads on demand', async () => {
    const list = TestBed.inject(PortfolioList);
    await settle();
    await flush('GET', '/api/portfolios?account=ada%40example.com', []);
    list.reload();
    await settle();
    await flush('GET', '/api/portfolios?account=ada%40example.com', []);
  });

  it('counts a failed request as not loaded', async () => {
    const list = TestBed.inject(PortfolioList);
    await settle();
    flushProblem(expectRequest('GET', '/api/portfolios?account=ada%40example.com'), 500, 'Down');
    await settle();
    expect(list.loaded()).toBe(false);
  });
});

describe('MarketStatusStore', () => {
  let auth: FakeAuth;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    auth = new FakeAuth();
    TestBed.configureTestingModule({ providers: [provideAppTesting(), provideFakeAuth(auth)] });
  });

  afterEach(() => {
    // The store depends on PortfolioList, which fetches too; its answers are not what these tests are about.
    httpController()
      .match((r) => r.url.startsWith('/api/portfolios'))
      .filter((r) => !r.cancelled)
      .forEach((r) => r.flush([]));
    verifyNoOutstandingRequests();
    vi.useRealTimers();
  });

  const url = '/api/market/status?account=ada%40example.com';

  /** Creates the store and answers the first request of it and of the portfolio list it reloads. */
  async function create(status = marketStatus()) {
    const store = TestBed.inject(MarketStatusStore);
    await settle();
    await flush('GET', url, status);
    return store;
  }

  it('does not ask while signed out', async () => {
    auth.signOutLocally();
    const store = TestBed.inject(MarketStatusStore);
    await settle();
    expect(store.today()).toBeNull();
  });

  it("exposes the market's today once loaded", async () => {
    const store = await create(marketStatus({ today: '2026-10-29' }));
    expect(store.today()).toBe('2026-10-29');
  });

  it('uses an empty account when the email is unknown', async () => {
    auth.email.set(null);
    TestBed.inject(MarketStatusStore);
    await settle();
    await flush('GET', '/api/market/status?account=', marketStatus());
  });

  it('reloads on demand', async () => {
    const store = await create();
    store.reload();
    await settle();
    await flush('GET', url, marketStatus());
  });

  it('looks for a newer refresh every five minutes while the page is visible', async () => {
    await create();
    vi.advanceTimersByTime(5 * 60 * 1000);
    await settle();
    await flush('GET', url, marketStatus());
  });

  it('does not poll while the page is hidden or the person is signed out', async () => {
    await create();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    vi.advanceTimersByTime(5 * 60 * 1000);
    await settle();
    visibility.mockReturnValue('visible');
    auth.signOutLocally();
    vi.advanceTimersByTime(5 * 60 * 1000);
    await settle();
    expect(httpController().match((r) => r.url.startsWith('/api/market'))).toEqual([]);
  });

  it('bumps the prices version and reloads the portfolio list when a newer refresh has finished', async () => {
    const list = TestBed.inject(PortfolioList);
    const reload = vi.spyOn(list, 'reload');
    const store = await create(marketStatus({ lastRun: refreshRun({ finishedAt: '2026-10-30T21:00:00Z' }) }));
    expect(store.pricesVersion()).toBe(0);

    store.reload();
    await settle();
    await flush('GET', url, marketStatus({ lastRun: refreshRun({ finishedAt: '2026-10-30T21:15:00Z' }) }));
    expect(store.pricesVersion()).toBe(1);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('does not bump when the same run is seen again, or when no run has finished yet', async () => {
    const store = await create(marketStatus({ lastRun: null }));
    store.reload();
    await settle();
    await flush('GET', url, marketStatus({ lastRun: refreshRun({ finishedAt: null }) }));
    store.reload();
    await settle();
    await flush('GET', url, marketStatus({ lastRun: refreshRun({ finishedAt: '2026-10-30T21:00:00Z' }) }));
    store.reload();
    await settle();
    await flush('GET', url, marketStatus({ lastRun: refreshRun({ finishedAt: '2026-10-30T21:00:00Z' }) }));
    expect(store.pricesVersion()).toBe(0);
  });
});

describe('VersionStore', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideAppTesting()] });
  });

  afterEach(() => verifyNoOutstandingRequests());

  it('is empty until the version arrives, then holds it', async () => {
    const store = TestBed.inject(VersionStore);
    await settle();
    expect(store.value()).toBeNull();
    await flush('GET', '/api/version', version({ version: '2.0.0' }));
    expect(store.value()?.version).toBe('2.0.0');
  });
});

describe('DisplayCurrency', () => {
  it('defaults to Canadian dollars', () => {
    expect(TestBed.inject(DisplayCurrency).value()).toBe('CAD');
  });

  it('restores a saved choice', () => {
    localStorage.setItem('folio.displayCurrency', 'EUR');
    expect(TestBed.inject(DisplayCurrency).value()).toBe('EUR');
  });

  it('ignores a saved value that is not an offered currency', () => {
    localStorage.setItem('folio.displayCurrency', 'XXX');
    expect(TestBed.inject(DisplayCurrency).value()).toBe('CAD');
  });

  it('falls back to Canadian dollars when storage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(TestBed.inject(DisplayCurrency).value()).toBe('CAD');
  });

  it('remembers a new choice in this browser', () => {
    const store = TestBed.inject(DisplayCurrency);
    store.set('USD');
    expect(store.value()).toBe('USD');
    expect(localStorage.getItem('folio.displayCurrency')).toBe('USD');
  });

  it('still switches for this visit when storage refuses the write', () => {
    const store = TestBed.inject(DisplayCurrency);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    store.set('USD');
    expect(store.value()).toBe('USD');
  });
});

describe('RealEstateFilter', () => {
  it('includes real estate by default', () => {
    expect(TestBed.inject(RealEstateFilter).include()).toBe(true);
  });

  it('restores a saved "no"', () => {
    localStorage.setItem('folio.includeRealEstate', 'no');
    expect(TestBed.inject(RealEstateFilter).include()).toBe(false);
  });

  it('includes real estate when storage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(TestBed.inject(RealEstateFilter).include()).toBe(true);
  });

  it.each([
    [false, 'no'],
    [true, 'yes'],
  ])('remembers include=%s as "%s"', (include, stored) => {
    const filter = TestBed.inject(RealEstateFilter);
    filter.set(include);
    expect(filter.include()).toBe(include);
    expect(localStorage.getItem('folio.includeRealEstate')).toBe(stored);
  });

  it('still switches for this visit when storage refuses the write', () => {
    const filter = TestBed.inject(RealEstateFilter);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    filter.set(false);
    expect(filter.include()).toBe(false);
  });
});
