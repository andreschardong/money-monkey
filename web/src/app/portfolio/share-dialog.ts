import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { Api, problemMessage } from '../core/api';
import { Share } from '../core/models';
import { Busy } from '../shared/busy';

export interface ShareDialogData {
  portfolioId: string;
  name: string;
}

/**
 * Sharing is with Money Monkey accounts only: the other person signs in once with their email, then the owner adds that
 * email here. "Can edit" lets them record transactions and cash; renaming, sharing and deleting stay with the owner.
 */
@Component({
  selector: 'app-share-dialog',
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, MatIcon, Busy],
  template: `
    <h2 mat-dialog-title>Share {{ data.name }}</h2>
    <mat-dialog-content>
      <p class="intro">
        Only people with a Money Monkey account can be added. They sign in once with their email first; then enter that
        email here. They see the portfolio exactly as you do. With editing allowed they can record transactions and
        cash as well, but only you can rename, share or delete it.
      </p>

      @if (shares(); as list) {
        @if (list.length === 0) {
          <p class="muted">Not shared with anyone yet.</p>
        } @else {
          <ul class="list" aria-label="Shared with">
            @for (s of list; track s.email) {
              <li>
                <mat-icon svgIcon="account_circle" aria-hidden="true" />
                <span class="email">{{ s.email }}</span>
                <mat-checkbox [checked]="s.canEdit" (change)="setCanEdit(s, $event.checked)" [disabled]="busy()">Can edit</mat-checkbox>
                <button mat-button type="button" (click)="remove(s)" [disabled]="busy()">Remove</button>
              </li>
            }
          </ul>
        }
      } @else {
        <app-busy label="Loading…" inline />
      }

      <form class="add" (ngSubmit)="add()" novalidate>
        <mat-form-field>
          <mat-label>Email of a Money Monkey account</mat-label>
          <input matInput type="email" name="email" [ngModel]="email()" (ngModelChange)="email.set($event)" autocomplete="off" spellcheck="false" cdkFocusInitial>
        </mat-form-field>
        <mat-checkbox name="canEdit" [ngModel]="canEdit()" (ngModelChange)="canEdit.set($event)">Can edit</mat-checkbox>
        <button mat-flat-button type="submit" [disabled]="busy() || !email().trim()">
          <mat-icon svgIcon="person_add" />
          Share
        </button>
      </form>

      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="close()">Done</button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content { display: grid; gap: 14px; width: min(560px, 92vw); }
    .intro { max-width: 62ch; color: var(--ink-2); font-size: 0.9375rem; line-height: 1.5; }
    .list { display: grid; margin: 0; padding: 0; list-style: none; }
    .list li { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-top: 1px solid var(--rule); }
    .list mat-icon { flex: none; width: 22px; height: 22px; color: var(--brass-ink); }
    .email { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; font-weight: 550; }
    .add { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px 14px; align-items: center; padding-top: 8px; border-top: 1px solid var(--rule); }
    .add mat-form-field { grid-column: 1 / -1; }
    .add mat-checkbox { justify-self: end; }
    .error { padding: 10px 12px; border-radius: var(--radius-m); background: var(--loss-wash); color: var(--loss); font-size: 0.875rem; }
    @media (max-width: 560px) { .list li { flex-wrap: wrap; } .email { flex-basis: 100%; } }
  `,
})
export class ShareDialog {
  protected readonly data = inject<ShareDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<ShareDialog, boolean>>(MatDialogRef);
  private readonly api = inject(Api);

  protected readonly shares = signal<Share[] | null>(null);
  protected readonly email = signal('');
  protected readonly canEdit = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private changed = false;

  constructor() {
    void this.load();
  }

  protected async add(): Promise<void> {
    const email = this.email().trim();
    if (!email) {
      return;
    }
    await this.run(async () => {
      this.shares.set(await this.api.share(this.data.portfolioId, email, this.canEdit()));
      this.email.set('');
      this.canEdit.set(false);
    });
  }

  protected setCanEdit(share: Share, canEdit: boolean): void {
    void this.run(async () => this.shares.set(await this.api.share(this.data.portfolioId, share.email, canEdit)));
  }

  protected remove(share: Share): void {
    void this.run(async () => this.shares.set(await this.api.unshare(this.data.portfolioId, share.email)));
  }

  protected close(): void {
    this.ref.close(this.changed);
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
      this.changed = true;
    } catch (error) {
      this.error.set(problemMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      this.shares.set(await this.api.shares(this.data.portfolioId));
    } catch (error) {
      this.error.set(problemMessage(error));
      this.shares.set([]);
    }
  }
}
