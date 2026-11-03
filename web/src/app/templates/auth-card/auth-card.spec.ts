import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthCard } from './auth-card';

@Component({
  imports: [AuthCard],
  template: `
    <app-auth-card [heading]="heading()">
      <p class="body">Continue on this device.</p>
    </app-auth-card>
  `,
})
class Host {
  readonly heading = signal<string | undefined>('Sign in');
}

describe('AuthCard', () => {
  async function render() {
    TestBed.configureTestingModule({ imports: [Host], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const card = (fixture.nativeElement as HTMLElement).querySelector('app-auth-card') as HTMLElement;
    return { fixture, host: fixture.componentInstance, card };
  }

  it('shows the wordmark link, the title and the content', async () => {
    const { card } = await render();

    const brand = card.querySelector('a.brand');
    expect(brand?.textContent).toBe('Money Monkey');
    expect(brand?.getAttribute('href')).toBe('/');
    expect(card.querySelector('h1')?.textContent).toBe('Sign in');
    expect(card.querySelector('.card > .body')?.textContent).toBe('Continue on this device.');
  });

  it('omits the title when there is no heading', async () => {
    const { fixture, host, card } = await render();

    host.heading.set(undefined);
    await fixture.whenStable();

    expect(card.querySelector('h1')).toBeNull();
  });
});
