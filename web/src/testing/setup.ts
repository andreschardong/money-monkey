// Global jsdom polyfills and clean-up, registered through `setupFiles` in angular.json.
// jsdom has no ResizeObserver, IntersectionObserver or object URLs; matchMedia exists only as a stub we replace.

import { TestBed } from '@angular/core/testing';

// The first spec to compile a Material dialog can take longer than vitest's 5 s default on a busy machine or a cold
// CI runner; a generous limit removes that flake without hiding a test that really hangs.
vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 });

class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): unknown[] {
    return [];
  }
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = NoopObserver as unknown as typeof ResizeObserver;
}
if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = NoopObserver as unknown as typeof IntersectionObserver;
}

if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = () => 'blob:folio-test';
}
if (typeof URL.revokeObjectURL !== 'function') {
  URL.revokeObjectURL = () => undefined;
}

if (typeof globalThis.matchMedia !== 'function') {
  // Light scheme, no reduced motion, browser tab (not standalone). Specs that care use `stubMatchMedia`.
  globalThis.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof matchMedia;
}

if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => undefined;
}

// A spec that fails halfway (an unflushed request, an open dialog) must not poison the specs after it in the
// same worker, so the module is reset here as well as by Angular's own teardown.
afterEach(() => {
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
  try {
    localStorage.clear();
  } catch {
    // Storage is unavailable in this environment; nothing to clear.
  }
  document.documentElement.removeAttribute('data-theme');
  vi.unstubAllGlobals();
});
