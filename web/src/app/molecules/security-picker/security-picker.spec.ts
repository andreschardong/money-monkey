import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  bodyOf,
  expectRequest,
  flushNetworkError,
  flushProblem,
  holding,
  provideAppTesting,
  security,
  settle,
  symbolMatch,
  verifyNoOutstandingRequests,
} from '../../../testing';
import { Holding } from '../../core/models';
import { PickedSecurity, SecurityPicker } from './security-picker';

@Component({
  imports: [SecurityPicker],
  template: `<app-security-picker
    [holdings]="holdings()"
    [disabled]="disabled()"
    [label]="label()"
    [(value)]="picked"
  />`,
})
class Host {
  readonly holdings = signal<Holding[]>([]);
  readonly disabled = signal(false);
  readonly label = signal('Stock or fund');
  readonly picked = signal<PickedSecurity | null>(null);
}

/** Waits out the 250 ms debounce (and a slow machine) until the search request appears. */
const search = (url: string) => vi.waitFor(() => expectRequest('GET', url), { timeout: 3000 });
const debounce = () => new Promise<void>((resolve) => setTimeout(resolve, 300));

describe('SecurityPicker', () => {
  async function render(holdings: Holding[] = []) {
    TestBed.configureTestingModule({ imports: [Host], providers: [provideAppTesting()] });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.holdings.set(holdings);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const input = () => el.querySelector('input') as HTMLInputElement;
    const type = async (text: string) => {
      input().focus();
      input().value = text;
      input().dispatchEvent(new Event('input'));
      await settle();
    };
    const options = () => Array.from(document.querySelectorAll<HTMLElement>('mat-option'));
    const groups = () =>
      Array.from(document.querySelectorAll('mat-optgroup')).map(
        (g) => g.getAttribute('ng-reflect-label') ?? g.textContent,
      );
    return { fixture, host: fixture.componentInstance, el, input, type, options, groups };
  }

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((c) => (c.innerHTML = ''));
  });

  it('shows the label and the placeholder', async () => {
    const { el, input, host, fixture } = await render();

    host.label.set('Security');
    await fixture.whenStable();

    expect(el.querySelector('mat-label')?.textContent).toBe('Security');
    expect(input().placeholder).toContain('Symbol or company');
  });

  it('disables the field when told to', async () => {
    const { host, fixture, input } = await render();

    host.disabled.set(true);
    await fixture.whenStable();

    expect(input().disabled).toBe(true);
  });

  it('offers matching holdings first without calling the server for them', async () => {
    const { type, options } = await render([
      holding({ securityId: 's1', symbol: 'SHOP.TO', name: 'Shopify' }),
      holding({ securityId: 's2', symbol: 'ENB.TO', name: 'Enbridge' }),
    ]);

    await type('shop');

    expect(options().map((o) => o.querySelector('.sym')?.textContent)).toEqual(['SHOP.TO']);
    expect(document.querySelector('mat-optgroup')?.textContent).toContain('Your holdings');
    (await search('/api/securities/search?q=shop')).flush([]);
  });

  it('matches holdings by company name regardless of case', async () => {
    const { type, options } = await render([holding({ symbol: 'ENB.TO', name: 'Enbridge' })]);

    await type('ENBRI');

    expect(options().length).toBe(1);
    (await search('/api/securities/search?q=ENBRI')).flush([]);
  });

  it('searches the server after the typing pauses and lists the results', async () => {
    const { type, options } = await render();

    await type('app');
    verifyNoOutstandingRequests();
    const request = await search('/api/securities/search?q=app');
    request.flush([
      symbolMatch({ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' }),
      symbolMatch({ symbol: 'APLE', name: 'Apple Hospitality', exchange: 'NYSE' }),
    ]);
    await settle();

    expect(options().map((o) => o.querySelector('.sym')?.textContent)).toEqual(['AAPL', 'APLE']);
    expect(options()[0].querySelector('.nm')?.textContent).toBe('Apple Inc.');
    expect(options()[0].querySelector('.ex')?.textContent).toBe('NASDAQ');
    expect(document.querySelector('mat-optgroup')?.textContent).toContain('Search results');
  });

  it('searches once for a burst of keystrokes and trims the text', async () => {
    const { type } = await render();

    await type('a');
    await type('ap');
    await type('  apple ');
    (await search('/api/securities/search?q=apple')).flush([]);
    verifyNoOutstandingRequests();
  });

  it('does not list a search result already shown among the holdings', async () => {
    const { type, options } = await render([holding({ symbol: 'AAPL', name: 'Apple Inc.' })]);

    await type('app');
    (await search('/api/securities/search?q=app')).flush([
      symbolMatch({ symbol: 'AAPL', name: 'Apple Inc.' }),
      symbolMatch({ symbol: 'APLE', name: 'Apple Hospitality' }),
    ]);
    await settle();

    expect(options().map((o) => o.querySelector('.sym')?.textContent)).toEqual(['AAPL', 'APLE']);
    expect(document.querySelectorAll('mat-optgroup').length).toBe(2);
  });

  it('shows no options when the search finds nothing', async () => {
    const { type, options } = await render();

    await type('zzzz');
    (await search('/api/securities/search?q=zzzz')).flush([]);
    await settle();

    expect(options()).toEqual([]);
  });

  it('shows no options and no error when the search request fails', async () => {
    const { type, options, el } = await render();

    await type('app');
    flushNetworkError(await search('/api/securities/search?q=app'));
    await settle();

    expect(options()).toEqual([]);
    expect(el.querySelector('.error')).toBeNull();
  });

  it('does not search for blank text', async () => {
    const { type } = await render();

    await type('   ');
    await debounce();

    verifyNoOutstandingRequests();
  });

  it('picks one of the holdings straight away, with its own currency', async () => {
    const { type, options, host, fixture, el, input } = await render([
      holding({ securityId: 's9', symbol: 'AAPL', name: 'Apple Inc.', currency: 'USD', exchange: 'NASDAQ' }),
    ]);

    await type('aa');
    options()[0].click();
    await settle();

    expect(host.picked()).toEqual({
      securityId: 's9',
      symbol: 'AAPL',
      name: 'Apple Inc.',
      currency: 'USD',
      exchange: 'NASDAQ',
    });
    expect(el.querySelector('mat-hint')?.textContent).toBe('Apple Inc. on NASDAQ, priced in USD');
    expect(input().value).toBeTruthy();
    fixture.detectChanges();
    await debounce();
    verifyNoOutstandingRequests();
  });

  it('leaves out the exchange in the hint when the security has none', async () => {
    const { host, fixture, el } = await render();

    host.picked.set({ securityId: 's1', symbol: 'GOLD', name: 'Gold bars', currency: 'CAD', exchange: null });
    await fixture.whenStable();

    expect(el.querySelector('mat-hint')?.textContent).toBe('Gold bars, priced in CAD');
  });

  it('resolves a search result new to the app, then picks it', async () => {
    const { type, options, host, el } = await render();

    await type('app');
    (await search('/api/securities/search?q=app')).flush([
      symbolMatch({ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' }),
    ]);
    await settle();
    options()[0].click();
    await settle();

    expect(el.querySelector('mat-spinner')).not.toBeNull();
    const request = expectRequest('POST', '/api/securities');
    expect(bodyOf(request)).toEqual({ symbol: 'AAPL', historyFrom: null });
    request.flush(security({ id: 'new1', symbol: 'AAPL', name: 'Apple Inc.', currency: 'USD', exchange: 'NASDAQ' }));
    await settle();

    expect(host.picked()).toEqual({
      securityId: 'new1',
      symbol: 'AAPL',
      name: 'Apple Inc.',
      currency: 'USD',
      exchange: 'NASDAQ',
    });
    expect(el.querySelector('mat-spinner')).toBeNull();
  });

  it('keeps the symbol and shows the reason when the lookup is refused', async () => {
    const { type, options, host, el, input } = await render();

    await type('app');
    (await search('/api/securities/search?q=app')).flush([symbolMatch({ symbol: 'AAPL' })]);
    await settle();
    options()[0].click();
    await settle();
    flushProblem(expectRequest('POST', '/api/securities'), 422, 'No price history for AAPL.');
    await settle();

    expect(host.picked()).toBeNull();
    expect(el.querySelector('mat-hint.error')?.textContent).toBe('No price history for AAPL.');
    expect(input().value).toBe('AAPL');
    expect(el.querySelector('mat-spinner')).toBeNull();
  });

  it('clears the error and the pick as soon as the person types something else', async () => {
    const { type, host, fixture, el } = await render();
    host.picked.set({ securityId: 's1', symbol: 'XYZ', name: 'XYZ Corp', currency: 'CAD', exchange: 'TSX' });
    await fixture.whenStable();

    await type('XY');

    expect(host.picked()).toBeNull();
    expect(el.querySelector('mat-hint')).toBeNull();
    (await search('/api/securities/search?q=XY')).flush([]);
  });

  it('keeps a pick set from outside when the text typed is exactly its symbol', async () => {
    const { type, host, fixture } = await render();
    await type('aa');
    (await search('/api/securities/search?q=aa')).flush([]);
    host.picked.set({ securityId: 's9', symbol: 'AAPL', name: 'Apple Inc.', currency: 'USD', exchange: 'NASDAQ' });
    await fixture.whenStable();

    await type('AAPL');

    expect(host.picked()?.securityId).toBe('s9');
    (await search('/api/securities/search?q=AAPL')).flush([]);
  });

  it('shows the symbol of the picked security in the field', async () => {
    const { host, fixture, input } = await render();

    host.picked.set({ securityId: 's1', symbol: 'XYZ', name: 'XYZ Corp', currency: 'CAD', exchange: 'TSX' });
    await fixture.whenStable();

    expect(input().value).toBe('XYZ');
  });

  it('ignores a lookup that finishes after a newer pick', async () => {
    const { type, options, host } = await render([
      holding({ securityId: 's9', symbol: 'AAPL', name: 'Apple Inc.', currency: 'USD' }),
    ]);

    await type('app');
    (await search('/api/securities/search?q=app')).flush([symbolMatch({ symbol: 'APLE', name: 'Apple Hospitality' })]);
    await settle();
    options()
      .find((o) => o.textContent?.includes('APLE'))!
      .click();
    await settle();
    const slow = expectRequest('POST', '/api/securities');

    await type('app');
    options()
      .find((o) => o.textContent?.includes('AAPL'))!
      .click();
    await settle();
    slow.flush(security({ id: 'late', symbol: 'APLE' }));
    await settle();

    expect(host.picked()?.securityId).toBe('s9');
  });

  it('ignores a lookup that fails after a newer pick', async () => {
    const { type, options, host, el } = await render([
      holding({ securityId: 's9', symbol: 'AAPL', name: 'Apple Inc.', currency: 'USD' }),
    ]);

    await type('app');
    (await search('/api/securities/search?q=app')).flush([symbolMatch({ symbol: 'APLE', name: 'Apple Hospitality' })]);
    await settle();
    options()
      .find((o) => o.textContent?.includes('APLE'))!
      .click();
    await settle();
    const slow = expectRequest('POST', '/api/securities');

    await type('app');
    options()
      .find((o) => o.textContent?.includes('AAPL'))!
      .click();
    await settle();
    flushProblem(slow, 500, 'Late failure');
    await settle();

    expect(host.picked()?.securityId).toBe('s9');
    expect(el.querySelector('mat-hint.error')).toBeNull();
  });
});
