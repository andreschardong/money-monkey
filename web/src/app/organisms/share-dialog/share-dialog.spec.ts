import { TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { provideAppTesting } from '../../../testing/app-testing';
import { FakeDialogRef, provideDialogData } from '../../../testing/dialog';
import { share } from '../../../testing/fixtures';
import {
  bodyOf,
  expectRequest,
  flushNetworkError,
  flushProblem,
  settle,
  verifyNoOutstandingRequests,
} from '../../../testing/http';
import { typeInto } from '../../../testing/organism-dialogs';
import { Share } from '../../core/models';
import { ShareDialog } from './share-dialog';

const GRACE = share({ email: 'grace@example.com', canEdit: false });
const LINUS = share({ email: 'linus@example.com', canEdit: true });

describe('ShareDialog', () => {
  async function open(initial: Share[] | 'fail' | 'pending' = [GRACE, LINUS]) {
    TestBed.configureTestingModule({
      providers: [provideAppTesting(), provideDialogData({ portfolioId: 'p1', name: 'Retirement' })],
    });
    const fixture = TestBed.createComponent(ShareDialog);
    await settle();
    const request = expectRequest('GET', '/api/portfolios/p1/shares');
    if (initial === 'fail') {
      flushProblem(request, 403, 'Only the owner can see who it is shared with.');
    } else if (initial !== 'pending') {
      request.flush(initial);
    }
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      el,
      listRequest: request,
      ref: TestBed.inject(MatDialogRef) as unknown as FakeDialogRef,
      email: () => el.querySelector<HTMLInputElement>('input[type=email]')!,
      addCanEdit: () => el.querySelector<HTMLInputElement>('form.add mat-checkbox input')!,
      shareButton: () => el.querySelector<HTMLButtonElement>('form.add button[type=submit]')!,
      done: () =>
        Array.from(el.querySelectorAll<HTMLButtonElement>('mat-dialog-actions button')).find(
          (b) => b.textContent?.trim() === 'Done',
        )!,
      rows: () => Array.from(el.querySelectorAll('.list li')),
      emails: () => Array.from(el.querySelectorAll('.list .email')).map((e) => e.textContent?.trim()),
      rowCheckbox: (index: number) =>
        el.querySelectorAll('.list li')[index].querySelector<HTMLInputElement>('mat-checkbox input')!,
      rowRemove: (index: number) => el.querySelectorAll('.list li')[index].querySelector<HTMLButtonElement>('button')!,
      alert: () => el.querySelector('[role=alert]')?.textContent?.trim() ?? null,
    };
  }

  afterEach(() => verifyNoOutstandingRequests());

  describe('who it is shared with', () => {
    it('names the portfolio and lists each person with whether they can edit', async () => {
      const { el, emails, rowCheckbox, rows } = await open();

      expect(el.querySelector('h2')?.textContent).toBe('Share Retirement');
      expect(el.querySelector('ul')?.getAttribute('aria-label')).toBe('Shared with');
      expect(emails()).toEqual(['grace@example.com', 'linus@example.com']);
      expect(rows()).toHaveLength(2);
      expect(rowCheckbox(0).checked).toBe(false);
      expect(rowCheckbox(1).checked).toBe(true);
    });

    it('says so when the portfolio is not shared with anyone', async () => {
      const { el } = await open([]);

      expect(el.querySelector('.muted')?.textContent).toBe('Not shared with anyone yet.');
      expect(el.querySelector('ul')).toBeNull();
    });

    it('shows a loading indicator until the list arrives', async () => {
      const { el, listRequest } = await open('pending');

      expect(el.querySelector('app-busy')?.textContent).toContain('Loading…');
      expect(el.querySelector('ul')).toBeNull();
      listRequest.flush([]);
    });

    it('shows why the list could not be loaded and treats it as empty', async () => {
      const { el, alert } = await open('fail');

      expect(alert()).toBe('Only the owner can see who it is shared with.');
      expect(el.querySelector('.muted')?.textContent).toBe('Not shared with anyone yet.');
    });
  });

  describe('adding a person', () => {
    it('keeps the Share button disabled until an email is typed', async () => {
      const { fixture, email, shareButton } = await open();
      expect(shareButton().disabled).toBe(true);

      typeInto(email(), '   ');
      fixture.detectChanges();
      expect(shareButton().disabled).toBe(true);

      typeInto(email(), 'ada@example.com');
      fixture.detectChanges();
      expect(shareButton().disabled).toBe(false);
    });

    it('shares with the trimmed email as view-only, then clears the form and shows the new list', async () => {
      const { fixture, el, email, addCanEdit, emails } = await open();
      typeInto(email(), '  ada@example.com ');

      (el.querySelector('form.add') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
      const request = expectRequest('PUT', '/api/portfolios/p1/shares');
      expect(bodyOf(request)).toEqual({ email: 'ada@example.com', canEdit: false });
      request.flush([GRACE, LINUS, share({ email: 'ada@example.com' })]);
      await settle();
      fixture.detectChanges();

      expect(emails()).toEqual(['grace@example.com', 'linus@example.com', 'ada@example.com']);
      expect(email().value).toBe('');
      expect(addCanEdit().checked).toBe(false);
    });

    it('shares with editing allowed when the box is ticked, and un-ticks it afterwards', async () => {
      const { fixture, el, email, addCanEdit } = await open([]);
      typeInto(email(), 'ada@example.com');
      addCanEdit().click();
      fixture.detectChanges();

      (el.querySelector('form.add') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
      const request = expectRequest('PUT', '/api/portfolios/p1/shares');
      expect(bodyOf(request)).toEqual({ email: 'ada@example.com', canEdit: true });
      request.flush([share({ email: 'ada@example.com', canEdit: true })]);
      await settle();
      fixture.detectChanges();

      expect(addCanEdit().checked).toBe(false);
    });

    it('does nothing when the form is submitted with a blank email', async () => {
      const { el, email } = await open();
      typeInto(email(), '  ');

      (el.querySelector('form.add') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
      await settle();

      verifyNoOutstandingRequests();
    });

    it.each([
      [400, 'Enter a valid email address.'],
      [404, 'No Money Monkey account uses that email yet. Ask them to sign in once first.'],
      [409, 'It is already shared with that person.'],
      [500, 'Something went wrong on our side.'],
    ])('explains a %i answer and keeps what was typed', async (status, detail) => {
      const { fixture, el, email, alert, shareButton } = await open();
      typeInto(email(), 'stranger@example.com');

      (el.querySelector('form.add') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
      flushProblem(expectRequest('PUT', '/api/portfolios/p1/shares'), status, detail);
      await settle();
      fixture.detectChanges();

      expect(alert()).toBe(detail);
      expect(email().value).toBe('stranger@example.com');
      expect(shareButton().disabled).toBe(false);
    });

    it('says the server is unreachable on a network error', async () => {
      const { el, email, alert } = await open();
      typeInto(email(), 'ada@example.com');

      (el.querySelector('form.add') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
      flushNetworkError(expectRequest('PUT', '/api/portfolios/p1/shares'));
      await settle();

      expect(alert()).toBe('The Money Monkey server is not reachable. Check that it is running.');
    });
  });

  describe('changing permissions', () => {
    it('grants editing to someone who could only view', async () => {
      const { fixture, rowCheckbox, rows } = await open();

      rowCheckbox(0).click();
      const request = expectRequest('PUT', '/api/portfolios/p1/shares');
      expect(bodyOf(request)).toEqual({ email: 'grace@example.com', canEdit: true });
      fixture.detectChanges();
      expect(rows()[0].querySelector<HTMLInputElement>('mat-checkbox input')!.disabled).toBe(true);
      request.flush([share({ email: 'grace@example.com', canEdit: true }), LINUS]);
      await settle();
      fixture.detectChanges();

      expect(rowCheckbox(0).checked).toBe(true);
      expect(rowCheckbox(0).disabled).toBe(false);
    });

    it('takes editing away again', async () => {
      const { fixture, rowCheckbox } = await open();

      rowCheckbox(1).click();
      const request = expectRequest('PUT', '/api/portfolios/p1/shares');
      expect(bodyOf(request)).toEqual({ email: 'linus@example.com', canEdit: false });
      request.flush([GRACE, share({ email: 'linus@example.com', canEdit: false })]);
      await settle();
      fixture.detectChanges();

      expect(rowCheckbox(1).checked).toBe(false);
    });

    it('shows the problem when the change is refused', async () => {
      const { rowCheckbox, alert } = await open();

      rowCheckbox(0).click();
      flushProblem(expectRequest('PUT', '/api/portfolios/p1/shares'), 403, 'Only the owner can change sharing.');
      await settle();

      expect(alert()).toBe('Only the owner can change sharing.');
    });
  });

  describe('removing a person', () => {
    it('stops sharing with them and updates the list', async () => {
      const { fixture, rowRemove, emails } = await open();

      rowRemove(0).click();
      const request = expectRequest('DELETE', '/api/portfolios/p1/shares?email=grace@example.com');
      fixture.detectChanges();
      expect(rowRemove(0).disabled).toBe(true);
      request.flush([LINUS]);
      await settle();
      fixture.detectChanges();

      expect(emails()).toEqual(['linus@example.com']);
    });

    it('goes back to the empty message after the last person is removed', async () => {
      const { fixture, el, rowRemove } = await open([GRACE]);

      rowRemove(0).click();
      expectRequest('DELETE', '/api/portfolios/p1/shares?email=grace@example.com').flush([]);
      await settle();
      fixture.detectChanges();

      expect(el.querySelector('.muted')?.textContent).toBe('Not shared with anyone yet.');
    });

    it('shows the problem when removal fails and keeps the list', async () => {
      const { rowRemove, alert, emails } = await open();

      rowRemove(1).click();
      flushProblem(
        expectRequest('DELETE', '/api/portfolios/p1/shares?email=linus@example.com'),
        500,
        'Try again later.',
      );
      await settle();

      expect(alert()).toBe('Try again later.');
      expect(emails()).toEqual(['grace@example.com', 'linus@example.com']);
    });

    it('clears an earlier message when the next action starts', async () => {
      const { fixture, rowRemove, alert } = await open();
      rowRemove(0).click();
      flushProblem(
        expectRequest('DELETE', '/api/portfolios/p1/shares?email=grace@example.com'),
        500,
        'Try again later.',
      );
      await settle();
      expect(alert()).toBe('Try again later.');

      rowRemove(0).click();
      fixture.detectChanges();
      expect(alert()).toBeNull();
      expectRequest('DELETE', '/api/portfolios/p1/shares?email=grace@example.com').flush([LINUS]);
      await settle();
    });
  });

  describe('closing', () => {
    it('reports no change when nothing was shared, changed or removed', async () => {
      const { done, ref } = await open();

      done().click();

      expect(ref.close).toHaveBeenCalledExactlyOnceWith(false);
    });

    it('reports a change after a successful removal', async () => {
      const { done, ref, rowRemove } = await open();
      rowRemove(0).click();
      expectRequest('DELETE', '/api/portfolios/p1/shares?email=grace@example.com').flush([LINUS]);
      await settle();

      done().click();

      expect(ref.close).toHaveBeenCalledExactlyOnceWith(true);
    });

    it('reports no change when the only attempt failed', async () => {
      const { done, ref, rowRemove } = await open();
      rowRemove(0).click();
      flushProblem(expectRequest('DELETE', '/api/portfolios/p1/shares?email=grace@example.com'), 500, 'No.');
      await settle();

      done().click();

      expect(ref.close).toHaveBeenCalledExactlyOnceWith(false);
    });
  });
});
