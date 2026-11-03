import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { throwError } from 'rxjs';
import { provideAppTesting } from '../../testing/app-testing';
import { fakeCredential, installPasskeys, PasskeyEnvironment } from '../../testing/browser-fakes';
import { FakeAuth, provideFakeAuth } from '../../testing/fakes';
import { me, passkey, signedOutMe } from '../../testing/fixtures';
import {
  bodyOf,
  expectRequest,
  flush,
  flushNetworkError,
  flushProblem,
  settle,
  verifyNoOutstandingRequests,
} from '../../testing/http';
import { Auth, authGuard, authInterceptor, passkeyErrorMessage, safeReturnUrl, signedOutGuard } from './auth';

async function createAuth(initial: ReturnType<typeof me> | null = me()): Promise<Auth> {
  const auth = TestBed.inject(Auth);
  await settle();
  if (initial) {
    await flush('GET', '/api/auth/me', initial);
  }
  return auth;
}

describe('Auth', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideAppTesting()] });
  });

  afterEach(() => verifyNoOutstandingRequests());

  describe('who is signed in', () => {
    it('starts signed out and unsettled until the first answer arrives', async () => {
      const auth = await createAuth(null);
      expect(auth.signedIn()).toBe(false);
      expect(auth.email()).toBeNull();
      expect(auth.publicUrl()).toBe('');
      expect(auth.settled()).toBe(false);
      expectRequest('GET', '/api/auth/me').flush(me());
    });

    it('exposes the account once the server answers', async () => {
      const auth = await createAuth(me({ inboxUrl: 'http://mail.test', hideGains: true }));
      expect(auth.settled()).toBe(true);
      expect(auth.signedIn()).toBe(true);
      expect(auth.email()).toBe('ada@example.com');
      expect(auth.inboxUrl()).toBe('http://mail.test');
      expect(auth.publicUrl()).toBe('https://money.example.com');
      expect(auth.hideGains()).toBe(true);
      expect(auth.showGains()).toBe(false);
    });

    it('treats an anonymous answer as signed out but settled', async () => {
      const auth = await createAuth(signedOutMe());
      expect(auth.settled()).toBe(true);
      expect(auth.signedIn()).toBe(false);
      expect(auth.showGains()).toBe(true);
    });

    it('settles when the who-am-I request fails, so the shell stops its spinner', async () => {
      const auth = TestBed.inject(Auth);
      await settle();
      flushProblem(expectRequest('GET', '/api/auth/me'), 500, 'Down');
      await settle();
      expect(auth.settled()).toBe(true);
      expect(auth.signedIn()).toBe(false);
      expect(auth.email()).toBeNull();
      expect(auth.inboxUrl()).toBeNull();
      expect(auth.publicUrl()).toBe('');
      expect(auth.hideGains()).toBe(false);
    });

    it('resolves ready() once the first answer has arrived', async () => {
      const auth = TestBed.inject(Auth);
      await settle();
      let ready = false;
      const waiting = auth.ready().then(() => (ready = true));
      await settle();
      expect(ready).toBe(false);
      expectRequest('GET', '/api/auth/me').flush(me());
      await waiting;
      expect(ready).toBe(true);
    });

    it('forgets the session when the server says it ended, but only if someone was signed in', async () => {
      const auth = await createAuth(me());
      auth.sessionEnded();
      expect(auth.signedIn()).toBe(false);
      auth.sessionEnded();
      expect(auth.signedIn()).toBe(false);
    });
  });

  describe('email links', () => {
    it('requests a link for an address', async () => {
      const auth = await createAuth(signedOutMe());
      const result = auth.requestEmailLink('ada@example.com');
      const request = expectRequest('POST', '/api/auth/email-link');
      expect(bodyOf(request)).toEqual({ email: 'ada@example.com' });
      request.flush({ email: 'ada@example.com', inboxUrl: null });
      await expect(result).resolves.toEqual({ email: 'ada@example.com', inboxUrl: null });
    });

    it('verifies a token and signs the person in, without confirming a switch by default', async () => {
      const auth = await createAuth(signedOutMe());
      const result = auth.verifyEmailLink('tok');
      const request = expectRequest('POST', '/api/auth/email-link/verify');
      expect(bodyOf(request)).toEqual({ token: 'tok', confirmSwitch: false });
      request.flush(me());
      expect((await result).email).toBe('ada@example.com');
      expect(auth.signedIn()).toBe(true);
    });

    it('can confirm a switch to another account', async () => {
      const auth = await createAuth(me());
      const result = auth.verifyEmailLink('tok', true);
      const request = expectRequest('POST', '/api/auth/email-link/verify');
      expect(bodyOf(request)).toEqual({ token: 'tok', confirmSwitch: true });
      request.flush(me({ email: 'grace@example.com' }));
      await result;
      expect(auth.email()).toBe('grace@example.com');
    });

    it('rejects and keeps the session when the link is refused', async () => {
      const auth = await createAuth(signedOutMe());
      const result = auth.verifyEmailLink('bad');
      flushProblem(expectRequest('POST', '/api/auth/email-link/verify'), 409, 'Link expired.');
      await expect(result).rejects.toMatchObject({ status: 409 });
      expect(auth.signedIn()).toBe(false);
    });
  });

  describe('account actions', () => {
    it('saves the hide-gains choice on the account and adopts the answer', async () => {
      const auth = await createAuth(me());
      const result = auth.setHideGains(true);
      const request = expectRequest('PUT', '/api/account/preferences');
      expect(bodyOf(request)).toEqual({ hideGains: true });
      request.flush(me({ hideGains: true }));
      await result;
      expect(auth.hideGains()).toBe(true);
    });

    it.each([
      ['signOut', '/api/auth/sign-out'],
      ['signOutEverywhere', '/api/account/sign-out-everywhere'],
    ] as const)('%s ends the session and goes to the sign-in page', async (method, url) => {
      const auth = await createAuth(me());
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const result = auth[method]();
      expectRequest('POST', url).flush(null);
      await result;
      expect(auth.signedIn()).toBe(false);
      expect(navigate).toHaveBeenCalledWith(['/sign-in']);
    });

    it('stays signed in when sign-out fails', async () => {
      const auth = await createAuth(me());
      const result = auth.signOut();
      flushNetworkError(expectRequest('POST', '/api/auth/sign-out'));
      await expect(result).rejects.toMatchObject({ status: 0 });
      expect(auth.signedIn()).toBe(true);
    });

    it('lists passkeys', async () => {
      const auth = await createAuth(me());
      const result = auth.passkeys();
      expectRequest('GET', '/api/account/passkeys').flush([passkey()]);
      await expect(result).resolves.toEqual([passkey()]);
    });

    it('removes a passkey by id, encoded, and reloads the account', async () => {
      const auth = await createAuth(me({ passkeys: 1 }));
      const result = auth.removePasskey('a/b');
      expectRequest('DELETE', '/api/account/passkeys/a%2Fb').flush([]);
      await expect(result).resolves.toEqual([]);
      await settle();
      expectRequest('GET', '/api/auth/me').flush(me({ passkeys: 0 }));
    });
  });

  describe('passkeys', () => {
    let browser: PasskeyEnvironment | undefined;

    afterEach(() => browser?.restore());

    it('are unsupported where the browser has no WebAuthn JSON helpers', async () => {
      expect((await createAuth(me())).passkeysSupported).toBe(false);
    });

    it('are supported in a secure context with the helpers', async () => {
      browser = installPasskeys();
      expect((await createAuth(me())).passkeysSupported).toBe(true);
    });

    it('are unsupported outside a secure context', async () => {
      browser = installPasskeys();
      Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
      expect((await createAuth(me())).passkeysSupported).toBe(false);
    });

    it('are unsupported when the helpers are missing', async () => {
      browser = installPasskeys();
      vi.stubGlobal('PublicKeyCredential', {});
      expect((await createAuth(me())).passkeysSupported).toBe(false);
    });

    describe('signing in', () => {
      it('asks for options, shows the browser prompt and posts the credential as the browser serialises it', async () => {
        browser = installPasskeys();
        const auth = await createAuth(signedOutMe());
        browser.get.mockResolvedValue(fakeCredential());
        const result = auth.signInWithPasskey();
        expectRequest('POST', '/api/auth/passkey/options').flush({ challenge: 'abc' });
        await vi.waitFor(() => expect(browser!.get).toHaveBeenCalled());
        expect(browser.get).toHaveBeenCalledWith({ publicKey: { parsed: { challenge: 'abc' } } });
        const post = expectRequest('POST', '/api/auth/passkey');
        expect(bodyOf(post)).toEqual({ credential: JSON.stringify({ id: 'cred-id', viaToJSON: true }) });
        post.flush(me());
        expect((await result).signedIn).toBe(true);
        expect(auth.signedIn()).toBe(true);
      });

      it('encodes the credential by hand when toJSON is missing', async () => {
        browser = installPasskeys();
        const auth = await createAuth(signedOutMe());
        browser.get.mockResolvedValue(fakeCredential({ toJSON: false, authenticatorAttachment: 'platform' }));
        const result = auth.signInWithPasskey();
        expectRequest('POST', '/api/auth/passkey/options').flush({});
        await vi.waitFor(() => expect(browser!.get).toHaveBeenCalled());
        const post = expectRequest('POST', '/api/auth/passkey');
        expect(JSON.parse(bodyOf<{ credential: string }>(post).credential)).toEqual({
          id: 'cred-id',
          rawId: '-vv8_Q',
          type: 'public-key',
          authenticatorAttachment: 'platform',
          clientExtensionResults: {},
          response: { clientDataJSON: 'AQID', authenticatorData: 'BAUG', signature: '__4', userHandle: 'Bwg' },
        });
        post.flush(me());
        await result;
      });

      it('leaves out the user handle when the authenticator sent none, and defaults the attachment to null', async () => {
        browser = installPasskeys();
        const auth = await createAuth(signedOutMe());
        browser.get.mockResolvedValue(fakeCredential({ toJSON: false, withUserHandle: false }));
        const result = auth.signInWithPasskey();
        expectRequest('POST', '/api/auth/passkey/options').flush({});
        await vi.waitFor(() => expect(browser!.get).toHaveBeenCalled());
        const post = expectRequest('POST', '/api/auth/passkey');
        const credential = JSON.parse(bodyOf<{ credential: string }>(post).credential);
        expect(credential.authenticatorAttachment).toBeNull();
        expect(credential.response).not.toHaveProperty('userHandle');
        post.flush(me());
        await result;
      });

      it('encodes by hand when toJSON throws', async () => {
        browser = installPasskeys();
        const auth = await createAuth(signedOutMe());
        browser.get.mockResolvedValue(
          fakeCredential({
            toJSON: () => {
              throw new Error('broken');
            },
          }),
        );
        const result = auth.signInWithPasskey();
        expectRequest('POST', '/api/auth/passkey/options').flush({});
        await vi.waitFor(() => expect(browser!.get).toHaveBeenCalled());
        const post = expectRequest('POST', '/api/auth/passkey');
        expect(JSON.parse(bodyOf<{ credential: string }>(post).credential).rawId).toBe('-vv8_Q');
        post.flush(me());
        await result;
      });

      it('fails clearly when the person dismisses the browser prompt with no credential', async () => {
        browser = installPasskeys();
        const auth = await createAuth(signedOutMe());
        browser.get.mockResolvedValue(null);
        const result = auth.signInWithPasskey();
        expectRequest('POST', '/api/auth/passkey/options').flush({});
        await expect(result).rejects.toThrow('No passkey was used.');
        expect(auth.signedIn()).toBe(false);
      });

      it('passes the browser error through when the prompt is cancelled', async () => {
        browser = installPasskeys();
        const auth = await createAuth(signedOutMe());
        browser.get.mockRejectedValue(new DOMException('cancelled', 'NotAllowedError'));
        const result = auth.signInWithPasskey();
        expectRequest('POST', '/api/auth/passkey/options').flush({});
        await expect(result).rejects.toMatchObject({ name: 'NotAllowedError' });
      });

      it('rejects when the server refuses the credential', async () => {
        browser = installPasskeys();
        const auth = await createAuth(signedOutMe());
        browser.get.mockResolvedValue(fakeCredential());
        const result = auth.signInWithPasskey();
        expectRequest('POST', '/api/auth/passkey/options').flush({});
        await vi.waitFor(() => expect(browser!.get).toHaveBeenCalled());
        flushProblem(expectRequest('POST', '/api/auth/passkey'), 401, 'Unknown passkey.');
        await expect(result).rejects.toMatchObject({ status: 401 });
        expect(auth.signedIn()).toBe(false);
      });
    });

    describe('adding', () => {
      it('creates a credential with a name, posts it and reloads the account', async () => {
        browser = installPasskeys();
        const auth = await createAuth(me());
        browser.create.mockResolvedValue(fakeCredential({ kind: 'attestation' }));
        const result = auth.addPasskey('Laptop');
        expectRequest('POST', '/api/account/passkeys/options').flush({ rp: 'x' });
        await vi.waitFor(() => expect(browser!.create).toHaveBeenCalled());
        expect(browser.create).toHaveBeenCalledWith({ publicKey: { parsed: { rp: 'x' } } });
        const post = expectRequest('POST', '/api/account/passkeys');
        expect(bodyOf(post)).toMatchObject({ name: 'Laptop' });
        post.flush([passkey()]);
        await expect(result).resolves.toEqual([passkey()]);
        await settle();
        expectRequest('GET', '/api/auth/me').flush(me({ passkeys: 1 }));
      });

      it('encodes an attestation by hand with the transports the browser reports', async () => {
        browser = installPasskeys();
        const auth = await createAuth(me());
        browser.create.mockResolvedValue(fakeCredential({ kind: 'attestation', toJSON: false, transports: ['usb'] }));
        const result = auth.addPasskey(null);
        expectRequest('POST', '/api/account/passkeys/options').flush({});
        await vi.waitFor(() => expect(browser!.create).toHaveBeenCalled());
        const post = expectRequest('POST', '/api/account/passkeys');
        const sent = bodyOf<{ credential: string; name: string | null }>(post);
        expect(sent.name).toBeNull();
        expect(JSON.parse(sent.credential).response).toEqual({
          clientDataJSON: 'AQID',
          attestationObject: '-_z9',
          transports: ['usb'],
        });
        post.flush([]);
        await result;
        await settle();
        expectRequest('GET', '/api/auth/me').flush(me());
      });

      it('sends no transports when the browser cannot report them', async () => {
        browser = installPasskeys();
        const auth = await createAuth(me());
        browser.create.mockResolvedValue(fakeCredential({ kind: 'attestation', toJSON: false, transports: null }));
        const result = auth.addPasskey('Key');
        expectRequest('POST', '/api/account/passkeys/options').flush({});
        await vi.waitFor(() => expect(browser!.create).toHaveBeenCalled());
        const post = expectRequest('POST', '/api/account/passkeys');
        expect(JSON.parse(bodyOf<{ credential: string }>(post).credential).response.transports).toEqual([]);
        post.flush([]);
        await result;
        await settle();
        expectRequest('GET', '/api/auth/me').flush(me());
      });

      it('fails clearly when the browser returns no credential', async () => {
        browser = installPasskeys();
        const auth = await createAuth(me());
        browser.create.mockResolvedValue(null);
        const result = auth.addPasskey('Laptop');
        expectRequest('POST', '/api/account/passkeys/options').flush({});
        await expect(result).rejects.toThrow('The passkey was not created.');
      });
    });
  });
});

