import { TestBed } from '@angular/core/testing';
import { CurrencySwitch } from './currency-switch';

describe('CurrencySwitch', () => {
  async function render(value: string) {
    TestBed.configureTestingModule({ imports: [CurrencySwitch] });
    const fixture = TestBed.createComponent(CurrencySwitch);
    fixture.componentRef.setInput('value', value);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const toggles = () => Array.from(element.querySelectorAll('mat-button-toggle'));
    const checked = () =>
      toggles()
        .filter((t) => t.classList.contains('mat-button-toggle-checked'))
        .map((t) => t.textContent?.trim());
    return { fixture, element, toggles, checked };
  }

  it('offers CAD, USD and EUR with the current one checked', async () => {
    const { element, toggles, checked } = await render('USD');

    expect(toggles().map((t) => t.textContent?.trim())).toEqual(['CAD', 'USD', 'EUR']);
    expect(checked()).toEqual(['USD']);
    expect(element.querySelector('mat-button-toggle-group')?.getAttribute('aria-label')).toBe('Show totals in');
  });

  it('moves the check when the value input changes', async () => {
    const { fixture, checked } = await render('CAD');

    fixture.componentRef.setInput('value', 'EUR');
    await fixture.whenStable();

    expect(checked()).toEqual(['EUR']);
  });

  it('emits the currency that was clicked', async () => {
    const { fixture, toggles } = await render('CAD');
    const emitted: string[] = [];
    fixture.componentInstance.valueChange.subscribe((value) => emitted.push(value));

    (toggles()[2].querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(emitted).toEqual(['EUR']);
  });
});
