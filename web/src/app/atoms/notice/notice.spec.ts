import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { registerIcons } from '../../core/icons';
import { Notice } from './notice';

@Component({
  imports: [Notice],
  template: `
    <app-notice [tone]="tone()" [icon]="icon()" [wrap]="wrap()" [live]="live()">
      Prices are late.
      <button actions type="button">Dismiss</button>
    </app-notice>
  `,
})
class Host {
  readonly tone = signal<'warning' | 'suggestion'>('warning');
  readonly icon = signal('warning');
  readonly wrap = signal(false);
  readonly live = signal(false);
}

describe('Notice', () => {
  async function render() {
    TestBed.configureTestingModule({ imports: [Host] });
    TestBed.runInInjectionContext(registerIcons);
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    return { fixture, host: fixture.componentInstance, notice: element.querySelector('app-notice') as HTMLElement };
  }

  it('shows a warning line that is not a live region by default', async () => {
    const { notice } = await render();

    expect(notice.classList).toContain('notice');
    expect(notice.classList).toContain('warning');
    expect(notice.classList).not.toContain('suggestion');
    expect(notice.classList).not.toContain('wrap');
    expect(notice.hasAttribute('role')).toBe(false);
    expect(notice.querySelector('mat-icon')?.getAttribute('data-mat-icon-name')).toBe('warning');
    expect(notice.querySelector('p.message')?.textContent).toContain('Prices are late.');
  });

  it('becomes a status region when live', async () => {
    const { fixture, host, notice } = await render();

    host.live.set(true);
    await fixture.whenStable();

    expect(notice.getAttribute('role')).toBe('status');
  });

  it('changes tone, icon and layout for a wrapping suggestion', async () => {
    const { fixture, host, notice } = await render();

    host.tone.set('suggestion');
    host.icon.set('payments');
    host.wrap.set(true);
    await fixture.whenStable();

    expect(notice.classList).toContain('suggestion');
    expect(notice.classList).not.toContain('warning');
    expect(notice.classList).toContain('wrap');
    expect(notice.querySelector('mat-icon')?.getAttribute('data-mat-icon-name')).toBe('payments');
  });

  it('places projected actions after the message', async () => {
    const { notice } = await render();

    const children = Array.from(notice.children).map((child) => child.tagName.toLowerCase());

    expect(children).toEqual(['mat-icon', 'p', 'button']);
    expect(notice.querySelector('button')?.textContent).toBe('Dismiss');
  });
});
