import { TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { provideAppTesting } from '../../../testing/app-testing';
import { FakeDialogRef, provideDialogData } from '../../../testing/dialog';
import { cashBalance } from '../../../testing/fixtures';
import {
  bodyOf,
  expectRequest,
  flush,
  flushNetworkError,
  flushProblem,
  flushStatus,
  settle,
  verifyNoOutstandingRequests,
} from '../../../testing/http';
import { chooseOption, optionLabels, submitForm, typeInto } from '../../../testing/organism-dialogs';
import { CashEntry } from '../../core/models';
import { formatDate, formatMoney, toIsoDate } from '../../core/format';
import { CashDialog, CashDialogData } from './cash-dialog';

const ENTRIES: CashEntry[] = [
  { currency: 'CAD', date: '2026-08-31', balance: 400, note: 'Statement of Aug 31' },
  { currency: 'CAD', date: '2026-09-30', balance: 500, note: null },
  { currency: 'USD', date: '2026-09-15', balance: 200, note: 'US account' },
];

describe('CashDialog', () => {
  const baseData: CashDialogData = {
    portfolioId: 'p1',
    baseCurrency: 'CAD',
    balances: [cashBalance({ currency: 'CAD', balance: 500 }), cashBalance({ currency: 'USD', balance: 200 })],
  };

  async function open(data: CashDialogData = baseData, entries: CashEntry[] | 'fail' = ENTRIES) {
    TestBed.configureTestingModule({ providers: [provideAppTesting(), provideDialogData(data)] });
    const fixture = TestBed.createComponent(CashDialog);
    await settle();
    const request = expectRequest('GET', '/api/portfolios/p1/cash');
    if (entries === 'fail') {
      flushProblem(request, 500, 'Boom');
    } else {
      request.flush(entries);
    }
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      el,
      ref: TestBed.inject(MatDialogRef) as unknown as FakeDialogRef,
      balance: () => el.querySelector<HTMLInputElement>('input[type=number]')!,
      note: () => el.querySelector<HTMLInputElement>('input[maxlength="200"]')!,
      date: () => el.querySelector<HTMLInputElement>('input.mat-datepicker-input')!,
      alert: () => el.querySelector('[role=alert]')?.textContent?.trim() ?? null,
      saveButton: () => el.querySelector<HTMLButtonElement>('button[type=submit]')!,
      rows: () => Array.from(el.querySelectorAll('.entries li')),
    };
  }

  afterEach(() => verifyNoOutstandingRequests());

  describe('opening', () => {
    it('offers the base currency with its current balance filled in', async () => {
      const { el, balance } = await open();

      expect(el.querySelector('h2')?.textContent).toBe('Cash balance');
      expect(el.querySelector('mat-select')?.textContent).toContain('CAD');
      expect(balance().value).toBe('500');
      expect(el.querySelector('.mat-mdc-form-field-text-suffix')?.textContent).toBe('CAD');
    });

    it('starts on the requested currency when one is given', async () => {
      const { el, balance } = await open({ ...baseData, currency: 'USD' });

      expect(el.querySelector('mat-select')?.textContent).toContain('USD');
      expect(balance().value).toBe('200');
    });

    it('leaves the balance empty for a currency that holds no cash yet', async () => {
      const { balance } = await open({ ...baseData, currency: 'GBP' });

      expect(balance().value).toBe('');
    });

    it('lists the earlier balances of the selected currency, newest first, with their notes', async () => {
      const { el, rows } = await open();

      expect(el.querySelector('h3')?.textContent).toBe('Earlier CAD balances');
      const lines = rows().map((row) => row.textContent!.replace(/\s+/g, ' ').trim());
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain(formatDate('2026-09-30'));
      expect(lines[0]).toContain(formatMoney(500, 'CAD'));
      expect(lines[1]).toContain(formatDate('2026-08-31'));
      expect(lines[1]).toContain('Statement of Aug 31');
      expect(rows()[0].querySelector('button')?.getAttribute('aria-label')).toBe(
        `Remove the balance of ${formatDate('2026-09-30')}`,
      );
    });

    it('shows no history heading when the currency has no earlier balances', async () => {
      const { el } = await open(baseData, []);

      expect(el.querySelector('h3')).toBeNull();
      expect(el.querySelector('.entries')).toBeNull();
    });

    it('still works when the earlier balances cannot be loaded', async () => {
      const { el, alert } = await open(baseData, 'fail');

      expect(el.querySelector('h3')).toBeNull();
      expect(alert()).toBeNull();
      expect(el.querySelector('button[type=submit]')?.textContent).toContain('Save balance');
    });

    it('offers the base, portfolio, held and extra currencies without repeats', async () => {
      const { el } = await open({
        ...baseData,
        balances: [cashBalance({ currency: 'CHF' }), cashBalance({ currency: 'CAD' })],
      });

      (el.querySelector('mat-select .mat-mdc-select-trigger') as HTMLElement).click();
      await settle();

      const labels = optionLabels();
      expect(labels[0]).toBe('CAD');
      expect(labels).toEqual(expect.arrayContaining(['USD', 'EUR', 'CHF', 'GBP', 'JPY', 'AUD']));
      expect(new Set(labels).size).toBe(labels.length);
    });
  });

  describe('changing the currency', () => {
    it('swaps the balance and the history to the chosen currency', async () => {
      const { el, balance, rows } = await open();

      await chooseOption(el.querySelector('mat-select')!, 'USD');

      expect(balance().value).toBe('200');
      expect(el.querySelector('h3')?.textContent).toBe('Earlier USD balances');
      expect(rows()).toHaveLength(1);
      expect(el.querySelector('.mat-mdc-form-field-text-suffix')?.textContent).toBe('USD');
    });

    it('clears the balance when the chosen currency holds none', async () => {
      const { el, balance } = await open();

      await chooseOption(el.querySelector('mat-select')!, 'JPY');

      expect(balance().value).toBe('');
    });
  });

  describe('saving a balance', () => {
    it('sends the balance, date and trimmed note, then closes reporting a change', async () => {
      const { el, ref, balance, note } = await open();
      typeInto(balance(), '1234.56');
      typeInto(note(), '  Statement of Oct 31 ');

      submitForm(el);
      const request = expectRequest('PUT', '/api/portfolios/p1/cash');
      expect(bodyOf(request)).toEqual({
        currency: 'CAD',
        balance: 1234.56,
        date: toIsoDate(new Date()),
        note: 'Statement of Oct 31',
      });
      request.flush(ENTRIES[0]);
      await settle();

      expect(ref.close).toHaveBeenCalledExactlyOnceWith(true);
    });

    it('sends no note when the note is blank, and accepts a zero or negative balance', async () => {
      const { el, balance, note } = await open();
      typeInto(balance(), '-25');
      typeInto(note(), '   ');

      submitForm(el);
      const request = expectRequest('PUT', '/api/portfolios/p1/cash');

      expect(bodyOf(request)).toMatchObject({ balance: -25, note: null });
      request.flush(ENTRIES[0]);
      await settle();
    });

    it('sends the date that was typed', async () => {
      const { el, date } = await open();
      typeInto(date(), '2026-09-30');

      submitForm(el);
      const request = expectRequest('PUT', '/api/portfolios/p1/cash');

      expect(bodyOf(request)).toMatchObject({ date: '2026-09-30' });
      request.flush(ENTRIES[0]);
      await settle();
    });

    it('asks for the balance when it is empty and sends nothing', async () => {
      const { el, balance, alert } = await open();
      typeInto(balance(), '');

      submitForm(el);
      await settle();

      expect(alert()).toBe('Enter the balance.');
    });

    it('asks for a valid date when the date is empty', async () => {
      const { el, date, alert } = await open();
      typeInto(date(), '');

      submitForm(el);
      await settle();

      expect(alert()).toBe('Enter a valid date.');
    });

    it('asks for a valid date when the text is not a date', async () => {
      const { el, date, alert } = await open();
      typeInto(date(), 'next tuesday-ish');

      submitForm(el);
      await settle();

      expect(alert()).toBe('Enter a valid date.');
    });

    it('shows the server explanation and stays open when saving fails', async () => {
      const { el, ref, alert, saveButton } = await open();

      submitForm(el);
      flushProblem(expectRequest('PUT', '/api/portfolios/p1/cash'), 403, 'You can only view this portfolio.');
      await settle();

      expect(alert()).toBe('You can only view this portfolio.');
      expect(ref.close).not.toHaveBeenCalled();
      expect(saveButton().disabled).toBe(false);
    });

    it('says the server is unreachable on a network error', async () => {
      const { el, alert } = await open();

      submitForm(el);
      flushNetworkError(expectRequest('PUT', '/api/portfolios/p1/cash'));
      await settle();

      expect(alert()).toBe('The Money Monkey server is not reachable. Check that it is running.');
    });

    it('disables the save button while the request is in flight', async () => {
      const { fixture, el, saveButton } = await open();

      submitForm(el);
      fixture.detectChanges();
      expect(saveButton().disabled).toBe(true);

      expectRequest('PUT', '/api/portfolios/p1/cash').flush(ENTRIES[0]);
      await settle();
    });
  });

  describe('removing an earlier balance', () => {
    it('deletes it, reloads the history, and reports the change when closed', async () => {
      const { fixture, el, ref, rows } = await open();

      rows()[0].querySelector('button')!.click();
      expectRequest('DELETE', '/api/portfolios/p1/cash/CAD/2026-09-30').flush(null);
      await settle();
      await flush('GET', '/api/portfolios/p1/cash', [ENTRIES[0], ENTRIES[2]]);
      fixture.detectChanges();

      expect(rows()).toHaveLength(1);
      el.querySelector<HTMLButtonElement>('button[type=button]:not(.mat-mdc-icon-button)')!.click();
      expect(ref.close).toHaveBeenCalledExactlyOnceWith(true);
    });

    it('reports no change when closed without saving or removing anything', async () => {
      const { el, ref } = await open();

      el.querySelector<HTMLButtonElement>('button[type=button]:not(.mat-mdc-icon-button)')!.click();

      expect(ref.close).toHaveBeenCalledExactlyOnceWith(false);
    });

    it('shows why a removal was refused and keeps the list', async () => {
      const { fixture, rows, alert } = await open();

      rows()[0].querySelector('button')!.click();
      flushStatus(expectRequest('DELETE', '/api/portfolios/p1/cash/CAD/2026-09-30'), 409, 'Already removed.');
      await settle();
      fixture.detectChanges();

      expect(alert()).toBe('Already removed.');
      expect(rows()).toHaveLength(2);
    });
  });
});
