import { Type } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogConfig, MatDialogRef } from '@angular/material/dialog';
import { Observable, Subject } from 'rxjs';

/** Stands in for the `MatDialogRef` a dialog component injects, and for the one `MatDialog.open` returns. */
export class FakeDialogRef<R = unknown> {
  private readonly closedSubject = new Subject<R | undefined>();
  readonly close = vi.fn((result?: R) => {
    this.closedSubject.next(result);
    this.closedSubject.complete();
  });
  readonly disableClose = false;
  readonly updateSize = vi.fn();
  /** Set by FakeDialog to the component given to `open`. */
  componentInstance: unknown = null;

  afterClosed(): Observable<R | undefined> {
    return this.closedSubject.asObservable();
  }

  /** The value the dialog closed with, or undefined while it is open or when it closed without one. */
  get lastResult(): R | undefined {
    return this.close.mock.lastCall?.[0];
  }
}

export interface OpenedDialog<R = unknown> {
  component: Type<unknown>;
  config: MatDialogConfig | undefined;
  /** `config.data`. */
  data: unknown;
  ref: FakeDialogRef<R>;
}

/**
 * A replacement for `MatDialog` that opens nothing. It records each `open` call so a spec can check which component
 * and data were used, then drive the outcome with `closeLast(result)`.
 *
 * ```ts
 * const dialog = new FakeDialog();
 * TestBed.configureTestingModule({ providers: [provideFakeDialog(dialog)] });
 * // ... click the button ...
 * expect(dialog.last.component).toBe(PortfolioDialog);
 * dialog.closeLast(summary);
 * ```
 */
export class FakeDialog {
  readonly opened: OpenedDialog[] = [];
  readonly open = vi.fn((component: Type<unknown>, config?: MatDialogConfig) => {
    const ref = new FakeDialogRef();
    this.opened.push({ component, config, data: config?.data, ref });
    return ref;
  });
  readonly closeAll = vi.fn();

  get last(): OpenedDialog {
    const last = this.opened.at(-1);
    if (!last) {
      throw new Error('No dialog was opened.');
    }
    return last;
  }

  /** Closes the most recently opened dialog with the given result (nothing = dismissed). */
  closeLast(result?: unknown): void {
    this.last.ref.close(result);
  }
}

/** `{ provide: MatDialog, useValue: dialog }`. */
export function provideFakeDialog(dialog: FakeDialog) {
  return { provide: MatDialog, useValue: dialog };
}

/**
 * For specs of a dialog component itself: provides its `MAT_DIALOG_DATA` and a `FakeDialogRef`.
 * Read the ref back with `TestBed.inject(MatDialogRef)`.
 */
export function provideDialogData<T>(data: T, ref: FakeDialogRef = new FakeDialogRef()) {
  return [
    { provide: MAT_DIALOG_DATA, useValue: data },
    { provide: MatDialogRef, useValue: ref },
  ];
}
