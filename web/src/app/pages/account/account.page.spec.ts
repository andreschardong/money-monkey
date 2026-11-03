import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideAppTesting } from '../../../testing/app-testing';
import { FakeDialog, provideFakeDialog } from '../../../testing/dialog';
import {
  FakeAuth,
  FakePortfolioList,
  FakeVersionStore,
  provideFakeAuth,
  provideFakePortfolioList,
  provideFakeVersionStore,
} from '../../../testing/fakes';
import { passkey, version } from '../../../testing/fixtures';
import {
  bodyOf,
  expectRequest,
  flushNetworkError,
  flushProblem,
  settle,
  verifyNoOutstandingRequests,
} from '../../../testing/http';
import { ImportResult } from '../../core/models';
import { ConfirmDialog } from '../../molecules/confirm-dialog/confirm-dialog';
import { AccountPage } from './account.page';

function importResult(overrides: Partial<ImportResult> = {}): ImportResult {
  return { portfolios: 2, transactions: 10, cashBalances: 3, warnings: [], ...overrides };
}

describe('AccountPage', () => {
  let auth: FakeAuth;
  let list: FakePortfolioList;
  let versions: FakeVersionStore;
  let dialog: FakeDialog;
  let snack: { open: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    auth = new FakeAuth();
    list = new FakePortfolioList();
    versions = new FakeVersionStore(version());
    dialog = new FakeDialog();
    snack = { open: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideAppTesting(),
        provideFakeAuth(auth),
        provideFakePortfolioList(list),
        provideFakeVersionStore(versions),
        provideFakeDialog(dialog),
        { provide: MatSnackBar, useValue: snack },
      ],
    });
  });

  afterEach(() => verifyNoOutstandingRequests());

  const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  const button = (el: HTMLElement, label: string) =>
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(label)) as HTMLButtonElement;

  async function create() {
    const fixture = TestBed.createComponent(AccountPage);
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  describe('header', () => {
    it('names the signed-in account', async () => {
      const { el } = await create();
      expect(el.querySelector('h1')?.textContent).toBe('Account');
      expect(text(el.querySelector('header') as Element)).toContain('Signed in as ada@example.com');
    });

    it('signs out of this device', async () => {
      const { el } = await create();
      (
        Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Sign out') as HTMLElement
      ).click();
      expect(auth.signOut).toHaveBeenCalled();
    });

    it('signs out everywhere only after confirmation', async () => {
      const { el } = await create();
      button(el, 'Sign out everywhere').click();
      expect(dialog.last.component).toBe(ConfirmDialog);
      expect(dialog.last.data).toMatchObject({ title: 'Sign out everywhere?', confirm: 'Sign out everywhere' });
      dialog.closeLast(true);
      await settle();
      expect(auth.signOutEverywhere).toHaveBeenCalled();
    });

    it('stays signed in when the sign-out-everywhere dialog is cancelled', async () => {
      const { el } = await create();
      button(el, 'Sign out everywhere').click();
      dialog.closeLast();
      await settle();
      expect(auth.signOutEverywhere).not.toHaveBeenCalled();
    });
  });

  describe('display of gains', () => {
    it('shows the switch on, and hides gains on every page when it is turned off', async () => {
      const { fixture, el } = await create();
      const toggle = el.querySelector('mat-slide-toggle button') as HTMLButtonElement;
      expect(toggle.getAttribute('aria-checked')).toBe('true');

      toggle.click();
      await fixture.whenStable();

      expect(auth.setHideGains).toHaveBeenCalledWith(true);
      expect(snack.open).toHaveBeenCalledWith('Gains and losses are hidden on every page.');
    });

    it('says gains are shown again when the switch is turned back on', async () => {
      auth.hideGains.set(true);
      const { fixture, el } = await create();
      (el.querySelector('mat-slide-toggle button') as HTMLButtonElement).click();
      await fixture.whenStable();

      expect(auth.setHideGains).toHaveBeenCalledWith(false);
      expect(snack.open).toHaveBeenCalledWith('Gains and losses are shown again.');
    });

    it('shows the reason in the snackbar when saving fails, and frees the switch', async () => {
      auth.setHideGains.mockRejectedValueOnce(new Error('Offline'));
      const { fixture, el } = await create();
      (el.querySelector('mat-slide-toggle button') as HTMLButtonElement).click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(snack.open).toHaveBeenCalledWith('Offline', 'Close');
      expect((el.querySelector('mat-slide-toggle button') as HTMLButtonElement).disabled).toBe(false);
    });
  });

  describe('passkeys', () => {
    it('shows a spinner until the passkeys arrive', async () => {
      auth.passkeys.mockReturnValueOnce(new Promise(() => undefined));
      const { el } = await create();
      expect(text(el)).toContain('Loading passkeys…');
    });

    it('says there are none yet', async () => {
      const { el } = await create();
      expect(text(el)).toContain('No passkeys yet.');
    });

    it('lists each passkey with where it lives', async () => {
      auth.passkeys.mockResolvedValueOnce([passkey(), passkey({ id: 'k2', name: 'Phone', backedUp: false })]);
      const { el } = await create();
      const items = Array.from(el.querySelectorAll('ul.list li')).map((li) => text(li));
      expect(items).toHaveLength(2);
      expect(items[0]).toContain('Laptop');
      expect(items[0]).toContain('synced by its provider');
      expect(items[1]).toContain('Phone');
      expect(items[1]).toContain('this device only');
    });

    it('shows the problem when the list cannot be loaded', async () => {
      auth.passkeys.mockRejectedValueOnce(new Error('Server down'));
      const { el } = await create();
      expect(el.querySelector('p.error')?.textContent).toBe('Server down');
      expect(text(el)).toContain('No passkeys yet.');
    });

    it('adds a passkey with the typed name', async () => {
      auth.addPasskey.mockResolvedValueOnce([passkey({ name: 'Work laptop' })]);
      const { fixture, el } = await create();
      const input = el.querySelector('input[name="name"]') as HTMLInputElement;
      input.value = '  Work laptop ';
      input.dispatchEvent(new Event('input'));
      el.querySelector('form')?.dispatchEvent(new Event('submit'));
      await fixture.whenStable();
      fixture.detectChanges();

      expect(auth.addPasskey).toHaveBeenCalledWith('Work laptop');
      expect(snack.open).toHaveBeenCalledWith('Passkey added.');
      expect(text(el)).toContain('Work laptop');
      await fixture.whenStable();
      el.querySelector('form')?.dispatchEvent(new Event('submit'));
      await fixture.whenStable();
      expect(auth.addPasskey).toHaveBeenLastCalledWith(null);
    });

    it('adds a passkey without a name when the field is blank', async () => {
      const { fixture, el } = await create();
      el.querySelector('form')?.dispatchEvent(new Event('submit'));
      await fixture.whenStable();
      expect(auth.addPasskey).toHaveBeenCalledWith(null);
    });

    it('explains a passkey prompt that was cancelled', async () => {
      auth.addPasskey.mockRejectedValueOnce(new DOMException('cancelled', 'NotAllowedError'));
      const { fixture, el } = await create();
      el.querySelector('form')?.dispatchEvent(new Event('submit'));
      await fixture.whenStable();
      fixture.detectChanges();

      expect(el.querySelector('p.error')?.getAttribute('role')).toBe('alert');
      expect(el.querySelector('p.error')?.textContent).toContain('No passkey was used');
      expect(snack.open).not.toHaveBeenCalled();
    });

    it('shows the server message when adding a passkey is refused', async () => {
      auth.addPasskey.mockRejectedValueOnce(new Error('Too many passkeys'));
      const { fixture, el } = await create();
      el.querySelector('form')?.dispatchEvent(new Event('submit'));
      await fixture.whenStable();
      fixture.detectChanges();
      expect(el.querySelector('p.error')?.textContent).toBe('Too many passkeys');
    });

    it('explains that this browser cannot create passkeys', async () => {
      auth.passkeysSupported = false;
      const { el } = await create();
      expect(text(el)).toContain("This browser can't create passkeys here.");
      expect(el.querySelector('form.add')).toBeNull();
    });

    it('removes a passkey after confirmation', async () => {
      auth.passkeys.mockResolvedValueOnce([passkey(), passkey({ id: 'k2', name: 'Phone' })]);
      auth.removePasskey.mockResolvedValueOnce([passkey({ id: 'k2', name: 'Phone' })]);
      const { fixture, el } = await create();
      (el.querySelector('ul.list li button') as HTMLButtonElement).click();

      expect(dialog.last.data).toMatchObject({
        title: 'Remove Laptop?',
        message: 'The device that holds this passkey will no longer sign you in.',
        destructive: true,
      });
      dialog.closeLast(true);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(auth.removePasskey).toHaveBeenCalledWith('k1');
      expect(snack.open).toHaveBeenCalledWith('Passkey removed.');
      expect(el.querySelectorAll('ul.list li')).toHaveLength(1);
    });

    it('warns that the only passkey is going and keeps it when cancelled', async () => {
      auth.passkeys.mockResolvedValueOnce([passkey()]);
      const { fixture, el } = await create();
      (el.querySelector('ul.list li button') as HTMLButtonElement).click();

      expect((dialog.last.data as { message: string }).message).toContain('This is your only passkey.');
      dialog.closeLast();
      await fixture.whenStable();
      expect(auth.removePasskey).not.toHaveBeenCalled();
    });

    it('shows why removing a passkey failed', async () => {
      auth.passkeys.mockResolvedValueOnce([passkey()]);
      auth.removePasskey.mockRejectedValueOnce(new Error('Not found'));
      const { fixture, el } = await create();
      (el.querySelector('ul.list li button') as HTMLButtonElement).click();
      dialog.closeLast(true);
      await fixture.whenStable();

      expect(snack.open).toHaveBeenCalledWith('Not found', 'Close');
    });
  });

  describe('export', () => {
    it('offers each export as a download', async () => {
      const { el } = await create();
      const links = Array.from(el.querySelectorAll('.downloads a')).map((a) => [
        a.textContent?.trim(),
        a.getAttribute('href'),
      ]);
      expect(links).toEqual([
        ['Transactions (CSV)', '/api/export/transactions.csv'],
        ['Cash balances (CSV)', '/api/export/cash.csv'],
        ['Holdings today (CSV)', '/api/export/holdings.csv'],
        ['Everything (JSON)', '/api/export'],
      ]);
      expect(el.querySelector('a[href="/api/export"]')?.getAttribute('download')).toBe('folio-export.json');
    });
  });

  describe('import', () => {
    async function pick(el: HTMLElement, content: string | null) {
      const input = el.querySelector('input[type="file"]') as HTMLInputElement;
      const files = content === null ? [] : [new File([content], 'export.json', { type: 'application/json' })];
      Object.defineProperty(input, 'files', { configurable: true, value: files });
      input.dispatchEvent(new Event('change'));
      await settle();
    }

    it('opens the file chooser from the button', async () => {
      const { el } = await create();
      const click = vi.spyOn(el.querySelector('input[type="file"]') as HTMLInputElement, 'click');
      button(el, 'Import a JSON file').click();
      expect(click).toHaveBeenCalled();
    });

    it('does nothing when no file was chosen', async () => {
      const { el } = await create();
      await pick(el, null);
      expect(el.querySelector('.result')).toBeNull();
    });

    it('sends the export, then reports what was added and reloads the portfolio list', async () => {
      const { fixture, el } = await create();
      const data = { portfolios: [{ name: 'TFSA' }] };
      await pick(el, JSON.stringify(data));
      const request = expectRequest('POST', '/api/import');
      expect(bodyOf(request)).toEqual(data);
      request.flush(importResult({ portfolios: 1, transactions: 1, cashBalances: 1, warnings: ['XYZ was not found'] }));
      await settle();
      fixture.detectChanges();

      expect(text(el.querySelector('.result') as Element)).toBe(
        'Added 1 portfolio with 1 transaction and 1 cash balance. XYZ was not found',
      );
      expect(el.querySelector('.result')?.getAttribute('role')).toBe('status');
      expect(list.reload).toHaveBeenCalled();
      expect(snack.open).toHaveBeenCalledWith('Imported 1 portfolio.');
    });

    it('uses plurals for several portfolios', async () => {
      const { fixture, el } = await create();
      await pick(el, JSON.stringify({ portfolios: [] }));
      expectRequest('POST', '/api/import').flush(importResult());
      await settle();
      fixture.detectChanges();
      expect(text(el.querySelector('.result') as Element)).toBe(
        'Added 2 portfolios with 10 transactions and 3 cash balances.',
      );
      expect(snack.open).toHaveBeenCalledWith('Imported 2 portfolios.');
    });

    it('shows the button as busy while importing', async () => {
      const { fixture, el } = await create();
      await pick(el, JSON.stringify({ portfolios: [] }));
      fixture.detectChanges();
      expect(button(el, 'Importing…').disabled).toBe(true);
      expectRequest('POST', '/api/import').flush(importResult());
    });

    it.each([
      ['text that is not JSON', 'hello'],
      ['JSON that is not an object', '42'],
      ['JSON null', 'null'],
      ['an object with no portfolios list', '{"portfolios": 3}'],
    ])('refuses %s with a pointer to the right file', async (_name, content) => {
      const { fixture, el } = await create();
      await pick(el, content);
      fixture.detectChanges();

      expect(el.querySelector('p.error')?.textContent).toContain('That is not a Money Monkey export.');
      expect(el.querySelector('.result')).toBeNull();
    });

    it('shows the server reason when the import is rejected', async () => {
      const { fixture, el } = await create();
      await pick(el, JSON.stringify({ portfolios: [] }));
      flushProblem(expectRequest('POST', '/api/import'), 400, 'Unsupported export version');
      await settle();
      fixture.detectChanges();
      expect(el.querySelector('p.error')?.textContent).toBe('Unsupported export version');
      expect(list.reload).not.toHaveBeenCalled();
    });

    it('says the server is unreachable when the import cannot connect', async () => {
      const { fixture, el } = await create();
      await pick(el, JSON.stringify({ portfolios: [] }));
      flushNetworkError(expectRequest('POST', '/api/import'));
      await settle();
      fixture.detectChanges();
      expect(el.querySelector('p.error')?.textContent).toContain('not reachable');
    });
  });

  describe('about', () => {
    it('shows the version, commit and build time with a link to the source', async () => {
      const { el } = await create();
      const about = text(el.querySelector('section:last-of-type') as Element);
      expect(about).toContain('version 1.4.0');
      expect(about).toContain('commit abc1234');
      expect(about).toContain('built');
      expect(el.querySelector('a[target="_blank"]')?.getAttribute('rel')).toBe('noopener');
    });

    it('leaves out the commit and build time when the build does not record them', async () => {
      versions.value.set(version({ commit: null, builtAt: null }));
      const { el } = await create();
      const about = text(el.querySelector('section:last-of-type') as Element);
      expect(about).toContain('version 1.4.0');
      expect(about).not.toContain('commit');
      expect(about).not.toContain('built');
    });

    it('shows a spinner until the version is known', async () => {
      versions.value.set(null);
      const { el } = await create();
      expect(text(el.querySelector('section:last-of-type') as Element)).toContain('Loading…');
    });
  });
});
