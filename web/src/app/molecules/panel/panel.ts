import { NgTemplateOutlet } from '@angular/common';
import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * The white card every page is built from, with an optional heading (`h2`, or `h3` for a nested group) and an
 * optional link at the right of it. The content goes inside. Without a link the heading is a plain child of the
 * panel, so its margin collapses with the content below exactly as a bare heading would. Pages that need a
 * different rhythm set the custom properties on the host: `--panel-padding`, `--panel-padding-s` (phones) and
 * `--panel-heading-gap`.
 */
@Component({
  // An attribute selector keeps the native section element (and its landmark role) instead of wrapping it.
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'section[appPanel]',
  imports: [NgTemplateOutlet, RouterLink],
  template: `
    <ng-template #title>
      @if (level() === 3) {
        <h3>{{ heading() }}</h3>
      } @else {
        <h2>{{ heading() }}</h2>
      }
    </ng-template>
    @if (heading()) {
      @if (link(); as target) {
        <div class="head">
          <ng-container [ngTemplateOutlet]="title" />
          <a class="link" [routerLink]="target">{{ linkLabel() }}</a>
        </div>
      } @else {
        <ng-container [ngTemplateOutlet]="title" />
      }
    }
    <ng-content />
  `,
  host: { class: 'panel' },
  styles: `
    :host {
      display: block;
      padding: var(--panel-padding, 18px 22px);
      border: 1px solid var(--rule);
      border-radius: var(--radius-l);
      background: var(--card);
    }
    .head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 16px;
    }
    h2,
    h3 {
      margin-bottom: var(--panel-heading-gap, 8px);
    }
    .link {
      color: var(--harbour-ink);
      font-size: 0.875rem;
      text-decoration: none;

      &:hover {
        text-decoration: underline;
      }
    }
    @media (max-width: 640px) {
      :host {
        padding: var(--panel-padding-s, 14px);
      }
    }
  `,
})
export class Panel {
  readonly heading = input<string>();
  /** Heading level: 2 for a page section, 3 for a group inside one. */
  readonly level = input<2 | 3>(2);
  /** Router target of the link beside the heading; no link when unset. */
  readonly link = input<string | readonly unknown[]>();
  readonly linkLabel = input('');
}
