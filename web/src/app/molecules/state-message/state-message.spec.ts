import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { StateMessage } from './state-message';

@Component({
  imports: [StateMessage],
  template: `
    <app-state-message heading="The overview did not load" text="Check the server." [variant]="variant()">
      @if (withAction()) {
        <button type="button">Try again</button>
      }
    </app-state-message>
  `,
})
class Host {
  readonly variant = signal<'state' | 'welcome'>('state');
  readonly withAction = signal(true);
}

describe('StateMessage', () => {
  async function render() {
    TestBed.configureTestingModule({ imports: [Host] });
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const message = (fixture.nativeElement as HTMLElement).querySelector('app-state-message') as HTMLElement;
    return { fixture, host: fixture.componentInstance, message };
  }

  it('shows the heading, the text and the action', async () => {
    const { message } = await render();

    expect(message.querySelector('h1')?.textContent).toBe('The overview did not load');
    expect(message.querySelector('p')?.textContent).toBe('Check the server.');
    expect(message.querySelector('.action button')?.textContent).toBe('Try again');
    expect(message.classList).not.toContain('welcome');
  });

  it('marks the host for the larger welcome variant', async () => {
    const { fixture, host, message } = await render();

    host.variant.set('welcome');
    await fixture.whenStable();

    expect(message.classList).toContain('welcome');
  });

  it('leaves the action slot empty when there is no action', async () => {
    const { fixture, host, message } = await render();

    host.withAction.set(false);
    await fixture.whenStable();

    expect(message.querySelector('.action')?.children.length).toBe(0);
  });
});
