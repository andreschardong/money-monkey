import { SecurityContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { registerIcons } from './icons';

describe('registerIcons', () => {
  const register = () => {
    const registry = { addSvgIconLiteral: vi.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: MatIconRegistry, useValue: registry }] });
    TestBed.runInInjectionContext(registerIcons);
    return registry;
  };

  it('registers every icon the app draws, by its Material Symbols name', () => {
    const names = register().addSvgIconLiteral.mock.calls.map((call) => call[0]);
    expect(names).toEqual(
      expect.arrayContaining([
        'add',
        'dashboard',
        'arrow_upward',
        'arrow_downward',
        'light_mode',
        'dark_mode',
        'contrast',
        'fingerprint',
        'download',
      ]),
    );
    expect(new Set(names).size).toBe(names.length);
  });

  it('registers each icon as trusted inline SVG markup', () => {
    const calls = register().addSvgIconLiteral.mock.calls;
    const sanitizer = TestBed.inject(DomSanitizer);
    expect(calls.length).toBeGreaterThan(40);
    for (const [, literal] of calls) {
      expect(sanitizer.sanitize(SecurityContext.HTML, literal)).toContain('<svg');
    }
  });
});
