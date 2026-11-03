import { Subject } from 'rxjs';

/** jsdom's `matchMedia` always says no. Make named queries say yes: `stubMatchMedia({ '(prefers-reduced-motion: reduce)': true })`. */
export function stubMatchMedia(matches: Record<string, boolean>): MediaQueryListStub {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const stub = ((query: string) => ({
    matches: matches[query] ?? false,
    media: query,
    addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => listeners.delete(listener),
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof matchMedia;
  vi.stubGlobal('matchMedia', stub);
  return { change: (value: boolean) => listeners.forEach((listener) => listener({ matches: value })) };
}

export interface MediaQueryListStub {
  /** Fires a `change` event to every listener added through `addEventListener`. */
  change(matches: boolean): void;
}

/** A `SwUpdate` that can be told to be enabled and to announce versions. */
export class FakeSwUpdate {
  isEnabled = true;
  readonly versionUpdates = new Subject<{ type: string }>();
  readonly checkForUpdate = vi.fn(() => Promise.resolve(false));
}

export type CredentialMock = ReturnType<typeof vi.fn<(options?: unknown) => Promise<unknown>>>;

export interface PasskeyEnvironment {
  /** `navigator.credentials.get`; resolve it with `fakeCredential()` or null. */
  get: CredentialMock;
  /** `navigator.credentials.create`. */
  create: CredentialMock;
  /** Puts the browser back as it was. Specs that call `installPasskeys` should call this in `afterEach`. */
  restore(): void;
}

/**
 * Gives jsdom what a passkey-capable browser has: `PublicKeyCredential` with the JSON parsers, a secure context,
 * and `navigator.credentials`. Call BEFORE the first `inject(Auth)`, because `Auth.passkeysSupported` is read once.
 * `parse*FromJSON` return their input wrapped as `{ parsed: input }` so a spec can see what reached the browser.
 */
export function installPasskeys(): PasskeyEnvironment {
  const get: CredentialMock = vi.fn();
  const create: CredentialMock = vi.fn();
  const previous = Object.getOwnPropertyDescriptor(navigator, 'credentials');
  const previousSecure = Object.getOwnPropertyDescriptor(window, 'isSecureContext');
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: { get, create } });
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  vi.stubGlobal('PublicKeyCredential', {
    parseRequestOptionsFromJSON: (json: unknown) => ({ parsed: json }),
    parseCreationOptionsFromJSON: (json: unknown) => ({ parsed: json }),
  });
  return {
    get,
    create,
    restore: () => {
      restoreProperty(navigator, 'credentials', previous);
      restoreProperty(window, 'isSecureContext', previousSecure);
      vi.unstubAllGlobals();
    },
  };
}

function restoreProperty(target: object, name: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(target, name, descriptor);
  } else {
    delete (target as Record<string, unknown>)[name];
  }
}

export interface FakeCredentialOptions {
  /** Provide `toJSON` (what browsers do); `false` simulates a password manager that breaks it. */
  toJSON?: (() => unknown) | false;
  /** 'attestation' for registration, 'assertion' for sign-in. */
  kind?: 'attestation' | 'assertion';
  withUserHandle?: boolean;
  authenticatorAttachment?: string | null;
  transports?: string[] | null;
}

/** A `PublicKeyCredential` look-alike with deterministic bytes. */
export function fakeCredential(options: FakeCredentialOptions = {}): PublicKeyCredential {
  const { kind = 'assertion', withUserHandle = true } = options;
  const bytes = (...values: number[]) => new Uint8Array(values).buffer;
  const response: Record<string, unknown> = { clientDataJSON: bytes(1, 2, 3) };
  if (kind === 'attestation') {
    response['attestationObject'] = bytes(251, 252, 253);
    if (options.transports !== null) {
      response['getTransports'] = () => options.transports ?? ['internal'];
    }
  } else {
    response['authenticatorData'] = bytes(4, 5, 6);
    response['signature'] = bytes(255, 254);
    if (withUserHandle) {
      response['userHandle'] = bytes(7, 8);
    }
  }
  const credential: Record<string, unknown> = {
    id: 'cred-id',
    rawId: bytes(250, 251, 252, 253),
    type: 'public-key',
    response,
    getClientExtensionResults: () => ({}),
    authenticatorAttachment: options.authenticatorAttachment,
  };
  if (options.toJSON !== false) {
    credential['toJSON'] = options.toJSON ?? (() => ({ id: 'cred-id', viaToJSON: true }));
  }
  return credential as unknown as PublicKeyCredential;
}
