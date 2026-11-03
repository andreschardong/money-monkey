import { Component, booleanAttribute, input } from '@angular/core';
import { MatProgressSpinner } from '@angular/material/progress-spinner';

/**
 * A spinner with a word about what is loading, centred in the space it is given; `inline` makes it a small row
 * for a list or a dialog. The host is a live region, so the label is read out once.
 */
@Component({
  selector: 'app-busy',
  imports: [MatProgressSpinner],
  template: `
    <mat-spinner [diameter]="inline() ? 20 : 32" aria-hidden="true" />
    @if (label()) {
      <span class="label">{{ label() }}</span>
    }
  `,
  host: { role: 'status', 'aria-live': 'polite', '[class.inline]': 'inline()' },
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 14px;
      padding: 56px 16px;
      color: var(--ink-3);
      font-size: 0.9375rem;
      text-align: center;
    }
    :host(.inline) {
      flex-direction: row;
      justify-content: flex-start;
      gap: 10px;
      padding: 10px 0;
      font-size: 0.875rem;
      text-align: left;
    }
  `,
})
export class Busy {
  readonly label = input('');
  readonly inline = input(false, { transform: booleanAttribute });
}
