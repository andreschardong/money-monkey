import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Change } from './change';

describe('Change', () => {
  let fixture: ComponentFixture<Change>;
  const host = () => fixture.nativeElement as HTMLElement;
  const wrapper = () => host().querySelector('.change') as HTMLElement;
  const spoken = () => wrapper().getAttribute('aria-label');
  const arrow = () => host().querySelector('mat-icon svg')?.getAttribute('data-icon') ?? null;
  const texts = () => Array.from(wrapper().querySelectorAll(':scope > span')).map((span) => span.textContent);

  const render = (inputs: Record<string, unknown>) => {
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
  };

  beforeEach(() => {
    fixture = TestBed.createComponent(Change);
  });

  describe('a money amount', () => {
    it('shows a gain with an up arrow, a plus sign and the gain colour class', () => {
      render({ amount: 12.5 });
      expect(texts()).toEqual(['+$12.50']);
      expect(arrow()).toBe('arrow_upward');
      expect(wrapper().classList).toContain('gain');
      expect(spoken()).toBe('up $12.50');
    });

    it('shows a loss with a down arrow, a minus sign and the loss colour class', () => {
      render({ amount: -12.5 });
      expect(texts()).toEqual(['−$12.50']);
      expect(arrow()).toBe('arrow_downward');
      expect(wrapper().classList).toContain('loss');
      expect(spoken()).toBe('down $12.50');
    });

    it.each([0, 0.004, -0.004])('treats %s as unchanged: no arrow, no colour', (amount) => {
      render({ amount });
      expect(arrow()).toBeNull();
      expect(wrapper().classList).not.toContain('gain');
      expect(wrapper().classList).not.toContain('loss');
      expect(spoken()).toMatch(/^unchanged /);
    });

    it('formats in the currency given', () => {
      render({ amount: 5, currency: 'USD' });
      expect(texts()).toEqual(['+US$5.00']);
      expect(spoken()).toBe('up US$5.00');
    });

    it('can hide the arrow and still say the direction in words and sign', () => {
      render({ amount: 5, showArrow: false });
      expect(arrow()).toBeNull();
      expect(texts()).toEqual(['+$5.00']);
      expect(spoken()).toBe('up $5.00');
    });
  });

  describe('a percentage', () => {
    it('shows a gain on its own', () => {
      render({ percent: 0.0412 });
      expect(texts()).toEqual(['+4.12%']);
      expect(arrow()).toBe('arrow_upward');
      expect(wrapper().querySelector('.paren')).toBeNull();
      expect(spoken()).toBe('up 4.12%');
    });

    it('shows a loss on its own', () => {
      render({ percent: -0.0052 });
      expect(texts()).toEqual(['−0.52%']);
      expect(arrow()).toBe('arrow_downward');
      expect(spoken()).toBe('down 0.52%');
    });

    it('counts changes under 0.005 % as unchanged', () => {
      render({ percent: 0.00004 });
      expect(arrow()).toBeNull();
      expect(spoken()).toMatch(/^unchanged /);
    });

    it('is unchanged when exactly zero', () => {
      render({ percent: 0 });
      expect(arrow()).toBeNull();
      expect(texts()).toEqual(['0.00%']);
    });
  });

  describe('amount and percentage together', () => {
    it('shows both, with the percentage set as a parenthetical, and speaks both', () => {
      render({ amount: -20, percent: -0.02 });
      expect(texts()).toEqual(['−$20.00', '−2.00%']);
      expect(wrapper().querySelector('.paren')?.textContent).toBe('−2.00%');
      expect(spoken()).toBe('down $20.00 2.00%');
    });

    it('takes the direction from the amount when the two disagree', () => {
      render({ amount: 10, percent: -0.0001 });
      expect(wrapper().classList).toContain('gain');
    });

    it('a zero amount with a percentage is still unchanged, because the amount decides', () => {
      render({ amount: 0, percent: 0.5 });
      expect(arrow()).toBeNull();
    });
  });

  describe('nothing to show', () => {
    it.each([
      ['null', null, null],
      ['undefined', undefined, undefined],
    ])('draws no figures and speaks "unchanged" when both are %s', (_name, amount, percent) => {
      render({ amount, percent });
      expect(texts()).toEqual([]);
      expect(arrow()).toBeNull();
      expect(spoken()).toBe('unchanged');
    });

    it('draws only the percentage when the amount is missing', () => {
      render({ amount: null, percent: 0.1 });
      expect(texts()).toEqual(['+10.00%']);
    });

    it('draws only the amount when the percentage is missing', () => {
      render({ amount: 3, percent: undefined });
      expect(texts()).toEqual(['+$3.00']);
    });
  });
});
