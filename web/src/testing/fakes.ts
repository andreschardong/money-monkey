import { ResourceStatus, WritableSignal, computed, signal } from '@angular/core';
import { Auth } from '../app/core/auth';
import { MarketStatusStore, PortfolioList, VersionStore } from '../app/core/stores';
import { EmailLinkSent, Me, MarketStatus, Passkey, PortfolioSummary, Version } from '../app/core/models';
import { marketStatus, me as meFixture, signedOutMe } from './fixtures';

// Fakes for the app's root services, for component specs that should not drive HTTP through them.
// Each `provideFake*` returns a provider plus nothing else to remember; keep the fake to poke its signals.
// Types are deliberately loose (the real classes have private members), so a fake is provided with `useValue`.

/** The slice of `httpResource` the app reads: value, status, error, reload, set. All signals are writable in tests. */
export class FakeResource<T> {
  readonly value: WritableSignal<T>;
  readonly status = signal<ResourceStatus>('resolved');
  readonly error = signal<unknown>(undefined);
  readonly isLoading = computed(() => this.status() === 'loading' || this.status() === 'reloading');
  readonly hasValue = signal(true);
  readonly reload = vi.fn(() => true);
  readonly set = vi.fn((value: T) => this.value.set(value));
  readonly update = vi.fn((fn: (value: T) => T) => this.value.update(fn));

  constructor(initial: T) {
    this.value = signal(initial);
  }
}

/** A resource that has not answered yet (`hasValue()` false, status 'loading'). */
export function loadingResource<T>(placeholder: T): FakeResource<T> {
  const resource = new FakeResource<T>(placeholder);
  resource.status.set('loading');
  resource.hasValue.set(false);
  return resource;
}

/** A resource whose request failed. */
export function failedResource<T>(placeholder: T, error: unknown): FakeResource<T> {
  const resource = new FakeResource<T>(placeholder);
  resource.status.set('error');
  resource.hasValue.set(false);
  resource.error.set(error);
  return resource;
}

export class FakeAuth {
  readonly me: FakeResource<Me>;
  readonly signedIn = signal(true);
  readonly email = signal<string | null>('ada@example.com');
  readonly inboxUrl = signal<string | null>(null);
  readonly publicUrl = signal('https://money.example.com');
  readonly hideGains = signal(false);
  readonly showGains = computed(() => !this.hideGains());
  readonly settled = signal(true);
  passkeysSupported = true;

  readonly ready = vi.fn(() => Promise.resolve());
  readonly requestEmailLink = vi.fn((email: string) => Promise.resolve<EmailLinkSent>({ email, inboxUrl: null }));
  readonly verifyEmailLink = vi.fn((_token: string, _confirmSwitch = false) => Promise.resolve(meFixture()));
  readonly setHideGains = vi.fn((value: boolean) => {
    this.hideGains.set(value);
    return Promise.resolve();
  });
  readonly signOut = vi.fn(() => Promise.resolve());
  readonly signOutEverywhere = vi.fn(() => Promise.resolve());
  readonly signInWithPasskey = vi.fn(() => Promise.resolve(meFixture()));
  readonly addPasskey = vi.fn((_name: string | null) => Promise.resolve<Passkey[]>([]));
  readonly passkeys = vi.fn(() => Promise.resolve<Passkey[]>([]));
  readonly removePasskey = vi.fn((_id: string) => Promise.resolve<Passkey[]>([]));
  readonly sessionEnded = vi.fn();

  constructor(initial: Me = meFixture()) {
    this.me = new FakeResource<Me>(initial);
    this.apply(initial);
  }

  /** Makes the fake report this account (or nobody) everywhere the real Auth would. */
  apply(account: Me): void {
    this.me.value.set(account);
    this.signedIn.set(account.signedIn);
    this.email.set(account.email);
    this.inboxUrl.set(account.inboxUrl);
    this.publicUrl.set(account.publicUrl);
    this.hideGains.set(account.hideGains);
  }

  signOutLocally(): void {
    this.apply(signedOutMe());
  }
}

/** `{ provide: Auth, useValue: auth }`. */
export function provideFakeAuth(auth: FakeAuth = new FakeAuth()) {
  return { provide: Auth, useValue: auth };
}

export class FakePortfolioList {
  readonly resource = new FakeResource<PortfolioSummary[]>([]);
  readonly loaded = signal(true);
  readonly reload = vi.fn();
}

export function provideFakePortfolioList(list: FakePortfolioList = new FakePortfolioList()) {
  return { provide: PortfolioList, useValue: list };
}

export class FakeMarketStatusStore {
  readonly resource: FakeResource<MarketStatus>;
  readonly today = signal<string | null>('2026-10-30');
  readonly pricesVersion = signal(0);
  readonly reload = vi.fn();

  constructor(initial: MarketStatus = marketStatus()) {
    this.resource = new FakeResource<MarketStatus>(initial);
  }
}

export function provideFakeMarketStatusStore(store: FakeMarketStatusStore = new FakeMarketStatusStore()) {
  return { provide: MarketStatusStore, useValue: store };
}

export class FakeVersionStore {
  readonly resource: FakeResource<Version | null>;
  readonly value = signal<Version | null>(null);

  constructor(initial: Version | null = null) {
    this.resource = new FakeResource<Version | null>(initial);
    this.value.set(initial);
  }
}

export function provideFakeVersionStore(store: FakeVersionStore = new FakeVersionStore()) {
  return { provide: VersionStore, useValue: store };
}