describe('route guards', () => {
  const route = {} as ActivatedRouteSnapshot;
  const at = (url: string) => ({ url }) as RouterStateSnapshot;
  let auth: FakeAuth;
  let router: Router;

  beforeEach(() => {
    auth = new FakeAuth();
    TestBed.configureTestingModule({ providers: [provideAppTesting(), provideFakeAuth(auth)] });
    router = TestBed.inject(Router);
  });

  const run = (guard: typeof authGuard, state: RouterStateSnapshot) =>
    TestBed.runInInjectionContext(() => guard(route, state)) as Promise<boolean | UrlTree>;

  describe('authGuard', () => {
    it('lets a signed-in person through after the session check', async () => {
      await expect(run(authGuard, at('/assets'))).resolves.toBe(true);
      expect(auth.ready).toHaveBeenCalled();
    });

    it('waits for the session check before deciding', async () => {
      let release!: () => void;
      auth.ready.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));
      auth.signedIn.set(false);
      let decided = false;
      const decision = run(authGuard, at('/assets')).then((result) => ((decided = true), result));
      await Promise.resolve();
      expect(decided).toBe(false);
      release();
      expect(router.serializeUrl((await decision) as UrlTree)).toBe('/sign-in?returnUrl=%2Fassets');
    });

    it('sends a stranger to sign-in with the page they wanted as the return address', async () => {
      auth.signedIn.set(false);
      const result = (await run(authGuard, at('/portfolios/p1?tab=income'))) as UrlTree;
      expect(router.serializeUrl(result)).toBe('/sign-in?returnUrl=%2Fportfolios%2Fp1%3Ftab%3Dincome');
    });

    it.each(['/', ''])('sends a stranger to a plain sign-in page when the target is "%s"', async (url) => {
      auth.signedIn.set(false);
      const result = (await run(authGuard, at(url))) as UrlTree;
      expect(router.serializeUrl(result)).toBe('/sign-in');
    });
  });

  describe('signedOutGuard', () => {
    it('shows the sign-in page to a stranger', async () => {
      auth.signedIn.set(false);
      await expect(run(signedOutGuard, at('/sign-in'))).resolves.toBe(true);
    });

    it('sends someone who is already in to the overview', async () => {
      const result = (await run(signedOutGuard, at('/sign-in'))) as UrlTree;
      expect(router.serializeUrl(result)).toBe('/');
    });
  });
});

