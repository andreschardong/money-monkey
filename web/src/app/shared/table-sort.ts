import { Directive, computed, input, signal } from '@angular/core';

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  key: string;
  direction: SortDirection;
}

export type SortValue = string | number | null | undefined;
export type SortAccessors<T> = Record<string, (row: T) => SortValue>;

/** Which column a table is sorted by, which way, and the rows in that order. */
export class TableSort {
  readonly state = signal<SortState | null>(null);

  constructor(initial: SortState | null = null) {
    this.state.set(initial);
  }

  /** Clicking a new column sorts by it in its natural direction; clicking the same column again flips it. */
  toggle(key: string, defaultDirection: SortDirection = 'asc'): void {
    const current = this.state();
    this.state.set(current?.key === key
      ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      : { key, direction: defaultDirection });
  }

  apply<T>(rows: readonly T[], accessors: SortAccessors<T>): T[] {
    const state = this.state();
    const accessor = state ? accessors[state.key] : undefined;
    if (!state || !accessor) {
      return [...rows];
    }
    const sign = state.direction === 'asc' ? 1 : -1;
    // Missing values go last whichever way the column is sorted.
    return [...rows].sort((a, b) => {
      const va = accessor(a);
      const vb = accessor(b);
      const missingA = isMissing(va);
      const missingB = isMissing(vb);
      if (missingA || missingB) {
        return missingA && missingB ? 0 : missingA ? 1 : -1;
      }
      return sign * compare(va!, vb!);
    });
  }
}

function isMissing(value: SortValue): boolean {
  return value === null || value === undefined || (typeof value === 'number' && Number.isNaN(value));
}

function compare(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  return String(a).localeCompare(String(b), 'en-CA', { numeric: true, sensitivity: 'base' });
}

/**
 * Makes a header cell sort its column: `<th appSort="price" [sort]="sort" defaultDirection="desc">`.
 * Works with the mouse and the keyboard, and tells screen readers the current order.
 */
@Directive({
  selector: 'th[appSort]',
  host: {
    class: 'sortable',
    tabindex: '0',
    '[class.sorted]': 'active()',
    '[class.desc]': 'active() && direction() === "desc"',
    '[attr.aria-sort]': 'ariaSort()',
    '(click)': 'toggle()',
    '(keydown.enter)': 'toggle()',
    '(keydown.space)': 'onSpace($event)',
  },
})
export class SortHeader {
  readonly appSort = input.required<string>();
  readonly sort = input.required<TableSort>();
  readonly defaultDirection = input<SortDirection>('asc');

  readonly active = computed(() => this.sort().state()?.key === this.appSort());
  readonly direction = computed(() => this.sort().state()?.direction ?? null);
  readonly ariaSort = computed(() => (this.active() ? (this.direction() === 'asc' ? 'ascending' : 'descending') : 'none'));

  toggle(): void {
    this.sort().toggle(this.appSort(), this.defaultDirection());
  }

  onSpace(event: Event): void {
    event.preventDefault();
    this.toggle();
  }
}
