import { TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { provideAppTesting } from '../../../testing/app-testing';
import { FakeDialogRef, provideDialogData } from '../../../testing/dialog';
import { holding, security, symbolMatch, transaction } from '../../../testing/fixtures';
import {
  bodyOf,
  expectRequest,
  flushNetworkError,
  flushProblem,
  flushStatus,
  httpController,
  settle,
  verifyNoOutstandingRequests,
} from '../../../testing/http';
import { chooseOption, optionLabels, submitForm, typeInto } from '../../../testing/organism-dialogs';
import { formatDate, formatMoney, formatPrice, formatQuantity, formatRate, toIsoDate } from '../../core/format';
import { FxRates, IsoDate, Transaction, TransactionType } from '../../core/models';
import { PickedSecurity } from '../../molecules/security-picker/security-picker';
import { TransactionDialog, TransactionDialogData } from './transaction-dialog';

const TODAY = toIsoDate(new Date());
const OLDER = '2026-09-01';
const TRANSACTIONS_URL = '/api/portfolios/p1/transactions';

const XYZ: PickedSecurity = { securityId: 's1', symbol: 'XYZ', name: 'XYZ Corp', currency: 'CAD', exchange: 'TSX' };
const AAPL: PickedSecurity = { securityId: 's2', symbol: 'AAPL', name: 'Apple', currency: 'USD', exchange: 'NASDAQ' };

const USD_PER_CAD = 1.371234567;
const EUR_PER_CAD = 1.5;

/** What the API publishes for a day: units of CAD per unit of each currency. */
function ratesFor(date: IsoDate): FxRates {
  return {
    date,
    ratesDate: date,
    rates: [
      { from: 'CAD', to: 'CAD', rate: 1 },
      { from: 'USD', to: 'CAD', rate: USD_PER_CAD },
      { from: 'EUR', to: 'CAD', rate: EUR_PER_CAD },
    ],
  };
}

interface Lookups {
  /** The close the price lookup answers with; 'fail' makes it error, 'skip' leaves it pending. Default: no price for that day. */
  close?: number | null | 'fail' | 'skip';
  /** How the rates lookup answers; 'skip' leaves it pending. Default is the standard table. */
  fx?: 'fail' | 'skip' | ((date: IsoDate) => FxRates);
}

/** Answers every pending rates and price lookup. */
async function answer({ close = null, fx = ratesFor }: Lookups = {}): Promise<void> {
  for (const request of fx === 'skip' ? [] : httpController().match((r) => r.url === '/api/fx')) {
    const date = request.request.params.get('date')!;
    if (fx === 'fail') {
      flushProblem(request, 500, 'Rates are unavailable.');
    } else if (fx !== 'skip') {
      request.flush(fx(date));
    }
  }
  for (const request of close === 'skip' ? [] : httpController().match((r) => r.url.endsWith('/price-on'))) {
    const date = request.request.params.get('date')!;
    if (close === 'fail') {
      flushProblem(request, 500, 'No prices.');
    } else {
      request.flush({ securityId: 'x', requestedDate: date, date: close === null ? null : date, close });
    }
  }
  await settle();
}

describe('TransactionDialog', () => {
  async function open(overrides: Partial<TransactionDialogData> = {}, lookups: Lookups | false = {}) {
    const data: TransactionDialogData = {
      portfolioId: 'p1',
      baseCurrency: 'CAD',
      holdings: [holding()],
      cashCurrencies: ['CAD'],
      ...overrides,
    };
    TestBed.configureTestingModule({ providers: [provideAppTesting(), provideDialogData(data)] });
    const fixture = TestBed.createComponent(TransactionDialog);
    await settle();
    if (lookups !== false) {
      await answer(lookups);
    }
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const field = (label: string) =>
      Array.from(el.querySelectorAll('.grid mat-form-field, mat-form-field')).find(
        (f) => f.querySelector('mat-label')?.textContent?.trim() === label,
      ) as HTMLElement | undefined;
    const api = {
      fixture,
      el,
      ref: TestBed.inject(MatDialogRef) as unknown as FakeDialogRef,
      field,
      input: (label: string) => field(label)!.querySelector('input') as HTMLInputElement,
      hint: (label: string) => field(label)?.querySelector('mat-hint')?.textContent?.trim(),
      labels: () => Array.from(el.querySelectorAll('.grid mat-form-field mat-label')).map((l) => l.textContent?.trim()),
      typeButton: (type: TransactionType) => el.querySelector<HTMLButtonElement>(`[data-type="${type}"]`)!,
      selectedType: () => el.querySelector('[role=radio][aria-checked=true]')?.getAttribute('data-type'),
      alert: () => el.querySelector('[role=alert]')?.textContent?.trim() ?? null,
      submit: () => el.querySelector<HTMLButtonElement>('button[type=submit]')!,
      summary: () => {
        const p = el.querySelector('.summary');
        return p
          ? {
              label: p.querySelector('.secondary')?.textContent?.trim(),
              value: p.querySelector('strong')?.textContent?.trim(),
              extra: p.querySelector('.muted')?.textContent?.trim(),
            }
          : null;
      },
      async choose(type: TransactionType) {
        typeButton(type).click();
        await settle();
        fixture.detectChanges();
      },
      async type(label: string, value: string) {
        typeInto(api.input(label), value);
        await settle();
        fixture.detectChanges();
      },
      async save() {
        submitForm(el);
        await settle();
        fixture.detectChanges();
      },
    };
    const typeButton = api.typeButton;
    return api;
  }

  afterEach(() => {
    try {
      verifyNoOutstandingRequests();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  describe('the form', () => {
    it('opens on Buy with a title, nine transaction types and a Record buy button', async () => {
      const { el, selectedType, submit, typeButton } = await open();

      expect(el.querySelector('h2')?.textContent).toBe('Add transaction');
      const radios = Array.from(el.querySelectorAll('[role=radio]')).map((r) => r.textContent?.trim());
      expect(radios).toEqual([
        'Buy',
        'Sell',
        'Dividend',
        'Deposit',
        'Withdrawal',
        'Split',
        'Interest',
        'Fee',
        'Transfer in',
      ]);
      expect(el.querySelector('[role=radiogroup]')?.getAttribute('aria-label')).toBe('Transaction type');
      expect(selectedType()).toBe('Buy');
      expect(typeButton('Buy').tabIndex).toBe(0);
      expect(typeButton('Sell').tabIndex).toBe(-1);
      expect(submit().textContent?.trim()).toBe('Record buy');
      expect(el.querySelector('mat-icon svg')?.getAttribute('data-icon')).toBe('shopping_cart');
    });

    it('starts on the type given by the preset, with the preset values filled in', async () => {
      const { selectedType, input, submit, summary } = await open({
        preset: {
          type: 'Sell',
          security: XYZ,
          date: OLDER,
          quantity: 4,
          price: 12.5,
          fee: 1,
          note: 'Rebalance',
        },
      });

      expect(selectedType()).toBe('Sell');
      expect(submit().textContent?.trim()).toBe('Record sale');
      expect(input('Date').value).toBe(formatNumericDate(OLDER));
      expect(input('Shares').value).toBe('4');
      expect(input('Price per share').value).toBe('12.5');
      expect(input('Commission').value).toBe('1');
      expect(input('Note (optional)').value).toBe('Rebalance');
      expect(summary()).toEqual({ label: 'Proceeds', value: formatMoney(49, 'CAD'), extra: undefined });
    });

    it('offers the date picker, limited to today', async () => {
      const { input } = await open();

      expect(input('Date').getAttribute('max')).toBe(TODAY);
    });

    it.each([
      ['Buy', ['Shares', 'Price per share', 'Commission', 'Note (optional)'], true],
      ['Sell', ['Shares', 'Price per share', 'Commission', 'Note (optional)'], true],
      ['Transfer in', ['Shares', 'Cost per share', 'Note (optional)'], true],
      ['Dividend', ['Dividend received', 'Tax withheld', 'Paid in', 'Note (optional)'], true],
      ['Split', ['Shares before', 'Shares after', 'Note (optional)'], true],
      ['Deposit', ['Amount', 'Currency', 'Note (optional)'], false],
      ['Withdrawal', ['Amount', 'Currency', 'Note (optional)'], false],
      ['Interest', ['Amount', 'Currency', 'Note (optional)'], false],
      ['Fee', ['Amount', 'Currency', 'Note (optional)'], false],
    ] as const)('shows the right fields for %s', async (label, fields, picker) => {
      const { el, labels, fixture } = await open();

      Array.from(el.querySelectorAll<HTMLButtonElement>('[role=radio]'))
        .find((b) => b.textContent?.trim() === label)!
        .click();
      await settle();
      fixture.detectChanges();

      expect(labels()).toEqual(['Date', ...fields.filter((f) => f !== 'Note (optional)')]);
      expect(el.querySelector('app-security-picker') !== null).toBe(picker);
      expect(el.querySelector('input[maxlength="500"]')).not.toBeNull();
    });

    it('explains that deposits and withdrawals do not change the cash balance', async () => {
      const { choose, hint } = await open();

      await choose('Deposit');
      expect(hint('Amount')).toContain("It doesn't change the cash balance");
      await choose('Withdrawal');
      expect(hint('Amount')).toContain("It doesn't change the cash balance");
      await choose('Interest');
      expect(hint('Amount')).toBeUndefined();
      await choose('Fee');
      expect(hint('Amount')).toBeUndefined();
    });

    it('explains how to enter a split ratio', async () => {
      const { choose, hint } = await open();

      await choose('Split');

      expect(hint('Shares after')).toBe('A 4-for-1 split is 1 then 4; a 1-for-10 consolidation is 10 then 1.');
    });

    it('moves to the chosen type and clears an earlier error', async () => {
      const { choose, save, alert, selectedType, submit } = await open();
      await save();
      expect(alert()).toBe('Choose a stock or fund.');

      await choose('Fee');

      expect(alert()).toBeNull();
      expect(selectedType()).toBe('Fee');
      expect(submit().textContent?.trim()).toBe('Record fee');
    });
  });

  describe('keyboard operation of the type selector', () => {
    function press(el: HTMLElement, key: string): KeyboardEvent {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      el.querySelector('[role=radiogroup]')!.dispatchEvent(event);
      return event;
    }

    it.each([
      ['ArrowRight', 'Sell'],
      ['ArrowDown', 'Sell'],
      ['ArrowLeft', 'TransferIn'],
      ['ArrowUp', 'TransferIn'],
    ])('%s from Buy selects %s and moves focus to it', async (key, expected) => {
      const { el, selectedType, fixture } = await open();

      const event = press(el, key);
      await settle();
      fixture.detectChanges();

      expect(event.defaultPrevented).toBe(true);
      expect(selectedType()).toBe(expected);
      expect(document.activeElement?.getAttribute('data-type')).toBe(expected);
    });

    it('wraps from the last type to the first', async () => {
      const { el, choose, selectedType } = await open();
      await choose('TransferIn');

      press(el, 'ArrowRight');
      await settle();

      expect(selectedType()).toBe('Buy');
    });

    it('ignores other keys', async () => {
      const { el, selectedType } = await open();

      const event = press(el, 'Enter');

      expect(event.defaultPrevented).toBe(false);
      expect(selectedType()).toBe('Buy');
    });
  });

  describe('choosing the security', () => {
    it('asks for a security before anything else can be recorded', async () => {
      const { save, alert, el } = await open();
      expect(el.querySelector('app-security-picker')).not.toBeNull();

      await save();

      expect(alert()).toBe('Choose a stock or fund.');
    });

    it('takes one of the portfolio holdings from the picker and looks up its price', async () => {
      const { fixture, el, input, hint } = await open({ holdings: [holding({ symbol: 'XYZ', name: 'XYZ Corp' })] });
      const search = el.querySelector<HTMLInputElement>('app-security-picker input')!;

      search.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      await settle();
      fixture.detectChanges();
      expect(
        document.querySelector('mat-optgroup')?.getAttribute('ng-reflect-label') ??
          document.querySelector('mat-optgroup')?.textContent,
      ).toContain('Your holdings');
      document.querySelector<HTMLElement>('mat-option')!.click();
      await settle();
      await answer({ close: 101.25 });
      fixture.detectChanges();

      expect(el.querySelector('app-security-picker mat-hint')?.textContent).toBe('XYZ Corp on TSX, priced in CAD');
      expect(input('Price per share').value).toBe('101.25');
      expect(hint('Price per share')).toBe(`Close on ${formatDate(TODAY)}: ${formatPrice(101.25, 'CAD')}`);
    });

    it('resolves a searched security that is new to the app and switches to its currency', async () => {
      const { fixture, el, field } = await open({ holdings: [] });
      const search = el.querySelector<HTMLInputElement>('app-security-picker input')!;

      search.focus();
      typeInto(search, 'APP');
      await new Promise<void>((resolve) => setTimeout(resolve, 320));
      expectRequest('GET', '/api/securities/search?q=APP').flush([
        symbolMatch({ symbol: 'AAPL', name: 'Apple', exchange: 'NASDAQ' }),
      ]);
      await settle();
      fixture.detectChanges();
      document.querySelector<HTMLElement>('mat-option')!.click();
      await settle();
      const resolve = expectRequest('POST', '/api/securities');
      expect(bodyOf(resolve)).toEqual({ symbol: 'AAPL', historyFrom: null });
      resolve.flush(security({ id: 's2', symbol: 'AAPL', name: 'Apple', currency: 'USD', exchange: 'NASDAQ' }));
      await settle();
      await answer();
      fixture.detectChanges();

      expect(el.querySelector('app-security-picker mat-hint')?.textContent).toBe('Apple on NASDAQ, priced in USD');
      expect(field('USD to CAD rate')).toBeDefined();
    });

    it('shows how many shares are held when selling, and fills the quantity with Sell all', async () => {
      const { choose, el, fixture, input, summary } = await open({
        holdings: [holding({ securityId: 's1', quantity: 12.5 })],
        preset: { type: 'Buy', security: XYZ, price: 10 },
      });
      expect(el.querySelector('.held')).toBeNull();

      await choose('Sell');
      expect(el.querySelector('.held')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        'You hold 12.5 shares. Sell all',
      );
      el.querySelector<HTMLButtonElement>('.held button')!.click();
      await settle();
      fixture.detectChanges();

      expect(input('Shares').value).toBe('12.5');
      expect(summary()).toMatchObject({ label: 'Proceeds', value: formatMoney(125, 'CAD') });
    });

    it('does not offer Sell all for a security that is not held', async () => {
      const { choose, el } = await open({ holdings: [], preset: { type: 'Buy', security: XYZ } });

      await choose('Sell');

      expect(el.querySelector('.held')).toBeNull();
    });
  });

  describe('the closing price', () => {
    it('fills the price with the close on the chosen day and shows where it came from', async () => {
      const { input, hint } = await open({ preset: { type: 'Buy', security: XYZ } }, { close: 98.5 });

      expect(input('Price per share').value).toBe('98.5');
      expect(hint('Price per share')).toBe(`Close on ${formatDate(TODAY)}: ${formatPrice(98.5, 'CAD')}`);
    });

    it('shows the price in the security currency and uses four decimals under one dollar', async () => {
      const { hint } = await open({ preset: { type: 'Buy', security: AAPL } }, { close: 0.4321 });

      expect(hint('Price per share')).toBe(`Close on ${formatDate(TODAY)}: ${formatPrice(0.4321, 'USD')}`);
    });

    it('leaves the price empty and shows no hint when the day has no close', async () => {
      const { input, hint } = await open({ preset: { type: 'Buy', security: XYZ } }, { close: null });

      expect(input('Price per share').value).toBe('');
      expect(hint('Price per share')).toBeUndefined();
    });

    it('does not overwrite a price that came with the preset', async () => {
      const { input, hint } = await open({ preset: { type: 'Buy', security: XYZ, price: 50 } }, { close: 98.5 });

      expect(input('Price per share').value).toBe('50');
      expect(hint('Price per share')).toContain(formatPrice(98.5, 'CAD'));
    });

    it('does not overwrite a price the person typed before the answer arrived', async () => {
      const { type, input } = await open({ preset: { type: 'Buy', security: XYZ } }, false);
      await type('Price per share', '77');

      await answer({ close: 98.5 });

      expect(input('Price per share').value).toBe('77');
    });

    it('looks up the close again for a new date and refills a price the person did not type', async () => {
      const { type, input, hint, fixture } = await open({ preset: { type: 'Buy', security: XYZ } }, { close: 98.5 });

      await type('Date', OLDER);
      expectRequest('GET', `/api/fx?date=${OLDER}`).flush(ratesFor(OLDER));
      expectRequest('GET', `/api/securities/s1/price-on?date=${OLDER}`).flush({
        securityId: 's1',
        requestedDate: OLDER,
        date: '2026-08-29',
        close: 91,
      });
      await settle();
      fixture.detectChanges();

      expect(input('Price per share').value).toBe('91');
      expect(hint('Price per share')).toBe(`Close on ${formatDate('2026-08-29')}: ${formatPrice(91, 'CAD')}`);
    });

    it('ignores an answer for a date that is no longer the chosen one', async () => {
      const { type, input } = await open({ preset: { type: 'Buy', security: XYZ } }, false);
      await type('Date', OLDER);
      await answer({ close: 'skip' });

      const stale = expectRequest('GET', `/api/securities/s1/price-on?date=${TODAY}`);
      stale.flush({ securityId: 's1', requestedDate: TODAY, date: TODAY, close: 1 });
      await settle();
      expect(input('Price per share').value).toBe('');

      expectRequest('GET', `/api/securities/s1/price-on?date=${OLDER}`).flush({
        securityId: 's1',
        requestedDate: OLDER,
        date: OLDER,
        close: 2,
      });
      await settle();
      expect(input('Price per share').value).toBe('2');
    });

    it('carries on without a hint when the price lookup fails', async () => {
      const { input, hint } = await open({ preset: { type: 'Buy', security: XYZ } }, { close: 'fail' });

      expect(input('Price per share').value).toBe('');
      expect(hint('Price per share')).toBeUndefined();
    });

    it('does not look up a price for other kinds of transaction', async () => {
      const { choose } = await open({ preset: { type: 'Dividend', security: XYZ } });
      await choose('Split');
      await choose('Deposit');

      verifyNoOutstandingRequests();
    });
  });

  describe('exchange rates', () => {
    it('hides the rate for a security priced in the base currency', async () => {
      const { field } = await open({ preset: { type: 'Buy', security: XYZ } });

      expect(field('CAD to CAD rate')).toBeUndefined();
      expect(field('USD to CAD rate')).toBeUndefined();
    });

    it('fills the Bank of Canada rate for a foreign security, rounded to six decimals', async () => {
      const { input, hint } = await open({ preset: { type: 'Buy', security: AAPL } });

      expect(input('USD to CAD rate').value).toBe('1.371235');
      expect(hint('USD to CAD rate')).toBe(
        `Bank of Canada, ${formatDate(TODAY, 'short')}: ${formatRate(USD_PER_CAD)}. Use your broker's rate if you have it.`,
      );
    });

    it('converts the other way when the portfolio is in a foreign currency', async () => {
      const { input } = await open({ baseCurrency: 'USD', preset: { type: 'Buy', security: XYZ } });

      expect(input('CAD to USD rate').value).toBe(String(Math.round((1 / USD_PER_CAD) * 1e6) / 1e6));
    });

    it('asks the server for the rate if none can be worked out for that currency', async () => {
      const { input, hint } = await open({ baseCurrency: 'AUD', preset: { type: 'Buy', security: AAPL } });

      expect(input('USD to AUD rate').value).toBe('');
      expect(hint('USD to AUD rate')).toBe('Leave it empty to use the Bank of Canada rate for that day.');
    });

    it('explains the empty field when the rates are unavailable, and sends no rate', async () => {
      const { input, hint, type, save } = await open(
        { preset: { type: 'Buy', security: AAPL, price: 100 } },
        { fx: 'fail' },
      );

      expect(input('USD to CAD rate').value).toBe('');
      expect(hint('USD to CAD rate')).toBe('Leave it empty to use the Bank of Canada rate for that day.');
      await type('Shares', '2');
      await save();
      const request = expectRequest('POST', TRANSACTIONS_URL);

      expect(bodyOf(request)).toMatchObject({ fxRate: null });
      request.flush([]);
      await settle();
    });

    it('treats rates without a publication date as unavailable', async () => {
      const { hint } = await open(
        { preset: { type: 'Buy', security: AAPL } },
        { fx: (date) => ({ ...ratesFor(date), ratesDate: null }) },
      );

      expect(hint('USD to CAD rate')).toBe('Leave it empty to use the Bank of Canada rate for that day.');
    });

    it('does not use rates published for another day', async () => {
      const { hint } = await open({ preset: { type: 'Buy', security: AAPL } }, { fx: () => ratesFor('2020-01-02') });

      expect(hint('USD to CAD rate')).toBe('Leave it empty to use the Bank of Canada rate for that day.');
    });

    it('ignores rates that arrive for a date that is no longer chosen', async () => {
      const { type, input } = await open({ preset: { type: 'Buy', security: AAPL } }, false);
      await type('Date', OLDER);

      expectRequest('GET', `/api/fx?date=${TODAY}`).flush(ratesFor(TODAY));
      await settle();
      expect(input('USD to CAD rate').value).toBe('');

      expectRequest('GET', `/api/fx?date=${OLDER}`).flush({
        ...ratesFor(OLDER),
        rates: ratesFor(OLDER).rates.map((r) => ({ ...r, rate: r.from === 'USD' ? 1.25 : r.rate })),
      });
      await settle();
      expect(input('USD to CAD rate').value).toBe('1.25');
      expectRequest('GET', `/api/securities/s2/price-on?date=${OLDER}`).flush({
        securityId: 's2',
        requestedDate: OLDER,
        date: null,
        close: null,
      });
      expectRequest('GET', `/api/securities/s2/price-on?date=${TODAY}`).flush({
        securityId: 's2',
        requestedDate: TODAY,
        date: null,
        close: null,
      });
    });

    it('keeps a rate the person typed while the date and currency stay the same', async () => {
      const { type, input } = await open({ preset: { type: 'Buy', security: AAPL } });

      await type('USD to CAD rate', '1.4');
      await type('Shares', '3');

      expect(input('USD to CAD rate').value).toBe('1.4');
    });

    it('replaces a typed rate with the published one when the date changes', async () => {
      const { type, input, fixture } = await open({ preset: { type: 'Buy', security: AAPL } });
      await type('USD to CAD rate', '1.4');

      await type('Date', OLDER);
      expect(input('USD to CAD rate').value).toBe('');
      await answer();
      fixture.detectChanges();

      expect(input('USD to CAD rate').value).toBe('1.371235');
    });

    it('sends the rate that is shown with the transaction', async () => {
      const { type, save } = await open({ preset: { type: 'Buy', security: AAPL } });
      await type('Shares', '2');
      await type('Price per share', '100');
      await type('USD to CAD rate', '1.4');

      await save();
      const request = expectRequest('POST', TRANSACTIONS_URL);

      expect(bodyOf(request)).toMatchObject({ fxRate: 1.4 });
      request.flush([]);
      await settle();
    });

    it('sends no rate if it was cleared or is not positive', async () => {
      const { type, save } = await open({ preset: { type: 'Buy', security: AAPL, quantity: 2, price: 100 } });
      await type('USD to CAD rate', '0');

      await save();
      const request = expectRequest('POST', TRANSACTIONS_URL);

      expect(bodyOf(request)).toMatchObject({ fxRate: null });
      request.flush([]);
      await settle();
    });

    it('shows the rate for cash in a foreign currency and refills it when the currency changes', async () => {
      const { choose, el, input, fixture, hint } = await open();
      await choose('Deposit');
      expect(el.querySelector('mat-form-field.rate')).toBeNull();

      await chooseOption(el.querySelector<HTMLElement>('mat-select')!, 'USD');
      await answer();
      fixture.detectChanges();
      expect(input('USD to CAD rate').value).toBe('1.371235');

      await chooseOption(el.querySelector<HTMLElement>('mat-select')!, 'EUR');
      await answer();
      fixture.detectChanges();
      expect(input('EUR to CAD rate').value).toBe('1.5');
      expect(hint('EUR to CAD rate')).toContain('Bank of Canada');
    });

    it('does not offer a rate for splits', async () => {
      const { el } = await open({ preset: { type: 'Split', security: AAPL } });

      expect(el.querySelector('mat-form-field.rate')).toBeNull();
    });
  });

  describe('currencies', () => {
    it('lists the portfolio currencies, cash currencies and the security currency once each', async () => {
      const { choose, el } = await open({
        cashCurrencies: ['GBP', 'CAD'],
        preset: { type: 'Buy', security: { ...AAPL, currency: 'JPY' } },
      });
      await choose('Deposit');

      (el.querySelector('mat-select .mat-mdc-select-trigger') as HTMLElement).click();
      await settle();

      const labels = optionLabels();
      expect(labels).toEqual(['CAD', 'USD', 'EUR', 'GBP', 'JPY']);
    });

    it('records a deposit in the base currency by default', async () => {
      const { choose, el, save } = await open();
      await choose('Deposit');

      expect(el.querySelector('mat-select')?.textContent).toContain('CAD');
      await save();
    });

    it('pays a dividend in the currency of the security until a currency is chosen', async () => {
      const { choose, el, fixture } = await open({ preset: { type: 'Buy', security: AAPL } });

      await choose('Dividend');
      expect(el.querySelector('mat-select')?.textContent).toContain('USD');

      await chooseOption(el.querySelector<HTMLElement>('mat-select')!, 'EUR');
      await choose('Deposit');
      await choose('Dividend');
      await answer();
      fixture.detectChanges();

      expect(el.querySelector('mat-select')?.textContent).toContain('EUR');
    });

    it('goes back to the base currency for cash types unless a currency was chosen', async () => {
      const { choose, el, fixture } = await open({ preset: { type: 'Dividend', security: AAPL } });
      expect(el.querySelector('mat-select')?.textContent).toContain('USD');

      await choose('Fee');
      await answer();
      fixture.detectChanges();

      expect(el.querySelector('mat-select')?.textContent).toContain('CAD');
    });

    it('keeps the preset currency for cash types', async () => {
      const { choose, el, fixture } = await open({ preset: { type: 'Deposit', amount: 100, currency: 'EUR' } });
      await choose('Withdrawal');
      await answer();
      fixture.detectChanges();

      expect(el.querySelector('mat-select')?.textContent).toContain('EUR');
    });
  });

  describe('the summary line', () => {
    it('shows nothing until there is something to add up', async () => {
      const { summary } = await open({ preset: { type: 'Buy', security: XYZ } });

      expect(summary()).toBeNull();
    });

    it.each([
      ['no shares', { quantity: 0, price: 10 }],
      ['no price', { quantity: 5 }],
    ])('shows no total for a buy with %s', async (_label, preset) => {
      const { summary } = await open({ preset: { type: 'Buy', security: XYZ, ...preset } });

      expect(summary()).toBeNull();
    });

    it('adds the commission to the cost of a buy', async () => {
      const { summary } = await open({ preset: { type: 'Buy', security: XYZ, quantity: 10, price: 90.5, fee: 4.95 } });

      expect(summary()).toEqual({ label: 'Total cost', value: formatMoney(909.95, 'CAD'), extra: undefined });
    });

    it('allows a free share when the price is zero', async () => {
      const { summary } = await open({ preset: { type: 'Buy', security: XYZ, quantity: 10, price: 0, fee: 5 } });

      expect(summary()).toMatchObject({ label: 'Total cost', value: formatMoney(5, 'CAD') });
    });

    it('takes the commission off the proceeds of a sale', async () => {
      const { summary } = await open({ preset: { type: 'Sell', security: XYZ, quantity: 10, price: 90.5, fee: 4.95 } });

      expect(summary()).toMatchObject({ label: 'Proceeds', value: formatMoney(900.05, 'CAD') });
    });

    it('shows no total for a sale without a price', async () => {
      const { summary } = await open({ preset: { type: 'Sell', security: XYZ, quantity: 10 } });

      expect(summary()).toBeNull();
    });

    it('shows the book value of a transfer in, ignoring any commission', async () => {
      const { summary, el } = await open({
        preset: { type: 'TransferIn', security: XYZ, quantity: 10, price: 12.34, fee: 99 },
      });

      expect(summary()).toMatchObject({ label: 'Book value', value: formatMoney(123.4, 'CAD') });
      expect(el.querySelector('input[min="0"][placeholder="0"]')).toBeNull();
    });

    it('shows no book value for a transfer in without a price', async () => {
      const { summary } = await open({ preset: { type: 'TransferIn', security: XYZ, quantity: 10 } });

      expect(summary()).toBeNull();
    });

    it('converts a foreign total into the base currency with the rate shown', async () => {
      const { summary } = await open({ preset: { type: 'Buy', security: AAPL, quantity: 10, price: 100 } });

      expect(summary()).toEqual({
        label: 'Total cost',
        value: formatMoney(1000, 'USD'),
        extra: `about ${formatMoney(1000 * 1.371235, 'CAD')}`,
      });
    });

    it('shows a dividend as received, with the tax withheld', async () => {
      const { summary } = await open({ preset: { type: 'Dividend', security: XYZ, amount: 50, fee: 7.5 } });

      expect(summary()).toEqual({
        label: 'Received',
        value: formatMoney(42.5, 'CAD'),
        extra: `after ${formatMoney(7.5, 'CAD')} withheld`,
      });
    });

    it('shows a foreign dividend converted when nothing was withheld', async () => {
      const { summary } = await open({ preset: { type: 'Dividend', security: AAPL, amount: 20 } });

      expect(summary()).toEqual({
        label: 'Received',
        value: formatMoney(20, 'USD'),
        extra: `about ${formatMoney(20 * 1.371235, 'CAD')}`,
      });
    });

    it('shows nothing for a dividend without an amount', async () => {
      const { summary } = await open({ preset: { type: 'Dividend', security: XYZ } });

      expect(summary()).toBeNull();
    });

    it('shows a split ratio, and what a holding would become', async () => {
      const { summary } = await open({
        holdings: [holding({ securityId: 's1', quantity: 15 })],
        preset: { type: 'Split', security: XYZ, splitFrom: 2, splitTo: 3 },
      });

      expect(summary()).toEqual({
        label: 'Ratio',
        value: `${formatQuantity(2)} becomes ${formatQuantity(3)}`,
        extra: `${formatQuantity(15)} shares today would become ${formatQuantity(22.5)}`,
      });
    });

    it('shows a split ratio alone when the security is not held', async () => {
      const { summary } = await open({
        holdings: [],
        preset: { type: 'Split', security: XYZ, splitFrom: 10, splitTo: 1 },
      });

      expect(summary()).toEqual({ label: 'Ratio', value: '10 becomes 1', extra: undefined });
    });

    it('shows no ratio until both sides are filled in', async () => {
      const { summary, type } = await open({ preset: { type: 'Split', security: XYZ, splitFrom: 1 } });
      expect(summary()).toBeNull();

      await type('Shares before', '');
      await type('Shares after', '4');
      expect(summary()).toBeNull();
    });

    it('shows the amount of a deposit and converts it when it is in another currency', async () => {
      const { summary, el } = await open({ preset: { type: 'Deposit', amount: 250, currency: 'USD' } });
      await answer();

      expect(summary()).toEqual({
        label: 'Amount',
        value: formatMoney(250, 'USD'),
        extra: `about ${formatMoney(250 * 1.371235, 'CAD')}`,
      });
      expect(el.querySelector('mat-select')?.textContent).toContain('USD');
    });

    it('shows no amount for a withdrawal that has none', async () => {
      const { summary } = await open({ preset: { type: 'Withdrawal' } });

      expect(summary()).toBeNull();
    });

    it('follows what is typed', async () => {
      const { type, summary } = await open({ preset: { type: 'Fee' } });

      await type('Amount', '12.5');
      expect(summary()).toMatchObject({ label: 'Amount', value: formatMoney(12.5, 'CAD') });
      await type('Amount', '');
      expect(summary()).toBeNull();
    });
  });

  describe('recording a transaction', () => {
    async function recorded(request = expectRequest('POST', TRANSACTIONS_URL)) {
      request.flush([]);
      await settle();
      return request;
    }

    it('records a buy with the price, commission and trimmed note, then closes with a message', async () => {
      const { type, save, ref } = await open({ preset: { type: 'Buy', security: XYZ, date: OLDER } });
      await type('Shares', '10');
      await type('Price per share', '90.5');
      await type('Commission', '4.95');
      await type('Note (optional)', '  First lot ');

      await save();
      const request = expectRequest('POST', TRANSACTIONS_URL);
      expect(bodyOf(request)).toEqual({
        type: 'Buy',
        date: OLDER,
        note: 'First lot',
        fxRate: null,
        securityId: 's1',
        quantity: 10,
        price: 90.5,
        fee: 4.95,
      });
      await recorded(request);

      expect(ref.close).toHaveBeenCalledExactlyOnceWith({ message: 'Buy recorded.' });
    });

    it('records a buy without commission as a fee of zero and a blank note as none', async () => {
      const { type, save } = await open({ preset: { type: 'Buy', security: XYZ } });
      await type('Shares', '1');
      await type('Price per share', '0');
      await type('Note (optional)', '   ');

      await save();
      const request = expectRequest('POST', TRANSACTIONS_URL);

      expect(bodyOf(request)).toMatchObject({ price: 0, fee: 0, note: null, date: TODAY });
      await recorded(request);
    });

    it('records fractional shares exactly', async () => {
      const { type, save } = await open({ preset: { type: 'Buy', security: XYZ, price: 50_000 } });
      await type('Shares', '0.00012345');

      await save();
      const request = expectRequest('POST', TRANSACTIONS_URL);

      expect(bodyOf(request)).toMatchObject({ quantity: 0.00012345, price: 50_000 });
      await recorded(request);
    });

    it('records a sale and says so', async () => {
      const { type, save, ref } = await open({ preset: { type: 'Sell', security: XYZ, quantity: 5, price: 20 } });
      await type('Commission', '1');

      await save();
      const request = expectRequest('POST', TRANSACTIONS_URL);
      expect(bodyOf(request)).toMatchObject({ type: 'Sell', quantity: 5, price: 20, fee: 1 });
      await recorded(request);

      expect(ref.close).toHaveBeenCalledExactlyOnceWith({ message: 'Sale recorded.' });
    });

    it('records a transfer in with no commission and says so', async () => {
      const { save, ref } = await open({
        preset: { type: 'TransferIn', security: XYZ, quantity: 5, price: 20, fee: 3 },
      });

      await save();
      const request = expectRequest('POST', TRANSACTIONS_URL);
      expect(bodyOf(request)).toMatchObject({ type: 'TransferIn', quantity: 5, price: 20, fee: 0 });
      await recorded(request);

      expect(ref.close).toHaveBeenCalledExactlyOnceWith({ message: 'Transfer recorded.' });
    });

    it('records a dividend with its tax and currency', async () => {
      const { type, save, ref } = await open({ preset: { type: 'Dividend', security: AAPL } });
      await type('Dividend received', '20');
      await type('Tax withheld', '3');

      await save();
      const request = expectRequest('POST', TRANSACTIONS_URL);
      expect(bodyOf(request)).toEqual({
        type: 'Dividend',
        date: TODAY,
        note: null,
        fxRate: 1.371235,
        securityId: 's2',
        amount: 20,
        fee: 3,
        currency: 'USD',
      });
      await recorded(request);

      expect(ref.close).toHaveBeenCalledExactlyOnceWith({ message: 'Dividend recorded.' });
    });

    it('records a dividend with no tax as a fee of zero', async () => {
      const { save } = await open({ preset: { type: 'Dividend', security: XYZ, amount: 12 } });

      await save();
      const request = expectRequest('POST', TRANSACTIONS_URL);

      expect(bodyOf(request)).toMatchObject({ fee: 0, currency: 'CAD', fxRate: null });
      await recorded(request);
    });

    it('records a split without a rate or price', async () => {
      const { type, save, ref } = await open({ preset: { type: 'Split', security: XYZ } });
      await type('Shares after', '4');

      await save();
      const request = expectRequest('POST', TRANSACTIONS_URL);
      expect(bodyOf(request)).toEqual({
        type: 'Split',
        date: TODAY,
        note: null,
        securityId: 's1',
        splitFrom: 1,
        splitTo: 4,
      });
      await recorded(request);

      expect(ref.close).toHaveBeenCalledExactlyOnceWith({ message: 'Split recorded.' });
    });

    it.each([
      ['Deposit', 'Deposit recorded.'],
      ['Withdrawal', 'Withdrawal recorded.'],
      ['Interest', 'Interest recorded.'],
      ['Fee', 'Fee recorded.'],
    ] as const)('records a %s in cash', async (type, message) => {
      const { type: typeIn, save, ref } = await open({ preset: { type } });
      await typeIn('Amount', '250.75');

      await save();
      const request = expectRequest('POST', TRANSACTIONS_URL);
      expect(bodyOf(request)).toEqual({ type, date: TODAY, note: null, fxRate: null, amount: 250.75, currency: 'CAD' });
      await recorded(request);

      expect(ref.close).toHaveBeenCalledExactlyOnceWith({ message });
    });

    it('disables the button while the request is in flight', async () => {
      const { submit, save, fixture } = await open({ preset: { type: 'Deposit', amount: 5 } });

      await save();
      fixture.detectChanges();
      expect(submit().disabled).toBe(true);

      await recorded();
    });
  });

  describe('what must be filled in', () => {
    it('needs a valid date', async () => {
      const { type, save, alert } = await open({ preset: { type: 'Deposit', amount: 10 } });
      await type('Date', 'sometime soon');

      await save();

      expect(alert()).toBe('Enter a valid date.');
    });

    it('needs a date at all', async () => {
      const { type, save, alert } = await open({ preset: { type: 'Deposit', amount: 10 } });
      await type('Date', '');

      await save();

      expect(alert()).toBe('Enter a valid date.');
    });

    it.each([
      ['no shares', { price: 10 }, 'Enter the number of shares.'],
      ['zero shares', { quantity: 0, price: 10 }, 'Enter the number of shares.'],
      ['negative shares', { quantity: -2, price: 10 }, 'Enter the number of shares.'],
      ['no price', { quantity: 2 }, 'Enter the price per share.'],
      ['a negative price', { quantity: 2, price: -1 }, 'Enter the price per share.'],
    ])('asks for the missing part of a buy with %s', async (_label, preset, message) => {
      const { save, alert, ref } = await open({ preset: { type: 'Buy', security: XYZ, ...preset } });

      await save();

      expect(alert()).toBe(message);
      expect(ref.close).not.toHaveBeenCalled();
    });

    it.each([
      ['no shares before', { splitFrom: 0, splitTo: 4 }],
      ['no shares after', { splitFrom: 1 }],
      ['a negative ratio', { splitFrom: 1, splitTo: -4 }],
    ])('asks for both sides of a split with %s', async (_label, preset) => {
      const { save, alert } = await open({ preset: { type: 'Split', security: XYZ, ...preset } });

      await save();

      expect(alert()).toBe('Enter both sides of the split ratio.');
    });

    it.each([
      ['none', undefined],
      ['zero', 0],
      ['negative', -5],
    ])('asks for the amount of a dividend when it is %s', async (_label, amount) => {
      const { save, alert } = await open({ preset: { type: 'Dividend', security: XYZ, amount } });

      await save();

      expect(alert()).toBe('Enter the dividend amount.');
    });

    it.each([
      ['Deposit', undefined],
      ['Withdrawal', 0],
      ['Interest', -1],
      ['Fee', undefined],
    ] as const)('asks for an amount greater than zero for a %s of %s', async (type, amount) => {
      const { save, alert } = await open({ preset: { type, amount } });

      await save();

      expect(alert()).toBe('Enter an amount greater than zero.');
    });

    it.each(['Dividend', 'Split'] as const)('asks for a security before a %s', async (type) => {
      const { save, alert } = await open({ preset: { type, amount: 5, splitTo: 2 } });

      await save();

      expect(alert()).toBe('Choose a stock or fund.');
    });

    it('does not ask for a security for cash', async () => {
      const { save, alert, el } = await open({ preset: { type: 'Deposit' } });
      expect(el.querySelector('app-security-picker')).toBeNull();

      await save();

      expect(alert()).toBe('Enter an amount greater than zero.');
    });

    it('sends nothing while something is missing', async () => {
      const { save } = await open({ preset: { type: 'Buy', security: XYZ } });

      await save();

      verifyNoOutstandingRequests();
    });

    it('takes the message away as soon as anything is changed', async () => {
      const { save, alert, type } = await open({ preset: { type: 'Buy', security: XYZ } });
      await save();
      expect(alert()).toBe('Enter the number of shares.');

      await type('Shares', '1');

      expect(alert()).toBeNull();
    });
  });

  describe('when the server refuses', () => {
    async function submitDeposit() {
      const harness = await open({ preset: { type: 'Deposit', amount: 100 } });
      await harness.save();
      return { ...harness, request: expectRequest('POST', TRANSACTIONS_URL) };
    }

    it.each([
      [400, 'The amount is too large.'],
      [403, 'You can only view this portfolio.'],
      [404, 'That portfolio no longer exists.'],
      [500, 'Something went wrong on our side.'],
    ])('shows the explanation for a %i and stays open', async (status, detail) => {
      const { request, ref, alert, submit, fixture } = await submitDeposit();

      flushProblem(request, status, detail);
      await settle();
      fixture.detectChanges();

      expect(alert()).toBe(detail);
      expect(ref.close).not.toHaveBeenCalled();
      expect(submit().disabled).toBe(false);
    });

    it('shows the plain-text explanation of a 409', async () => {
      const { request, alert, fixture } = await submitDeposit();

      flushStatus(request, 409, 'That transaction already exists.');
      await settle();
      fixture.detectChanges();

      expect(alert()).toBe('That transaction already exists.');
    });

    it('says the server is unreachable on a network error', async () => {
      const { request, alert, fixture } = await submitDeposit();

      flushNetworkError(request);
      await settle();
      fixture.detectChanges();

      expect(alert()).toBe('The Money Monkey server is not reachable. Check that it is running.');
    });

    it('lets the person correct the form and try again', async () => {
      const { request, type, save, ref, alert, fixture } = await submitDeposit();
      flushProblem(request, 400, 'Too much.');
      await settle();
      fixture.detectChanges();
      expect(alert()).toBe('Too much.');

      await type('Amount', '50');
      expect(alert()).toBeNull();
      await save();
      const retry = expectRequest('POST', TRANSACTIONS_URL);
      expect(bodyOf(retry)).toMatchObject({ amount: 50 });
      retry.flush([]);
      await settle();

      expect(ref.close).toHaveBeenCalledExactlyOnceWith({ message: 'Deposit recorded.' });
    });
  });

  describe('editing a transaction', () => {
    const PUT_URL = `${TRANSACTIONS_URL}/t1`;

    function edit(
      overrides: Partial<Transaction>,
      data: Partial<TransactionDialogData> = {},
      lookups: Lookups | false = {},
    ) {
      return open({ transaction: transaction(overrides), ...data }, lookups);
    }

    it('shows the saved values of a buy and offers Save changes', async () => {
      const { el, input, submit, summary, selectedType } = await edit({
        type: 'Buy',
        securityId: 's2',
        symbol: 'AAPL',
        securityName: 'Apple',
        currency: 'USD',
        date: OLDER,
        quantity: 5,
        price: 150,
        fee: 9.99,
        fxRate: 1.35,
        note: 'Core',
      });

      expect(el.querySelector('h2')?.textContent).toBe('Edit transaction');
      expect(submit().textContent?.trim()).toBe('Save changes');
      expect(selectedType()).toBe('Buy');
      expect(el.querySelector('app-security-picker input')).not.toBeNull();
      expect(el.querySelector('app-security-picker mat-hint')?.textContent).toBe('Apple, priced in USD');
      expect(input('Date').value).toBe(formatNumericDate(OLDER));
      expect(input('Shares').value).toBe('5');
      expect(input('Price per share').value).toBe('150');
      expect(input('Commission').value).toBe('9.99');
      expect(input('USD to CAD rate').value).toBe('1.35');
      expect(input('Note (optional)').value).toBe('Core');
      expect(summary()).toMatchObject({ label: 'Total cost', value: formatMoney(759.99, 'USD') });
    });

    it("keeps the stored price and rate when the day's published ones differ", async () => {
      const { input, hint } = await edit(
        { securityId: 's2', symbol: 'AAPL', currency: 'USD', date: OLDER, price: 150, fxRate: 1.35 },
        {},
        { close: 160 },
      );

      expect(input('Price per share').value).toBe('150');
      expect(input('USD to CAD rate').value).toBe('1.35');
      expect(hint('Price per share')).toContain(formatPrice(160, 'USD'));
    });

    it('updates the transaction in place and says it was updated', async () => {
      const { type, save, ref } = await edit({
        securityId: 's1',
        symbol: 'XYZ',
        date: OLDER,
        quantity: 10,
        price: 90,
        fee: 0,
        note: null,
      });
      await type('Shares', '12');

      await save();
      const request = expectRequest('PUT', PUT_URL);
      expect(bodyOf(request)).toEqual({
        type: 'Buy',
        date: OLDER,
        note: null,
        fxRate: null,
        securityId: 's1',
        quantity: 12,
        price: 90,
        fee: 0,
      });
      request.flush(transaction());
      await settle();

      expect(ref.close).toHaveBeenCalledExactlyOnceWith({ message: 'Transaction updated.' });
    });

    it('shows a failed update without closing', async () => {
      const { save, alert, ref, fixture } = await edit({ securityId: 's1', symbol: 'XYZ' });

      await save();
      flushProblem(expectRequest('PUT', PUT_URL), 403, 'You can only view this portfolio.');
      await settle();
      fixture.detectChanges();

      expect(alert()).toBe('You can only view this portfolio.');
      expect(ref.close).not.toHaveBeenCalled();
    });

    it('shows a sale with the security name missing from the record', async () => {
      const { el, selectedType } = await edit({ type: 'Sell', securityId: 's1', symbol: null, securityName: null });

      expect(selectedType()).toBe('Sell');
      expect(el.querySelector('app-security-picker mat-hint')?.textContent).toBe(', priced in CAD');
    });

    it('shows a transfer in with its cost per share and no commission field', async () => {
      const { input, labels } = await edit({
        type: 'TransferIn',
        securityId: 's1',
        symbol: 'XYZ',
        quantity: 3,
        price: 40,
        fee: 0,
      });

      expect(labels()).toEqual(['Date', 'Shares', 'Cost per share']);
      expect(input('Cost per share').value).toBe('40');
    });

    it('shows a dividend with its tax and currency', async () => {
      const { input, el, save, ref } = await edit({
        type: 'Dividend',
        securityId: 's2',
        symbol: 'AAPL',
        currency: 'USD',
        date: OLDER,
        quantity: 0,
        price: 0,
        amount: 20,
        fee: 3,
        fxRate: 1.3,
      });

      expect(input('Dividend received').value).toBe('20');
      expect(input('Tax withheld').value).toBe('3');
      expect(el.querySelector('mat-select')?.textContent).toContain('USD');

      await save();
      const request = expectRequest('PUT', PUT_URL);
      expect(bodyOf(request)).toEqual({
        type: 'Dividend',
        date: OLDER,
        note: null,
        fxRate: 1.3,
        securityId: 's2',
        amount: 20,
        fee: 3,
        currency: 'USD',
      });
      request.flush(transaction());
      await settle();
      expect(ref.close).toHaveBeenCalledExactlyOnceWith({ message: 'Transaction updated.' });
    });

    it('shows a split with its ratio', async () => {
      const { input, save } = await edit({
        type: 'Split',
        securityId: 's1',
        symbol: 'XYZ',
        quantity: 0,
        price: 0,
        splitFrom: 1,
        splitTo: 4,
      });

      expect(input('Shares before').value).toBe('1');
      expect(input('Shares after').value).toBe('4');

      await save();
      const request = expectRequest('PUT', PUT_URL);
      expect(bodyOf(request)).toMatchObject({ type: 'Split', splitFrom: 1, splitTo: 4 });
      request.flush(transaction());
      await settle();
    });

    it('shows a split recorded without a ratio as one-to-nothing', async () => {
      const { input } = await edit({ type: 'Split', securityId: 's1', symbol: 'XYZ', splitFrom: 0, splitTo: 0 });

      expect(input('Shares before').value).toBe('1');
      expect(input('Shares after').value).toBe('');
    });

    it('shows a cash transaction in its own currency with the rate it was recorded at', async () => {
      const { input, el, summary } = await edit({
        type: 'Deposit',
        securityId: null,
        symbol: null,
        securityName: null,
        currency: 'USD',
        date: OLDER,
        quantity: 0,
        price: 0,
        amount: 1000,
        fee: 0,
        fxRate: 1.31,
        note: 'Transfer',
      });

      expect(el.querySelector('app-security-picker')).toBeNull();
      expect(input('Amount').value).toBe('1000');
      expect(el.querySelector('mat-select')?.textContent).toContain('USD');
      expect(input('USD to CAD rate').value).toBe('1.31');
      expect(summary()).toEqual({
        label: 'Amount',
        value: formatMoney(1000, 'USD'),
        extra: `about ${formatMoney(1310, 'CAD')}`,
      });
    });

    it('replaces the stored rate with the published one when the currency of a cash entry is changed', async () => {
      const { el, input, fixture } = await edit({
        type: 'Withdrawal',
        securityId: null,
        symbol: null,
        currency: 'USD',
        date: OLDER,
        amount: 10,
        fxRate: 1.31,
      });

      await chooseOption(el.querySelector<HTMLElement>('mat-select')!, 'EUR');
      await answer();
      fixture.detectChanges();

      expect(input('EUR to CAD rate').value).toBe('1.5');
    });

    it('does not rewrite the saved currency of a cash entry when the type is changed', async () => {
      const { choose, el, fixture } = await edit({
        type: 'Deposit',
        securityId: null,
        symbol: null,
        currency: 'EUR',
        date: OLDER,
        amount: 10,
        fxRate: 1.5,
      });

      await choose('Fee');
      await answer();
      fixture.detectChanges();

      expect(el.querySelector('mat-select')?.textContent).toContain('EUR');
    });
  });
});

/** The date input shows the locale's numeric form; the app's adapter formats en-CA as year-month-day. */
function formatNumericDate(iso: IsoDate): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: 'numeric', day: 'numeric' }).format(
    new Date(year, month - 1, day),
  );
}
