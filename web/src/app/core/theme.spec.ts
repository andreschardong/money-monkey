import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { stubMatchMedia } from '../../testing/browser-fakes';
import { Theme } from './theme';

const theme = () => document.documentElement.dataset['theme'];

describe('Theme', () => {
  it('follows a light system by default', () => {
    const service = TestBed.inject(Theme);
    TestBed.tick();
    expect(service.preference()).toBe('system');
    expect(service.isDark()).toBe(false);
    expect(theme()).toBe('light');
  });

  it('follows a dark system', () => {
    stubMatchMedia({ '(prefers-color-scheme: dark)': true });
    const service = TestBed.inject(Theme);
    TestBed.tick();
    expect(service.isDark()).toBe(true);
    expect(theme()).toBe('dark');
  });

  it('follows the system when it changes while the page is open', () => {
    const media = stubMatchMedia({});
    const service = TestBed.inject(Theme);
    TestBed.tick();
    media.change(true);
    TestBed.tick();
    expect(service.isDark()).toBe(true);
    expect(theme()).toBe('dark');
    media.change(false);
    TestBed.tick();
    expect(theme()).toBe('light');
  });

  it.each([
    ['light', 'light'],
    ['dark', 'dark'],
  ])('restores a saved "%s" choice', (stored, expected) => {
    localStorage.setItem('folio.theme', stored);
    const service = TestBed.inject(Theme);
    TestBed.tick();
    expect(service.preference()).toBe(expected);
    expect(theme()).toBe(expected);
  });

  it('ignores a saved value it does not know', () => {
    localStorage.setItem('folio.theme', 'sepia');
    expect(TestBed.inject(Theme).preference()).toBe('system');
  });

  it('uses the system setting when storage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(TestBed.inject(Theme).preference()).toBe('system');
  });

  it('an explicit choice beats the system setting, and is remembered', () => {
    stubMatchMedia({ '(prefers-color-scheme: dark)': true });
    const service = TestBed.inject(Theme);
    service.set('light');
    TestBed.tick();
    expect(service.isDark()).toBe(false);
    expect(theme()).toBe('light');
    expect(localStorage.getItem('folio.theme')).toBe('light');
  });

  it('cycles system, light, dark and back to system', () => {
    const service = TestBed.inject(Theme);
    const seen = [service.preference()];
    for (let i = 0; i < 3; i++) {
      service.cycle();
      seen.push(service.preference());
    }
    expect(seen).toEqual(['system', 'light', 'dark', 'system']);
  });

  it('still changes for this visit when storage refuses the write', () => {
    const service = TestBed.inject(Theme);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    service.set('dark');
    TestBed.tick();
    expect(service.preference()).toBe('dark');
    expect(theme()).toBe('dark');
  });

  it('works in a document without a window', () => {
    const doc = {
      defaultView: null,
      documentElement: { dataset: {} as Record<string, string> },
    } as unknown as Document;
    TestBed.configureTestingModule({ providers: [{ provide: DOCUMENT, useValue: doc }] });
    const service = TestBed.inject(Theme);
    TestBed.tick();
    expect(service.isDark()).toBe(false);
    expect(doc.documentElement.dataset['theme']).toBe('light');
  });
});
