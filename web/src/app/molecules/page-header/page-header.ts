import { Component, input } from '@angular/core';

/**
 * The top of a page: a title with an optional lede on the left and the page's buttons on the right, wrapping
 * under each other on a phone. Content marked `lede` becomes the lede paragraph, content marked `actions` goes in
 * the button row, and anything else follows the title inside the identity block, for pages whose title carries
 * more than text (a portfolio's currency chips, a holding's ticker).
 */
@Component({
  // An attribute selector keeps the native header element (and its landmark role) instead of wrapping it.
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'header[appPageHeader]',
  template: `
    <div class="identity">
      @if (heading(); as text) {
        <h1>{{ text }}</h1>
      }
      <p class="lede"><ng-content select="[lede]" /></p>
      <ng-content />
    </div>
    <div class="actions"><ng-content select="[actions]" /></div>
  `,
  host: { class: 'header' },
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px 24px;
    }
    .lede {
      max-width: 64ch;
      margin-top: 6px;
      color: var(--ink-2);
    }
    .lede:empty,
    .actions:empty {
      display: none;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
    }
  `,
})
export class PageHeader {
  readonly heading = input<string>();
}
