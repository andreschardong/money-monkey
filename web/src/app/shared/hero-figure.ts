import { Component, computed, input } from '@angular/core';
import { formatMoney } from '../core/format';
import { Currency } from '../core/models';

/**
 * The one big number on a page. The dollars are set wide; the cents step down so the eye lands on the
 * magnitude first. Proportional figures, because nothing aligns with it.
 */
@Component({
  selector: 'app-hero-figure',
  template: `
    <span class="figure" [attr.aria-label]="text()">
      <span aria-hidden="true">{{ whole() }}</span><span class="fraction" aria-hidden="true">{{ fraction() }}</span>
    </span>
  `,
  styles: `
    :host { display: inline-block; }
    .figure {
      font-size: var(--hero-size, clamp(2.5rem, 4.6vw, 3.5rem));
      font-stretch: 116%;
      font-weight: 620;
      letter-spacing: -0.025em;
      line-height: 1;
      white-space: nowrap;
    }
    .fraction {
      margin-left: 0.04em;
      color: var(--ink-3);
      font-size: 0.5em;
      font-weight: 550;
      letter-spacing: 0;
      vertical-align: 0.62em;
    }
  `,
})
export class HeroFigure {
  readonly value = input.required<number>();
  readonly currency = input.required<Currency>();

  protected readonly text = computed(() => formatMoney(this.value(), this.currency()));

  /** Splits "$56,104.17" into "$56,104" and ".17"; amounts without cents stay whole. */
  private readonly parts = computed(() => {
    const text = this.text();
    const match = /^(.*\d)(\.\d+)(\D*)$/.exec(text);
    return match ? { whole: match[1] + match[3], fraction: match[2] } : { whole: text, fraction: '' };
  });

  protected readonly whole = computed(() => this.parts().whole);
  protected readonly fraction = computed(() => this.parts().fraction);
}
