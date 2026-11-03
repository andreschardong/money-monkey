import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { provideAppTesting } from '../../../testing/app-testing';
import { FakeAuth, provideFakeAuth } from '../../../testing/fakes';
import { me } from '../../../testing/fixtures';
import { SignInPage } from './sign-in.page';

describe('SignInPage', () => {
  let auth: FakeAuth;
  let navigateByUrl: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    auth = new FakeAuth(me({ signedIn: false }));
  });

  function setup(returnUrl: string | null = null) {
    TestBed.configureTestingModule({
      providers: [
        provideAppTesting(),
        provideFakeAuth(auth),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(returnUrl === null ? {} : { returnUrl }) } },
        },
      ],
    });
    navigateByUrl = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(SignInPage);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  const type = async (fixture: { whenStable(): Promise<unknown> }, el: HTMLElement, value: string) => {
    await fixture.whenStable();
    const input = el.querySelector('input[type="email"]') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  const submit = async (fixture: { whenStable(): Promise<unknown>; detectChanges(): void }, el: HTMLElement) => {
    el.querySelector('form')?.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('offers a passkey and an email link', () => {
    const { el } = setup();
    expect(text(el)).toContain('Sign in');
    expect(text(el)).toContain('Sign in with a passkey');
    expect(text(el)).toContain('Email me a sign-in link');
  });

  it('offers only the email link where passkeys are unsupported', () => {
    auth.passkeysSupported = false;
    const { el } = setup();
    expect(text(el)).not.toContain('Sign in with a passkey');
    expect(el.querySelector('.divider')).toBeNull();
    expect(text(el)).toContain('Email me a sign-in link');
  });

  describe('with a passkey', () => {
    const passkeyButton = (el: HTMLElement) => el.querySelector('button.passkey') as HTMLButtonElement;

    it('signs in and goes to the page that asked for sign-in', async () => {
      const { fixture, el } = setup('/portfolios/p1');
      passkeyButton(el).click();
      await fixture.whenStable();

      expect(auth.signInWithPasskey).toHaveBeenCalled();
      expect(navigateByUrl).toHaveBeenCalledWith('/portfolios/p1');
    });

    it('goes to the overview when no return address was given', async () => {
      const { fixture, el } = setup();
      passkeyButton(el).click();
      await fixture.whenStable();
      expect(navigateByUrl).toHaveBeenCalledWith('/');
    });

    it('ignores a return address that leaves the site', async () => {
      const { fixture, el } = setup('https://evil.example/steal');
      passkeyButton(el).click();
      await fixture.whenStable();
      expect(navigateByUrl).toHaveBeenCalledWith('/');
    });

    it('disables the button while the browser asks for the passkey', () => {
      auth.signInWithPasskey.mockReturnValueOnce(new Promise(() => undefined));
      const { fixture, el } = setup();
      passkeyButton(el).click();
      fixture.detectChanges();
      expect(passkeyButton(el).disabled).toBe(true);
    });

    it('explains a cancelled passkey prompt and stays on the page', async () => {
      auth.signInWithPasskey.mockRejectedValueOnce(new DOMException('cancelled', 'NotAllowedError'));
      const { fixture, el } = setup();
      passkeyButton(el).click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(el.querySelector('p.error')?.getAttribute('role')).toBe('alert');
      expect(el.querySelector('p.error')?.textContent).toContain('No passkey was used');
      expect(navigateByUrl).not.toHaveBeenCalled();
      expect(passkeyButton(el).disabled).toBe(false);
    });

    it('shows the server message when the passkey is rejected', async () => {
      auth.signInWithPasskey.mockRejectedValueOnce(new HttpErrorResponse({ status: 401, statusText: 'Unauthorized' }));
      const { fixture, el } = setup();
      passkeyButton(el).click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(el.querySelector('p.error')?.textContent).toBe('The request failed (401 Unauthorized).');
    });
  });

  describe('with an email link', () => {
    it('asks for an address when the field has none', async () => {
      const { fixture, el } = setup();
      await type(fixture, el, 'not-an-address');
      await submit(fixture, el);

      expect(el.querySelector('p.error')?.textContent).toBe('Enter your email address.');
      expect(auth.requestEmailLink).not.toHaveBeenCalled();
    });

    it('sends the link and tells the person to check their email', async () => {
      const { fixture, el } = setup();
      await type(fixture, el, '  ada@example.com ');
      await submit(fixture, el);

      expect(auth.requestEmailLink).toHaveBeenCalledWith('ada@example.com');
      expect(text(el)).toContain('Check your email');
      expect(text(el)).toContain('We sent a link to ada@example.com.');
      expect(text(el)).not.toContain('Open the local inbox');
    });

    it('links to the local inbox when the server provides one', async () => {
      auth.requestEmailLink.mockResolvedValueOnce({ email: 'ada@example.com', inboxUrl: 'http://localhost:8025' });
      const { fixture, el } = setup();
      await type(fixture, el, 'ada@example.com');
      await submit(fixture, el);

      const link = el.querySelector('a[target="_blank"]') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('http://localhost:8025');
      expect(link.getAttribute('rel')).toBe('noopener');
    });

    it('goes back to the form to use a different address', async () => {
      const { fixture, el } = setup();
      await type(fixture, el, 'ada@example.com');
      await submit(fixture, el);
      (el.querySelector('button.again') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(el.querySelector('form')).not.toBeNull();
      expect(text(el)).not.toContain('Check your email');
    });

    it('shows the reason when the link cannot be sent', async () => {
      auth.requestEmailLink.mockRejectedValueOnce(
        new HttpErrorResponse({ status: 429, statusText: 'Too Many Requests' }),
      );
      const { fixture, el } = setup();
      await type(fixture, el, 'ada@example.com');
      await submit(fixture, el);

      expect(el.querySelector('p.error')?.textContent).toBe('The request failed (429 Too Many Requests).');
      expect(el.querySelector('form')).not.toBeNull();
    });
  });
});
