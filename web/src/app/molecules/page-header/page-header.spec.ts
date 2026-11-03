import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PageHeader } from './page-header';

@Component({
  imports: [PageHeader],
  template: `
    <header appPageHeader [heading]="heading()">
      @if (withLede()) {
        <span lede>Signed in as <strong>me&#64;example.com</strong></span>
      }
      <p class="extra">More about the page</p>
      @if (withActions()) {
        <button actions type="button">Sign out</button>
      }
    </header>
  `,
})
class Host {
  readonly heading = signal<string | undefined>('Account');
  readonly withLede = signal(true);
  readonly withActions = signal(true);
}

describe('PageHeader', () => {
  async function render() {
    TestBed.configureTestingModule({ imports: [Host] });
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const header = (fixture.nativeElement as HTMLElement).querySelector('header') as HTMLElement;
    return { fixture, host: fixture.componentInstance, header };
  }

  it('shows the title, the lede, the extra content and the actions', async () => {
    const { header } = await render();

    expect(header.classList).toContain('header');
    expect(header.querySelector('.identity h1')?.textContent).toBe('Account');
    expect(header.querySelector('.identity p.lede')?.textContent).toBe('Signed in as me@example.com');
    expect(header.querySelector('.identity .extra')?.textContent).toBe('More about the page');
    expect(header.querySelector('.actions button')?.textContent).toBe('Sign out');
  });

  it('leaves the slots empty when there is no heading, lede or actions', async () => {
    const { fixture, host, header } = await render();

    host.heading.set(undefined);
    host.withLede.set(false);
    host.withActions.set(false);
    await fixture.whenStable();

    expect(header.querySelector('h1')).toBeNull();
    expect(header.querySelector('.lede')?.textContent).toBe('');
    expect(header.querySelector('.actions')?.children.length).toBe(0);
  });
});
