import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DARK, LIGHT } from '../../core/chart-theme';
import { formatMoney, formatPercent } from '../../core/format';
import { Allocation } from '../../core/models';
import { Theme } from '../../core/theme';
import { allocation } from '../../../testing';
import { AllocationBar } from './allocation-bar';

@Component({
  imports: [AllocationBar],
  template: `<app-allocation-bar [items]="items()" [currency]="'CAD'" [colourBy]="by()" />`,
})
class Host {
  readonly items = signal<Allocation[]>([]);
  readonly by = signal<'currency' | 'assetType' | 'country'>('currency');
}

/** jsdom rewrites hex colours as rgb(...); run the expected colour through the same rewrite. */
function normal(colour: string): string {
  const probe = document.createElement('i');
  probe.style.background = colour;
  return probe.style.background;
}

describe('AllocationBar', () => {
  async function render(items: Allocation[], by: 'currency' | 'assetType' | 'country' = 'currency') {
    TestBed.configureTestingModule({ imports: [Host] });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.items.set(items);
    fixture.componentInstance.by.set(by);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const segments = () => Array.from(el.querySelectorAll<HTMLElement>('.segment'));
    return { fixture, host: fixture.componentInstance, el, segments };
  }

  it('draws one segment per item, sized by weight, and describes the split for assistive technology', async () => {
    const { el, segments } = await render([
      allocation({ key: 'CAD', label: 'CAD', value: 7_000, weight: 0.7 }),
      allocation({ key: 'USD', label: 'USD', value: 3_000, weight: 0.3 }),
    ]);

    expect(segments().map((s) => s.style.flexGrow)).toEqual(['0.7', '0.3']);
    const bar = el.querySelector('.bar');
    expect(bar?.getAttribute('role')).toBe('img');
    expect(bar?.getAttribute('aria-label')).toBe(
      `CAD ${formatPercent(0.7, { signed: false, decimals: 1 })}, USD ${formatPercent(0.3, { signed: false, decimals: 1 })}`,
    );
  });

  it('lists each slice in the legend with its value and share', async () => {
    const { el } = await render([allocation({ key: 'CAD', label: 'Canadian dollars', value: 1_234.5, weight: 0.5 })]);

    const cells = Array.from(el.querySelectorAll('.legend tr td')).map((td) => td.textContent);
    expect(cells[0]).toBe('Canadian dollars');
    expect(cells[1]).toBe(formatMoney(1_234.5, 'CAD'));
    expect(cells[2]).toBe(formatPercent(0.5, { signed: false, decimals: 1 }));
  });

  it('shows an empty bar and an empty legend when there is nothing to split', async () => {
    const { el, segments } = await render([]);

    expect(segments()).toEqual([]);
    expect(el.querySelectorAll('.legend tr').length).toBe(0);
    expect(el.querySelector('.bar')?.getAttribute('aria-label')).toBe('');
  });

  it('gives each currency its own colour and grey for one without a slot', async () => {
    const { segments } = await render([
      allocation({ key: 'CAD' }),
      allocation({ key: 'USD' }),
      allocation({ key: 'JPY' as never }),
    ]);

    expect(segments().map((s) => s.style.background)).toEqual([
      normal(LIGHT.series[0]),
      normal(LIGHT.series[1]),
      normal(LIGHT.other),
    ]);
  });

  it('colours by asset type, with cash in the neutral ink and unknown types in grey', async () => {
    const { segments } = await render(
      [allocation({ key: 'Stock' }), allocation({ key: 'Cash' }), allocation({ key: 'Mystery' })],
      'assetType',
    );

    expect(segments().map((s) => s.style.background)).toEqual([
      normal(LIGHT.series[0]),
      normal(LIGHT.ink3),
      normal(LIGHT.other),
    ]);
  });

  it('colours countries in order and keeps "not set" grey without using up a colour', async () => {
    const { segments } = await render(
      [allocation({ key: 'CA' }), allocation({ key: '' }), allocation({ key: 'US' })],
      'country',
    );

    expect(segments().map((s) => s.style.background)).toEqual([
      normal(LIGHT.series[0]),
      normal(LIGHT.other),
      normal(LIGHT.series[1]),
    ]);
  });

  it('switches to the dark palette when the theme is dark', async () => {
    const { fixture, segments } = await render([allocation({ key: 'CAD' })]);

    TestBed.inject(Theme).set('dark');
    await fixture.whenStable();

    expect(segments()[0].style.background).toBe(normal(DARK.series[0]));
  });
});
