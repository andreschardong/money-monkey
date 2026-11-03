import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { SortDirection, SortHeader, TableSort } from './table-sort';

interface Row {
  name: string | null | undefined;
  value: number | null | undefined;
}

const accessors = {
  name: (row: Row) => row.name,
  value: (row: Row) => row.value,
};

describe('TableSort', () => {
  describe('toggle', () => {
    it('starts unsorted', () => {
      expect(new TableSort().state()).toBeNull();
    });

    it('can start sorted', () => {
      expect(new TableSort({ key: 'value', direction: 'desc' }).state()).toEqual({ key: 'value', direction: 'desc' });
    });

    it('sorts a new column in its natural direction', () => {
      const sort = new TableSort();
      sort.toggle('name');
      expect(sort.state()).toEqual({ key: 'name', direction: 'asc' });
      sort.toggle('value', 'desc');
      expect(sort.state()).toEqual({ key: 'value', direction: 'desc' });
    });

    it('flips the direction when the same column is chosen again, whatever its natural direction', () => {
      const sort = new TableSort();
      sort.toggle('value', 'desc');
      sort.toggle('value', 'desc');
      expect(sort.state()).toEqual({ key: 'value', direction: 'asc' });
      sort.toggle('value', 'desc');
      expect(sort.state()).toEqual({ key: 'value', direction: 'desc' });
    });

    it('goes back to the natural direction after another column in between', () => {
      const sort = new TableSort({ key: 'name', direction: 'desc' });
      sort.toggle('value');
      sort.toggle('name');
      expect(sort.state()).toEqual({ key: 'name', direction: 'asc' });
    });
  });

  describe('apply', () => {
    const rows: Row[] = [
      { name: 'b', value: 2 },
      { name: 'a', value: 10 },
      { name: 'c', value: -1 },
    ];

    it('keeps the order given when nothing is sorted, in a copy', () => {
      const result = new TableSort().apply(rows, accessors);
      expect(result).toEqual(rows);
      expect(result).not.toBe(rows);
    });

    it('keeps the order given when the column has no accessor', () => {
      const result = new TableSort({ key: 'missing', direction: 'asc' }).apply(rows, accessors);
      expect(result).toEqual(rows);
    });

    it.each<[SortDirection, number[]]>([
      ['asc', [-1, 2, 10]],
      ['desc', [10, 2, -1]],
    ])('sorts numbers %s by value, not as text', (direction, expected) => {
      const result = new TableSort({ key: 'value', direction }).apply(rows, accessors);
      expect(result.map((row) => row.value)).toEqual(expected);
    });

    it('sorts text with numbers inside in natural order, ignoring case', () => {
      const names: Row[] = ['item10', 'Item2', 'item1'].map((name) => ({ name, value: 0 }));
      const result = new TableSort({ key: 'name', direction: 'asc' }).apply(names, accessors);
      expect(result.map((row) => row.name)).toEqual(['item1', 'Item2', 'item10']);
    });

    it('does not change the rows it was given', () => {
      const copy = rows.map((row) => ({ ...row }));
      new TableSort({ key: 'value', direction: 'asc' }).apply(rows, accessors);
      expect(rows).toEqual(copy);
    });

    it.each<SortDirection>(['asc', 'desc'])('puts missing values last when sorting %s', (direction) => {
      const withGaps: Row[] = [
        { name: 'none', value: null },
        { name: 'two', value: 2 },
        { name: 'nan', value: Number.NaN },
        { name: 'five', value: 5 },
        { name: 'undef', value: undefined },
      ];
      const result = new TableSort({ key: 'value', direction }).apply(withGaps, accessors);
      const present = result.slice(0, 2).map((row) => row.name);
      expect(present).toEqual(direction === 'asc' ? ['two', 'five'] : ['five', 'two']);
      expect(result.slice(2).map((row) => row.name)).toEqual(['none', 'nan', 'undef']);
    });

    it('keeps rows with the same value in their given order', () => {
      const ties: Row[] = [
        { name: 'x', value: 1 },
        { name: 'y', value: 1 },
        { name: 'z', value: 1 },
      ];
      const result = new TableSort({ key: 'value', direction: 'desc' }).apply(ties, accessors);
      expect(result.map((row) => row.name)).toEqual(['x', 'y', 'z']);
    });

    it('compares text with numbers as text, so mixed columns do not throw', () => {
      const mixed = [{ v: 'b' }, { v: 10 }, { v: 'a' }, { v: 9 }];
      const result = new TableSort({ key: 'v', direction: 'asc' }).apply(mixed, { v: (row) => row.v });
      expect(result.map((row) => row.v)).toEqual([9, 10, 'a', 'b']);
    });

    it('sorts an empty list', () => {
      expect(new TableSort({ key: 'value', direction: 'asc' }).apply([], accessors)).toEqual([]);
    });
  });
});

