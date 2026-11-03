import { TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { provideAppTesting } from '../../../testing/app-testing';
import { FakeDialogRef, provideDialogData } from '../../../testing/dialog';
import {
  bodyOf,
  expectRequest,
  flushNetworkError,
  flushProblem,
  settle,
  verifyNoOutstandingRequests,
} from '../../../testing/http';
import { submitForm, typeInto } from '../../../testing/organism-dialogs';
import { PropertyDialog, PropertyDialogData } from './property-dialog';

const FILLED = { name: 'Cottage', date: '2020-05-01', price: '450000' };

describe('PropertyDialog', () => {
  async function open(data: PropertyDialogData = { portfolioId: 'p1', baseCurrency: 'CAD' }) {
    TestBed.configureTestingModule({ providers: [provideAppTesting(), provideDialogData(data)] });
    const fixture = TestBed.createComponent(PropertyDialog);
    await settle();
    const el = fixture.nativeElement as HTMLElement;
    const input = (label: string) => {
      const field = Array.from(el.querySelectorAll('mat-form-field')).find(
        (f) => f.querySelector('mat-label')?.textContent?.trim() === label,
      )!;
      return field.querySelector('input') as HTMLInputElement;
    };
    return {
      fixture,
      el,
      ref: TestBed.inject(MatDialogRef) as unknown as FakeDialogRef,
      input,
      fill(values: { name?: string; date?: string; price?: string } = FILLED) {
        if (values.name !== undefined) typeInto(input('Short name'), values.name);
        if (values.date !== undefined) typeInto(input('Purchase date'), values.date);
        if (values.price !== undefined) typeInto(input('Purchase price'), values.price);
      },
      alert: () => el.querySelector('[role=alert]')?.textContent?.trim() ?? null,
      submit: () => el.querySelector<HTMLButtonElement>('button[type=submit]')!,
    };
  }

  afterEach(() => verifyNoOutstandingRequests());

  it('shows the fields with the portfolio currency beside each amount', async () => {
    const { el, submit } = await open({ portfolioId: 'p1', baseCurrency: 'EUR' });

    expect(el.querySelector('h2')?.textContent).toBe('Add a property');
    const suffixes = Array.from(el.querySelectorAll('.mat-mdc-form-field-text-suffix')).map((s) => s.textContent);
    expect(suffixes).toEqual(['EUR', 'EUR', 'EUR']);
    expect(submit().textContent?.trim()).toBe('Add property');
    expect(el.querySelector('.error')).toBeNull();
  });

  it('adds the property with only the required fields and closes with true', async () => {
    const { el, ref, fill } = await open();
    fill();

    submitForm(el);
    const request = expectRequest('POST', '/api/portfolios/p1/properties');
    expect(bodyOf(request)).toEqual({
      name: 'Cottage',
      description: null,
      purchaseDate: '2020-05-01',
      purchasePrice: 450_000,
      closingCosts: null,
      currentValue: null,
    });
    request.flush(null);
    await settle();

    expect(ref.close).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("sends the trimmed name and description, closing costs and today's value", async () => {
    const { el, input, fill } = await open();
    fill({ name: '  Cottage  ', date: '2020-05-01', price: '450000.50' });
    typeInto(input('Address or description (optional)'), ' 12 Lake Road, Muskoka ');
    typeInto(input('Closing costs (optional)'), '0');
    typeInto(input('Value today (optional)'), '520000');

    submitForm(el);
    const request = expectRequest('POST', '/api/portfolios/p1/properties');

    expect(bodyOf(request)).toEqual({
      name: 'Cottage',
      description: '12 Lake Road, Muskoka',
      purchaseDate: '2020-05-01',
      purchasePrice: 450_000.5,
      closingCosts: 0,
      currentValue: 520_000,
    });
    request.flush(null);
    await settle();
  });

  describe('validation', () => {
    const message = 'Fill in a short name, the purchase date and a purchase price greater than zero.';

    it.each([
      ['no name', { name: '', date: '2020-05-01', price: '1000' }],
      ['no purchase date', { name: 'Cottage', date: '', price: '1000' }],
      ['no purchase price', { name: 'Cottage', date: '2020-05-01', price: '' }],
      ['a purchase price of zero', { name: 'Cottage', date: '2020-05-01', price: '0' }],
      ['a negative purchase price', { name: 'Cottage', date: '2020-05-01', price: '-5' }],
    ])('explains what is missing when there is %s, and sends nothing', async (_case, values) => {
      const { el, ref, fill, alert } = await open();
      fill(values);

      submitForm(el);
      await settle();

      expect(alert()).toBe(message);
      expect(ref.close).not.toHaveBeenCalled();
    });

    it('rejects negative closing costs', async () => {
      const { el, fill, input, alert } = await open();
      fill();
      typeInto(input('Closing costs (optional)'), '-1');

      submitForm(el);
      await settle();

      expect(alert()).toBe(message);
    });

    it('rejects a value today of zero', async () => {
      const { el, fill, input, alert } = await open();
      fill();
      typeInto(input('Value today (optional)'), '0');

      submitForm(el);
      await settle();

      expect(alert()).toBe(message);
    });

    it('does not accept text that is not a date', async () => {
      const { el, fill, alert } = await open();
      fill({ name: 'Cottage', date: 'someday', price: '1000' });

      submitForm(el);
      await settle();

      expect(alert()).toBe(message);
    });
  });

  describe('when saving fails', () => {
    it.each([
      [400, 'The purchase date is in the future.'],
      [403, 'You can only view this portfolio.'],
      [409, 'That property already exists.'],
      [500, 'Something went wrong on our side.'],
    ])('shows the server explanation for a %i and stays open', async (status, detail) => {
      const { el, ref, fill, alert, submit } = await open();
      fill();

      submitForm(el);
      flushProblem(expectRequest('POST', '/api/portfolios/p1/properties'), status, detail);
      await settle();

      expect(alert()).toBe(detail);
      expect(ref.close).not.toHaveBeenCalled();
      expect(submit().disabled).toBe(false);
    });

    it('says the server is unreachable on a network error', async () => {
      const { el, fill, alert } = await open();
      fill();

      submitForm(el);
      flushNetworkError(expectRequest('POST', '/api/portfolios/p1/properties'));
      await settle();

      expect(alert()).toBe('The Money Monkey server is not reachable. Check that it is running.');
    });

    it('disables the button while saving and clears an earlier message on the next attempt', async () => {
      const { fixture, el, fill, alert, submit } = await open();
      submitForm(el);
      await settle();
      expect(alert()).not.toBeNull();

      fill();
      submitForm(el);
      fixture.detectChanges();
      expect(alert()).toBeNull();
      expect(submit().disabled).toBe(true);

      expectRequest('POST', '/api/portfolios/p1/properties').flush(null);
      await settle();
    });
  });
});
