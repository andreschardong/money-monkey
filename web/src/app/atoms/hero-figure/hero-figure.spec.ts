import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HeroFigure } from './hero-figure';

describe('HeroFigure', () => {
  let fixture: ComponentFixture<HeroFigure>;
  const host = () => fixture.nativeElement as HTMLElement;
  const figure = () => host().querySelector('.figure') as HTMLElement;
  const shown = () => Array.from(figure().querySelectorAll('span')).map((span) => span.textContent);

  const render = (value: number, currency: string) => {
    fixture.componentRef.setInput('value', value);
    fixture.componentRef.setInput('currency', currency);
    fixture.detectChanges();
  };

  beforeEach(() => {
    fixture = TestBed.createComponent(HeroFigure);
  });

  it('sets the dollars wide and the cents small', () => {
    render(56_104.17, 'CAD');
    expect(shown()).toEqual(['$56,104', '.17']);
  });

  it('reads the whole amount to assistive technology and hides the split pieces', () => {
    render(56_104.17, 'CAD');
    expect(figure().getAttribute('aria-label')).toBe('$56,104.17');
    for (const span of Array.from(figure().querySelectorAll('span'))) {
      expect(span.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('keeps the currency marker with the dollars', () => {
    render(1_234.5, 'USD');
    expect(shown()).toEqual(['US$1,234', '.50']);
  });

  it('splits zero and small amounts', () => {
    render(0, 'CAD');
    expect(shown()).toEqual(['$0', '.00']);
  });

  it('keeps the minus sign with a negative amount', () => {
    render(-12.3, 'EUR');
    expect(shown()).toEqual(['−€12', '.30']);
  });

  it('shows amounts in the millions whole, with no cents to shrink', () => {
    render(2_500_000.75, 'CAD');
    expect(shown()).toEqual(['$2,500,001', '']);
    expect(figure().getAttribute('aria-label')).toBe('$2,500,001');
  });

  it('follows the inputs when they change', () => {
    render(1, 'CAD');
    render(2.5, 'CAD');
    expect(shown()).toEqual(['$2', '.50']);
  });
});
