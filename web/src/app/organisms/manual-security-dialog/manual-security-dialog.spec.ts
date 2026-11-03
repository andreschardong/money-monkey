import { TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { provideAppTesting } from '../../../testing/app-testing';
import { FakeDialogRef, provideDialogData } from '../../../testing/dialog';
import { security } from '../../../testing/fixtures';
import {
  bodyOf,
  expectRequest,
  flushNetworkError,
  flushProblem,
  settle,
  verifyNoOutstandingRequests,
} from '../../../testing/http';
import { chooseOption, submitForm, typeInto } from '../../../testing/organism-dialogs';
import { toIsoDate } from '../../core/format';
import { ManualSecurityDialog, ManualSecurityDialogData } from './manual-security-dialog';

describe('ManualSecurityDialog', () => {
  async function open(data: ManualSecurityDialogData | null = {}) {
    TestBed.configureTestingModule({ providers: [provideAppTesting(), provideDialogData(data)] });
    const fixture = TestBed.createComponent(ManualSecurityDialog);
    await settle();
    const el = fixture.nativeElement as HTMLElement;
    const field = (label: string) =>
      Array.from(el.querySelectorAll('mat-form-field')).find(
        (f) => f.querySelector('mat-label')?.textContent?.trim() === label,
      ) as HTMLElement | undefined;
    return {
      fixture,
      el,
      ref: TestBed.inject(MatDialogRef) as unknown as FakeDialogRef,
      field,
      input: (label: string) => field(label)!.querySelector('input') as HTMLInputElement,
      select: (label: string) => field(label)!.querySelector('mat-select') as HTMLElement,
      labels: () => Array.from(el.querySelectorAll('mat-form-field mat-label')).map((l) => l.textContent?.trim()),
      title: () => el.querySelector('h2')?.textContent?.trim(),
      alert: () => el.querySelector('[role=alert]')?.textContent?.trim() ?? null,
      submit: () => el.querySelector<HTMLButtonElement>('button[type=submit]')!,
    };
  }

  afterEach(() => verifyNoOutstandingRequests());

  describe('adding a manually priced security', () => {
    it('asks for the code, type, name, currency, price and date', async () => {
      const { labels, title, submit, el } = await open(null);

      expect(title()).toBe('Add a manually priced security');
      expect(labels()).toEqual(['Short name or code', 'Type', 'Name', 'Currency', 'Price per unit', 'As of']);
      expect(submit().textContent?.trim()).toBe('Add security');
      expect(el.querySelector('.intro')?.textContent).toContain('You update the price yourself.');
    });

    it('lists every asset type, with the unusual ones explained', async () => {
      const { select } = await open();
      (select('Type').querySelector('.mat-mdc-select-trigger') as HTMLElement).click();
      await settle();

      const options = Array.from(document.querySelectorAll('mat-option')).map((o) => o.textContent?.trim());
      expect(options).toEqual(['Fund', 'Stock', 'ETF', 'Crypto', 'Other (GIC, bond, private)']);
    });

    it('creates the security with the choices made and closes with true', async () => {
      const { el, ref, input, select } = await open();
      typeInto(input('Short name or code'), '  GIC-2027 ');
      typeInto(input('Name'), ' EQ Bank 2-year GIC ');
      await chooseOption(select('Type'), 'Other (GIC, bond, private)');
      await chooseOption(select('Currency'), 'USD');
      typeInto(input('Price per unit'), '100.25');
      typeInto(input('As of'), '2026-10-01');

      submitForm(el);
      const request = expectRequest('POST', '/api/securities/manual');
      expect(bodyOf(request)).toEqual({
        symbol: 'GIC-2027',
        name: 'EQ Bank 2-year GIC',
        currency: 'USD',
        assetType: 'Other',
        price: 100.25,
        date: '2026-10-01',
      });
      request.flush(security());
      await settle();

      expect(ref.close).toHaveBeenCalledExactlyOnceWith(true);
    });

    it('defaults to a CAD fund priced today', async () => {
      const { el, input } = await open();
      typeInto(input('Short name or code'), 'FUND1');
      typeInto(input('Name'), 'Private fund');
      typeInto(input('Price per unit'), '10');

      submitForm(el);
      const request = expectRequest('POST', '/api/securities/manual');

      expect(bodyOf(request)).toMatchObject({ currency: 'CAD', assetType: 'Fund', date: toIsoDate(new Date()) });
      request.flush(security());
      await settle();
    });

    it.each([
      ['no code', { code: '', name: 'Private fund', price: '10' }],
      ['no name', { code: 'FUND1', name: '', price: '10' }],
      ['no price', { code: 'FUND1', name: 'Private fund', price: '' }],
      ['a price of zero', { code: 'FUND1', name: 'Private fund', price: '0' }],
      ['a negative price', { code: 'FUND1', name: 'Private fund', price: '-3' }],
    ])('explains what is missing when there is %s', async (_case, values) => {
      const { el, ref, input, alert } = await open();
      typeInto(input('Short name or code'), values.code);
      typeInto(input('Name'), values.name);
      typeInto(input('Price per unit'), values.price);

      submitForm(el);
      await settle();

      expect(alert()).toBe('Fill in the code, name and a price greater than zero.');
      expect(ref.close).not.toHaveBeenCalled();
    });
  });

  describe('updating the price of an existing security', () => {
    const gic = security({ id: 's9', symbol: 'GIC-2027', assetType: 'Other', lastPrice: 101.5 });

    it('asks only for the new price and date, worded as a price', async () => {
      const { labels, title, submit, input, el } = await open({ security: gic });

      expect(title()).toBe('Update price of GIC-2027');
      expect(labels()).toEqual(['Price per unit', 'As of']);
      expect(el.querySelector('.intro')).toBeNull();
      expect(input('Price per unit').value).toBe('101.5');
      expect(submit().textContent?.trim()).toBe('Save price');
    });

    it('posts the new price for the chosen day and closes with true', async () => {
      const { el, ref, input } = await open({ security: gic });
      typeInto(input('Price per unit'), '103.75');
      typeInto(input('As of'), '2026-10-15');

      submitForm(el);
      const request = expectRequest('POST', '/api/securities/s9/prices');
      expect(bodyOf(request)).toEqual({ date: '2026-10-15', close: 103.75 });
      request.flush(null);
      await settle();

      expect(ref.close).toHaveBeenCalledExactlyOnceWith(true);
    });

    it('starts with an empty price when the security has none yet', async () => {
      const { input } = await open({ security: security({ lastPrice: null }) });

      expect(input('Price per unit').value).toBe('');
    });

    it.each([
      ['an empty price', ''],
      ['a price of zero', '0'],
      ['a negative price', '-1'],
    ])('asks for a price greater than zero when there is %s', async (_case, price) => {
      const { el, input, alert, ref } = await open({ security: gic });
      typeInto(input('Price per unit'), price);

      submitForm(el);
      await settle();

      expect(alert()).toBe('Enter a price greater than zero.');
      expect(ref.close).not.toHaveBeenCalled();
    });
  });

  describe('updating the value of a property', () => {
    const house = security({ id: 's7', symbol: 'COTTAGE', assetType: 'RealEstate', lastPrice: 500_000 });

    it('words everything as a value rather than a price', async () => {
      const { labels, title, submit } = await open({ security: house });

      expect(title()).toBe('Update value of COTTAGE');
      expect(labels()).toEqual(['Value', 'As of']);
      expect(submit().textContent?.trim()).toBe('Save value');
    });

    it('posts the new value', async () => {
      const { el, input } = await open({ security: house });
      typeInto(input('Value'), '525000');

      submitForm(el);
      const request = expectRequest('POST', '/api/securities/s7/prices');

      expect(bodyOf(request)).toMatchObject({ close: 525_000 });
      request.flush(null);
      await settle();
    });

    it('asks for a value greater than zero', async () => {
      const { el, input, alert } = await open({ security: house });
      typeInto(input('Value'), '0');

      submitForm(el);
      await settle();

      expect(alert()).toBe('Enter a value greater than zero.');
    });
  });

  describe('when saving fails', () => {
    it.each([
      [400, 'The date is in the future.'],
      [403, 'You cannot change this security.'],
      [409, 'A security with that code already exists.'],
      [500, 'Something went wrong on our side.'],
    ])('shows the server explanation for a %i on a new security and stays open', async (status, detail) => {
      const { el, ref, input, alert, submit } = await open();
      typeInto(input('Short name or code'), 'FUND1');
      typeInto(input('Name'), 'Private fund');
      typeInto(input('Price per unit'), '10');

      submitForm(el);
      flushProblem(expectRequest('POST', '/api/securities/manual'), status, detail);
      await settle();

      expect(alert()).toBe(detail);
      expect(ref.close).not.toHaveBeenCalled();
      expect(submit().disabled).toBe(false);
    });

    it('says the server is unreachable when updating a price', async () => {
      const { el, alert } = await open({ security: security({ id: 's9' }) });

      submitForm(el);
      flushNetworkError(expectRequest('POST', '/api/securities/s9/prices'));
      await settle();

      expect(alert()).toBe('The Money Monkey server is not reachable. Check that it is running.');
    });

    it('disables the button while saving and clears an earlier message on the next attempt', async () => {
      const { fixture, el, input, alert, submit } = await open({ security: security({ id: 's9' }) });
      typeInto(input('Price per unit'), '');
      submitForm(el);
      await settle();
      expect(alert()).not.toBeNull();

      typeInto(input('Price per unit'), '12');
      submitForm(el);
      fixture.detectChanges();
      expect(alert()).toBeNull();
      expect(submit().disabled).toBe(true);

      expectRequest('POST', '/api/securities/s9/prices').flush(null);
      await settle();
    });
  });
});
