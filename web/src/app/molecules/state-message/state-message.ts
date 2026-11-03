import { Component, input } from '@angular/core';

/**
 * The centred block that stands in for a page: nothing here yet, the server could not be reached, or the thing
 * asked for is gone. A title, one sentence and, through the content, one action. `welcome` is the larger
 * first-use variant. Pages that need other spacing set `--state-padding` or `--state-max-width` on the host.
 */
@Component({
  selector: 'app-state-message',
  template: `
    <h1>{{ heading() }}</h1>
    <p>{{ text() }}</p>
    <div class="action"><ng-content /></div>
  `,
  host: { '[class.welcome]': "variant() === 'welcome'" },
  styles: `
    :host {
      display: grid;
      gap: 12px;
      max-width: var(--state-max-width, 520px);
      padding: var(--state-padding, 32px 0);
    }
    :host(.welcome) {
      gap: 16px;
      max-width: var(--state-max-width, 560px);
      padding: var(--state-padding, 48px 0);
    }
    :host(.welcome) h1 {
      font-size: 2rem;
      font-stretch: 112%;
    }
    p {
      color: var(--ink-2);
    }
    :host(.welcome) p {
      font-size: 1rem;
    }
    .action {
      display: flex;
      justify-self: start;
    }
    .action:empty {
      display: none;
    }
  `,
})
export class StateMessage {
  readonly heading = input.required<string>();
  readonly text = input.required<string>();
  readonly variant = input<'state' | 'welcome'>('state');
}