@Component({
  imports: [SortHeader],
  template: `
    <table>
      <thead>
        <tr>
          <th appSort="name" [sort]="sort">Name</th>
          <th id="value" appSort="value" [sort]="sort" [defaultDirection]="valueDirection">Value</th>
          <th id="plain">Plain</th>
        </tr>
      </thead>
    </table>
  `,
})
class Host {
  sort = new TableSort();
  valueDirection: SortDirection = 'desc';
}

describe('SortHeader', () => {
  let fixture: ComponentFixture<Host>;
  const header = (name: string) =>
    Array.from(fixture.nativeElement.querySelectorAll('th')).find(
      (th) => (th as HTMLElement).textContent === name,
    ) as HTMLElement;
  const key = (target: HTMLElement, init: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  };

  beforeEach(() => {
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  it('makes the header focusable and marks it sortable', () => {
    const name = header('Name');
    expect(name.getAttribute('tabindex')).toBe('0');
    expect(name.classList).toContain('sortable');
  });

  it('does not touch a header without the directive', () => {
    expect(header('Plain').hasAttribute('tabindex')).toBe(false);
  });

  it('says "none" for a column that is not the sorted one', () => {
    expect(header('Name').getAttribute('aria-sort')).toBe('none');
    expect(header('Name').classList).not.toContain('sorted');
  });

  it('sorts ascending on click and tells assistive technology', () => {
    header('Name').click();
    fixture.detectChanges();
    expect(fixture.componentInstance.sort.state()).toEqual({ key: 'name', direction: 'asc' });
    expect(header('Name').getAttribute('aria-sort')).toBe('ascending');
    expect(header('Name').classList).toContain('sorted');
    expect(header('Name').classList).not.toContain('desc');
  });

  it('flips to descending on a second click and marks it', () => {
    header('Name').click();
    header('Name').click();
    fixture.detectChanges();
    expect(header('Name').getAttribute('aria-sort')).toBe('descending');
    expect(header('Name').classList).toContain('desc');
  });

  it('starts in the default direction given for the column', () => {
    header('Value').click();
    fixture.detectChanges();
    expect(header('Value').getAttribute('aria-sort')).toBe('descending');
    expect(header('Value').classList).toContain('desc');
  });

  it('moves the sort marker when another column is chosen', () => {
    header('Name').click();
    header('Value').click();
    fixture.detectChanges();
    expect(header('Name').getAttribute('aria-sort')).toBe('none');
    expect(header('Name').classList).not.toContain('sorted');
    expect(header('Value').classList).toContain('sorted');
  });

  it('sorts with the Enter key', () => {
    key(header('Name'), { key: 'Enter' });
    expect(header('Name').getAttribute('aria-sort')).toBe('ascending');
    key(header('Name'), { key: 'Enter' });
    expect(header('Name').getAttribute('aria-sort')).toBe('descending');
  });

  it('sorts with the Space key without scrolling the page', () => {
    const event = key(header('Name'), { key: ' ' });
    expect(event.defaultPrevented).toBe(true);
    expect(header('Name').getAttribute('aria-sort')).toBe('ascending');
  });

  it('ignores other keys', () => {
    const event = key(header('Name'), { key: 'a' });
    expect(event.defaultPrevented).toBe(false);
    expect(header('Name').getAttribute('aria-sort')).toBe('none');
  });

  it('exposes its column state for other code to read', () => {
    const directive = fixture.debugElement.query(By.directive(SortHeader)).injector.get(SortHeader);
    expect(directive.active()).toBe(false);
    expect(directive.direction()).toBeNull();
    header('Name').click();
    expect(directive.active()).toBe(true);
    expect(directive.direction()).toBe('asc');
  });

  it('follows a sort changed from outside, such as a reset', () => {
    fixture.componentInstance.sort.state.set({ key: 'value', direction: 'asc' });
    fixture.detectChanges();
    expect(header('Value').getAttribute('aria-sort')).toBe('ascending');
    fixture.componentInstance.sort.state.set(null);
    fixture.detectChanges();
    expect(header('Value').getAttribute('aria-sort')).toBe('none');
  });
});
