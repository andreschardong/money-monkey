import { DOCUMENT, Injectable, computed, effect, inject, signal } from '@angular/core';

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'folio.theme';

/** Light, dark or follow the system. The choice is remembered in this browser only. */
@Injectable({ providedIn: 'root' })
export class Theme {
  private readonly document = inject(DOCUMENT);
  private readonly media = this.document.defaultView?.matchMedia('(prefers-color-scheme: dark)');
  private readonly systemDark = signal(this.media?.matches ?? false);

  readonly preference = signal<ThemePreference>(readPreference());
  readonly isDark = computed(() => this.preference() === 'dark' || (this.preference() === 'system' && this.systemDark()));

  constructor() {
    this.media?.addEventListener('change', event => this.systemDark.set(event.matches));
    effect(() => {
      this.document.documentElement.dataset['theme'] = this.isDark() ? 'dark' : 'light';
    });
  }

  /** Cycles system, light, dark. */
  cycle(): void {
    const next: Record<ThemePreference, ThemePreference> = { system: 'light', light: 'dark', dark: 'system' };
    this.set(next[this.preference()]);
  }

  set(preference: ThemePreference): void {
    this.preference.set(preference);
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // Private windows may refuse storage; the choice then lasts for this visit only.
    }
  }
}

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}
