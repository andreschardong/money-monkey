import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * The signed-out card: the Money Monkey wordmark (a link to the start page), the page's title and whatever the
 * page puts inside. Shared by the sign-in page and the page an emailed link lands on.
 */
@Component({
  selector: 'app-auth-card',
  imports: [RouterLink],
  template: `
    <div class="card">
      <a class="brand" routerLink="/">Money Monkey</a>
      @if (heading(); as text) {
        <h1>{{ text }}</h1>
      }
      <ng-content />
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .card {
      display: grid;
      gap: 16px;
      width: min(420px, 100%);
      margin: 0 auto;
      padding: 32px 28px 28px;
      border: 1px solid var(--rule);
      border-radius: var(--radius-l);
      background: var(--card);
      box-shadow: var(--shadow);
    }
    .brand {
      color: var(--ink);
      font-size: 1.5rem;
      font-stretch: 125%;
      font-weight: 750;
      letter-spacing: -0.02em;
      text-decoration: none;
    }
    h1 {
      margin-top: 4px;
      font-size: 1.5rem;
    }
  `,
})
export class AuthCard {
  readonly heading = input<string>();
}