describe('authInterceptor', () => {
  let auth: FakeAuth;
  let router: Router;
  let navigate: ReturnType<typeof vi.spyOn>;
  let http: HttpClient;

  beforeEach(() => {
    auth = new FakeAuth();
    TestBed.configureTestingModule({
      providers: [provideAppTesting({ interceptors: [authInterceptor] }), provideFakeAuth(auth)],
    });
    router = TestBed.inject(Router);
    navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    http = TestBed.inject(HttpClient);
  });

  afterEach(() => verifyNoOutstandingRequests());

  const fail = async (url: string, status: number) => {
    const result = new Promise((resolve) => http.get(url).subscribe({ error: resolve }));
    flushProblem(expectRequest('GET', url), status);
    return result;
  };

  it('ends the session and goes to sign-in, keeping the return address, on a 401 from the API', async () => {
    const error = await fail('/api/portfolios', 401);
    expect(error).toMatchObject({ status: 401 });
    expect(auth.sessionEnded).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(['/sign-in'], { queryParams: { returnUrl: router.url }, replaceUrl: true });
  });

  it.each([
    ['a 401 from the sign-in endpoints themselves', '/api/auth/me', 401],
    ['a 403 from the API', '/api/portfolios', 403],
    ['a 500 from the API', '/api/portfolios', 500],
    ['a 401 from another address', '/other/thing', 401],
  ])('does nothing about %s, and still rethrows it', async (_name, url, status) => {
    const error = await fail(url, status);
    expect(error).toMatchObject({ status });
    expect(auth.sessionEnded).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('passes successful responses through', async () => {
    const result = new Promise((resolve) => http.get('/api/portfolios').subscribe(resolve));
    expectRequest('GET', '/api/portfolios').flush([1]);
    await expect(result).resolves.toEqual([1]);
  });

  it('rethrows an error that is not an HTTP response untouched', async () => {
    TestBed.resetTestingModule();
    const failure = new Error('interceptor failed');
    TestBed.configureTestingModule({
      providers: [
        provideAppTesting({ interceptors: [authInterceptor, () => throwError(() => failure)] }),
        provideFakeAuth(auth),
      ],
    });
    const error = await new Promise((resolve) =>
      TestBed.inject(HttpClient).get('/api/portfolios').subscribe({ error: resolve }),
    );
    expect(error).toBe(failure);
    expect(auth.sessionEnded).not.toHaveBeenCalled();
  });

  it('rethrows a network failure without ending the session', async () => {
    const result = new Promise((resolve) => http.get('/api/portfolios').subscribe({ error: resolve }));
    flushNetworkError(expectRequest('GET', '/api/portfolios'));
    await expect(result).resolves.toMatchObject({ status: 0 });
    expect(auth.sessionEnded).not.toHaveBeenCalled();
  });
});

describe('safeReturnUrl', () => {
  it.each([
    ['/assets', '/assets'],
    ['/portfolios/p1?tab=income', '/portfolios/p1?tab=income'],
    ['/', '/'],
  ])('keeps the site path %s', (input, expected) => {
    expect(safeReturnUrl(input)).toBe(expected);
  });

  it.each([[null], [''], ['//evil.example.com'], ['https://evil.example.com'], ['assets'], ['javascript:alert(1)']])(
    'falls back to the overview for %s',
    (input) => {
      expect(safeReturnUrl(input)).toBe('/');
    },
  );
});

describe('passkeyErrorMessage', () => {
  const named = (name: string) => new DOMException('x', name);

  it('is null for anything that is not a browser DOMException', () => {
    expect(passkeyErrorMessage(new Error('x'))).toBeNull();
    expect(passkeyErrorMessage('x')).toBeNull();
    expect(passkeyErrorMessage(null)).toBeNull();
  });

  it('explains a dismissed prompt', () => {
    expect(passkeyErrorMessage(named('NotAllowedError'))).toBe(
      'No passkey was used. Try again, or email yourself a sign-in link.',
    );
  });

  it('explains a duplicate registration', () => {
    expect(passkeyErrorMessage(named('InvalidStateError'))).toBe('This device already has a passkey for your account.');
  });

  it('names the public address when a security error says the page is on the wrong origin', () => {
    expect(passkeyErrorMessage(named('SecurityError'), 'https://money.example.com')).toBe(
      "Passkeys only work at Money Monkey's own address, https://money.example.com, over https or on localhost. Open Money Monkey there and try again.",
    );
  });

  it('gives a general security message when the public address is unknown', () => {
    expect(passkeyErrorMessage(named('SecurityError'))).toBe(
      'Passkeys only work over https or on localhost, at the address Money Monkey is set up for.',
    );
  });

  it('reports any other browser error by name', () => {
    expect(passkeyErrorMessage(named('AbortError'))).toBe('The passkey step failed (AbortError).');
  });
});
