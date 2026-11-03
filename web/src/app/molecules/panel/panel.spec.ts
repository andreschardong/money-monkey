import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Panel } from './panel';

@Component({
  imports: [Panel],
  template: `
    <section appPanel [heading]="heading()" [level]="level()" [link]="link()" linkLabel="All assets">
      <p class="body">Inside</p>
    </section>
  `,
})
class Host {
  readonly heading = signal<string | undefined>('Portfolios');
  readonly level = signal<2 | 3>(2);
  readonly link = signal<string | undefined>(undefined);
}

describe('Panel', () => {
  async function render() {
    TestBed.configureTestingModule({ imports: [Host], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const section = (fixture.nativeElement as HTMLElement).querySelector('section') as HTMLElement;
    return { fixture, host: fixture.componentInstance, section };
  }

  it('shows the heading as an h2 above the content', async () => {
    const { section } = await render();

    expect(section.classList).toContain('panel');
    expect(section.querySelector(':scope > h2')?.textContent).toBe('Portfolios');
    expect(section.querySelector('h3')).toBeNull();
    expect(section.querySelector('a.link')).toBeNull();
    expect(section.querySelector('.body')?.textContent).toBe('Inside');
  });

  it('shows an h3 for a nested group', async () => {
    const { fixture, host, section } = await render();

    host.level.set(3);
    await fixture.whenStable();

    expect(section.querySelector('h3')?.textContent).toBe('Portfolios');
    expect(section.querySelector('h2')).toBeNull();
  });

  it('shows the link beside the heading', async () => {
    const { fixture, host, section } = await render();

    host.link.set('/assets');
    await fixture.whenStable();

    const link = section.querySelector('.head a.link');
    expect(link?.textContent).toBe('All assets');
    expect(link?.getAttribute('href')).toBe('/assets');
    expect(section.querySelector('.head > h2')?.textContent).toBe('Portfolios');
  });

  it('shows only the content when there is no heading', async () => {
    const { fixture, host, section } = await render();

    host.heading.set(undefined);
    host.link.set('/assets');
    await fixture.whenStable();

    expect(section.querySelector('.head')).toBeNull();
    expect(section.querySelector('.body')).not.toBeNull();
  });
});
