import { Component, booleanAttribute, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';

/**
 * A line of caution or advice with an icon: a warning from the server, or a suggestion (a dividend or split to
 * record) that brings its own buttons through the `actions` slot. The default is a single warning line; `wrap`
 * lets the message drop under the icon on a phone and makes room for the buttons. `live` makes the host a status
 * region, for a notice that appears on its own rather than being part of a list the page announces.
 */
@Component({
  selector: 'app-notice',
  imports: [MatIcon],
  template: `
    <mat-icon [svgIcon]="icon()" aria-hidden="true" />
    <p class="message"><ng-content /></p>
    <ng-content select="[actions]" />
  `,
  host: {
    class: 'notice',
    '[class.suggestion]': "tone() === 'suggestion'",
    '[class.warning]': "tone() === 'warning'",
    '[class.wrap]': 'wrap()',
    '[attr.role]': "live() ? 'status' : null",
  },
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      border-radius: var(--radius-m);
      background: var(--warn-wash);
      color: var(--warn-ink);
      font-size: 0.875rem;
    }
    :host(.wrap) {
      flex-wrap: wrap;
      gap: 8px 12px;
      padding: 10px 12px 10px 14px;
    }
    :host(.suggestion) {
      border: 1px solid color-mix(in srgb, var(--brass) 45%, transparent);
      background: var(--brass-wash);
      color: var(--ink);
    }
    mat-icon {
      flex: none;
      width: 20px;
      height: 20px;
    }
    :host(.suggestion) mat-icon {
      color: var(--brass-ink);
    }
    :host(.wrap) .message {
      flex: 1 1 320px;
    }
  `,
})
export class Notice {
  readonly tone = input<'warning' | 'suggestion'>('warning');
  /** Name of a registered icon. */
  readonly icon = input('warning');
  readonly wrap = input(false, { transform: booleanAttribute });
  readonly live = input(false, { transform: booleanAttribute });
}
