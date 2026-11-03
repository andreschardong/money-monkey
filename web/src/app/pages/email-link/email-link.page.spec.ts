import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { provideAppTesting } from '../../../testing/app-testing';
import { FakeAuth, provideFakeAuth } from '../../../testing/fakes';
import { me } from '../../../testing/fixtures';
import { EmailLinkPage } from './email-link.page';

describe('EmailLinkPage', () => {
  let auth: FakeAuth;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    auth = new FakeAuth(me({ signedIn: false }));
  });

  function setup(token: string | null = 'tok-123') {
    TestBed.configureTestingModule({
      providers: [
        provideAppTesting({ routes: [{ path: '**', children: [] }] }),
        provideFakeAuth(auth),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(token === null ? {} : { token }) } },
        },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(EmailLinkPage);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  const button = (el: HTMLElement, label: string) =>
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
  const settled = async (fixture: { whenStable(): Promise<unknown>; detectChanges(): void }) => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('waits for a click before using the link, so a mail scanner does not use it up', () => {
    const { el } = setup();
    expect(text(el)).toContain('Sign in to Money Monkey');
    expect(text(el)).toContain('The link works once.');
    expect(auth.verifyEmailLink).not.toHaveBeenCalled();
  });

  it('says the link is incomplete when it carries no token', () => {
    const { el } = setup(null);
    expect(text(el)).toContain("This link didn't work");
    expect(text(el)).toContain('The link is incomplete.');
    expect(el.querySelector('a[mat-flat-button]')?.getAttribute('href')).toBe('/sign-in');
    expect(auth.verifyEmailLink).not.toHaveBeenCalled();
  });

  it('does not try to verify without a token', async () => {
    const { fixture, el } = setup(null);
    await settled(fixture);
    expect(el.querySelector('button')).toBeNull();
    expect(auth.verifyEmailLink).not.toHaveBeenCalled();
  });

  describe('after Continue', () => {
    it('shows progress while the link is checked', () => {
      auth.verifyEmailLink.mockReturnValueOnce(new Promise(() => undefined));
      const { fixture, el } = setup();
      button(el, 'Continue').click();
      fixture.detectChanges();
      expect(text(el)).toContain('Signing you in…');
      expect(auth.verifyEmailLink).toHaveBeenCalledWith('tok-123', false);
    });

    it('goes to the overview when the account already has a passkey', async () => {
      auth.verifyEmailLink.mockResolvedValueOnce(me({ passkeys: 1 }));
      const { fixture, el } = setup();
      button(el, 'Continue').click();
      await settled(fixture);
      expect(navigate).toHaveBeenCalledWith(['/'], { replaceUrl: true });
    });

    it('goes to the overview when the browser cannot create passkeys', async () => {
      auth.passkeysSupported = false;
      auth.verifyEmailLink.mockResolvedValueOnce(me({ passkeys: 0 }));
      const { fixture, el } = setup();
      button(el, 'Continue').click();
      await settled(fixture);
      expect(navigate).toHaveBeenCalledWith(['/'], { replaceUrl: true });
    });

    it('offers to add a passkey to a new account', async () => {
      auth.verifyEmailLink.mockResolvedValueOnce(me({ passkeys: 0 }));
      const { fixture, el } = setup();
      button(el, 'Continue').click();
      await settled(fixture);

      expect(text(el)).toContain("You're in");
      expect(text(el)).toContain('Add a passkey so this device signs you in');
      expect(navigate).not.toHaveBeenCalled();
    });

    it('explains an expired or used link and points back to sign-in', async () => {
      auth.verifyEmailLink.mockRejectedValueOnce(
        new HttpErrorResponse({
          status: 400,
          error: { title: 'Bad', status: 400, detail: 'This link has expired or was already used.' },
        }),
      );
      const { fixture, el } = setup();
      button(el, 'Continue').click();
      await settled(fixture);

      expect(text(el)).toContain("This link didn't work");
      expect(text(el)).toContain('This link has expired or was already used.');
      expect(el.querySelector('a[mat-flat-button]')?.getAttribute('href')).toBe('/sign-in');
    });

    it('asks before switching away from another signed-in account', async () => {
      auth.verifyEmailLink.mockRejectedValueOnce(
        new HttpErrorResponse({ status: 409, error: 'You are signed in as grace@example.com.' }),
      );
      const { fixture, el } = setup();
      button(el, 'Continue').click();
      await settled(fixture);

      expect(text(el)).toContain('Switch account?');
      expect(text(el)).toContain('You are signed in as grace@example.com.');

      auth.verifyEmailLink.mockResolvedValueOnce(me({ passkeys: 2 }));
      button(el, "Switch to the link's account").click();
      await settled(fixture);
      expect(auth.verifyEmailLink).toHaveBeenLastCalledWith('tok-123', true);
      expect(navigate).toHaveBeenCalledWith(['/'], { replaceUrl: true });
    });

    it('keeps the current session when the switch is declined', async () => {
      auth.verifyEmailLink.mockRejectedValueOnce(new HttpErrorResponse({ status: 409, error: 'Signed in elsewhere.' }));
      const { fixture, el } = setup();
      button(el, 'Continue').click();
      await settled(fixture);
      button(el, 'Keep my current session').click();
      await settled(fixture);
      expect(navigate).toHaveBeenCalledWith(['/'], { replaceUrl: true });
    });

    it('treats any other failure as a broken link', async () => {
      auth.verifyEmailLink.mockRejectedValueOnce(new Error('Boom'));
      const { fixture, el } = setup();
      button(el, 'Continue').click();
      await settled(fixture);
      expect(text(el)).toContain("This link didn't work");
      expect(text(el)).toContain('Boom');
    });
  });

  describe('adding a passkey', () => {
    async function offered() {
      auth.verifyEmailLink.mockResolvedValueOnce(me({ passkeys: 0 }));
      const page = setup();
      button(page.el, 'Continue').click();
      await settled(page.fixture);
      return page;
    }

    it('adds it with the typed name and goes on to the overview', async () => {
      const { fixture, el } = await offered();
      const input = el.querySelector('input') as HTMLInputElement;
      input.value = ' Home PC ';
      input.dispatchEvent(new Event('input'));
      button(el, 'Add a passkey').click();
      await settled(fixture);

      expect(auth.addPasskey).toHaveBeenCalledWith('Home PC');
      expect(navigate).toHaveBeenCalledWith(['/'], { replaceUrl: true });
    });

    it('adds it unnamed when the field is blank', async () => {
      const { fixture, el } = await offered();
      button(el, 'Add a passkey').click();
      await settled(fixture);
      expect(auth.addPasskey).toHaveBeenCalledWith(null);
    });

    it('skips it with Not now', async () => {
      const { fixture, el } = await offered();
      button(el, 'Not now').click();
      await settled(fixture);
      expect(auth.addPasskey).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith(['/'], { replaceUrl: true });
    });

    it('explains a cancelled prompt and lets the person try again', async () => {
      auth.addPasskey.mockRejectedValueOnce(new DOMException('cancelled', 'NotAllowedError'));
      const { fixture, el } = await offered();
      button(el, 'Add a passkey').click();
      await settled(fixture);

      expect(el.querySelector('p.error')?.getAttribute('role')).toBe('alert');
      expect(el.querySelector('p.error')?.textContent).toContain('No passkey was used');
      expect(button(el, 'Add a passkey').disabled).toBe(false);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('shows the server message when the passkey is refused', async () => {
      auth.addPasskey.mockRejectedValueOnce(
        new HttpErrorResponse({ status: 500, statusText: 'Internal Server Error' }),
      );
      const { fixture, el } = await offered();
      button(el, 'Add a passkey').click();
      await settled(fixture);
      expect(el.querySelector('p.error')?.textContent).toBe('The request failed (500 Internal Server Error).');
    });
  });
});
