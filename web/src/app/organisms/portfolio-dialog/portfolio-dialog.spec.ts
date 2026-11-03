import { TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { provideAppTesting } from '../../../testing/app-testing';
import { FakeDialogRef, provideDialogData } from '../../../testing/dialog';
import { portfolioSummary } from '../../../testing/fixtures';
import {
  bodyOf,
  expectRequest,
  flushNetworkError,
  flushProblem,
  settle,
  verifyNoOutstandingRequests,
} from '../../../testing/http';
import { chooseOption, submitForm, typeInto } from '../../../testing/organism-dialogs';
import { PortfolioDialog, PortfolioDialogData } from './portfolio-dialog';

describe('PortfolioDialog', () => {
  async function open(data: PortfolioDialogData | null = {}) {
    TestBed.configureTestingModule({ providers: [provideAppTesting(), provideDialogData(data)] });
    const fixture = TestBed.createComponent(PortfolioDialog);
    await settle();
    fixture.detectChanges();
    await settle();
    const el = fixture.nativeElement as HTMLElement;
    const buttons = (group: string) =>
      Array.from(el.querySelectorAll<HTMLButtonElement>(`mat-button-toggle-group[aria-labelledby="${group}"] button`));
    return {
      fixture,
      el,
      ref: TestBed.inject(MatDialogRef) as unknown as FakeDialogRef,
      name: () => el.querySelector<HTMLInputElement>('input[maxlength="100"]')!,
      description: () => el.querySelector<HTMLTextAreaElement>('textarea')!,
      country: () => el.querySelector<HTMLElement>('mat-select')!,
      toggle: (group: string, label: string) => buttons(group).find((b) => b.textContent?.trim() === label)!,
      labels: (group: string) => buttons(group).map((b) => b.textContent?.trim()),
      pressed: (group: string) =>
        buttons(group)
          .filter((b) => b.closest('mat-button-toggle')!.classList.contains('mat-button-toggle-checked'))
          .map((b) => b.textContent?.trim()),
      alert: () => el.querySelector('[role=alert]')?.textContent?.trim() ?? null,
      submit: () => el.querySelector<HTMLButtonElement>('button[type=submit]')!,
      currencyHint: () => el.querySelectorAll('.currency .hint')[1].textContent!.replace(/\s+/g, ' ').trim(),
    };
  }

  afterEach(() => verifyNoOutstandingRequests());

  describe('creating a portfolio', () => {
    it('starts empty as an investment account in Canadian dollars', async () => {
      const { el, name, pressed, submit, country } = await open(null);

      expect(el.querySelector('h2')?.textContent).toBe('New portfolio');
      expect(name().value).toBe('');
      expect(pressed('kind-label')).toEqual(['Investment']);
      expect(pressed('currency-label')).toEqual(['CAD']);
      expect(country().querySelector('.mat-mdc-select-value-text')).toBeNull();
      expect(submit().textContent?.trim()).toBe('Create portfolio');
    });

    it('offers each account type and currency as a toggle', async () => {
      const { labels } = await open();

      expect(labels('kind-label')).toEqual(['Investment', 'Real estate']);
      expect(labels('currency-label')).toEqual(['CAD', 'USD', 'EUR']);
    });

    it('creates the portfolio with the trimmed name and closes with the saved portfolio', async () => {
      const { fixture, el, ref, name, description, toggle } = await open();
      typeInto(name(), '  TFSA  ');
      typeInto(description(), '  Tax-free savings ');
      toggle('currency-label', 'USD').click();
      toggle('kind-label', 'Real estate').click();
      fixture.detectChanges();

      submitForm(el);
      const request = expectRequest('POST', '/api/portfolios');
      expect(bodyOf(request)).toEqual({
        name: 'TFSA',
        baseCurrency: 'USD',
        description: 'Tax-free savings',
        country: null,
        kind: 'RealEstate',
      });
      const saved = portfolioSummary({ name: 'TFSA' });
      request.flush(saved);
      await settle();

      expect(ref.close).toHaveBeenCalledExactlyOnceWith(saved);
    });

    it('sends the chosen country and null for a blank description', async () => {
      const { el, name, country } = await open();
      typeInto(name(), 'Brazil fund');
      await chooseOption(country(), 'Brazil');

      submitForm(el);
      const request = expectRequest('POST', '/api/portfolios');

      expect(bodyOf(request)).toMatchObject({ country: 'BR', description: null });
      request.flush(portfolioSummary());
      await settle();
    });

    it('explains that holdings in other currencies are still allowed', async () => {
      const { currencyHint } = await open();

      expect(currencyHint()).toContain('The portfolio can still hold cash and stocks in other currencies.');
    });
  });

  describe('validation', () => {
    it('asks for a name when it is empty and sends nothing', async () => {
      const { el, alert, ref } = await open();

      submitForm(el);
      await settle();

      expect(alert()).toBe('Give the portfolio a name.');
      expect(ref.close).not.toHaveBeenCalled();
    });

    it('asks for a name again after the name is cleared', async () => {
      const { el, name, alert } = await open();
      typeInto(name(), 'Ab');
      typeInto(name(), '');

      submitForm(el);
      await settle();

      expect(alert()).toBe('Give the portfolio a name.');
    });
  });

  describe('editing a portfolio', () => {
    const portfolio = portfolioSummary({
      id: 'p9',
      name: 'RRSP',
      description: 'Long term',
      country: 'US',
      baseCurrency: 'USD',
      transactionsCount: 0,
    });

    it('shows the current values and a Save changes button', async () => {
      const { el, name, description, pressed, submit, country } = await open({ portfolio });

      expect(el.querySelector('h2')?.textContent).toBe('Edit portfolio');
      expect(name().value).toBe('RRSP');
      expect(description().value).toBe('Long term');
      expect(pressed('currency-label')).toEqual(['USD']);
      expect(country().textContent).toContain('United States');
      expect(submit().textContent?.trim()).toBe('Save changes');
    });

    it('updates the portfolio and closes with the result', async () => {
      const { el, ref, name } = await open({ portfolio });
      typeInto(name(), 'RRSP 2');

      submitForm(el);
      const request = expectRequest('PUT', '/api/portfolios/p9');
      expect(bodyOf(request)).toEqual({
        name: 'RRSP 2',
        baseCurrency: 'USD',
        description: 'Long term',
        country: 'US',
        kind: 'Investment',
      });
      const saved = portfolioSummary({ id: 'p9', name: 'RRSP 2' });
      request.flush(saved);
      await settle();

      expect(ref.close).toHaveBeenCalledExactlyOnceWith(saved);
    });

    it('can remove the country again', async () => {
      const { el, country } = await open({ portfolio });
      await chooseOption(country(), 'None');

      submitForm(el);
      const request = expectRequest('PUT', '/api/portfolios/p9');

      expect(bodyOf(request)).toMatchObject({ country: null });
      request.flush(portfolioSummary());
      await settle();
    });

    it('keeps the currency fixed once transactions are recorded', async () => {
      const { el, pressed, currencyHint } = await open({
        portfolio: portfolioSummary({ id: 'p9', baseCurrency: 'EUR', transactionsCount: 3 }),
      });

      expect(currencyHint()).toBe('The currency is fixed once transactions are recorded.');
      expect(pressed('currency-label')).toEqual(['EUR']);
      const currencyButtons = Array.from(
        el.querySelectorAll<HTMLButtonElement>('mat-button-toggle-group[aria-labelledby="currency-label"] button'),
      );
      expect(currencyButtons.length).toBe(3);
      expect(currencyButtons.every((b) => b.disabled)).toBe(true);

      submitForm(el);
      const request = expectRequest('PUT', '/api/portfolios/p9');
      expect(bodyOf(request)).toMatchObject({ baseCurrency: 'EUR' });
      request.flush(portfolioSummary());
      await settle();
    });
  });

  describe('when saving fails', () => {
    it.each([
      [400, 'Name is too long.'],
      [403, 'You can only view this portfolio.'],
      [409, 'A portfolio with that name already exists.'],
      [500, 'Something went wrong on our side.'],
    ])('shows the server explanation for a %i and stays open', async (status, detail) => {
      const { el, ref, name, alert, submit } = await open();
      typeInto(name(), 'TFSA');

      submitForm(el);
      flushProblem(expectRequest('POST', '/api/portfolios'), status, detail);
      await settle();

      expect(alert()).toBe(detail);
      expect(ref.close).not.toHaveBeenCalled();
      expect(submit().disabled).toBe(false);
    });

    it('says the server is unreachable on a network error', async () => {
      const { el, name, alert } = await open();
      typeInto(name(), 'TFSA');

      submitForm(el);
      flushNetworkError(expectRequest('POST', '/api/portfolios'));
      await settle();

      expect(alert()).toBe('The Money Monkey server is not reachable. Check that it is running.');
    });

    it('disables the button while saving and clears an earlier error on the next attempt', async () => {
      const { fixture, el, name, alert, submit } = await open();
      typeInto(name(), 'TFSA');
      submitForm(el);
      flushProblem(expectRequest('POST', '/api/portfolios'), 500, 'First failure');
      await settle();
      expect(alert()).toBe('First failure');

      submitForm(el);
      fixture.detectChanges();
      expect(alert()).toBeNull();
      expect(submit().disabled).toBe(true);

      expectRequest('POST', '/api/portfolios').flush(portfolioSummary());
      await settle();
    });
  });
});
