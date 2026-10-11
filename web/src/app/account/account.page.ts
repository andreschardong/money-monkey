import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Api, problemMessage } from '../core/api';
import { Auth, passkeyErrorMessage } from '../core/auth';
import { FORMAT_PIPES } from '../core/format';
import { ImportResult, Passkey } from '../core/models';
import { PortfolioList, VersionStore } from '../core/stores';
import { confirm } from '../shared/confirm-dialog';

@Component({
  selector: 'app-account-page',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatIcon, ...FORMAT_PIPES],
  templateUrl: './account.page.html',
  styleUrl: './account.page.scss',
})
export class AccountPage {
  protected readonly auth = inject(Auth);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly api = inject(Api);
  private readonly list = inject(PortfolioList);
  protected readonly version = inject(VersionStore).value;

  protected readonly passkeys = signal<Passkey[] | null>(null);
  protected readonly name = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly importing = signal(false);
  protected readonly importResult = signal<ImportResult | null>(null);
  protected readonly importError = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  protected async addPasskey(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      this.passkeys.set(await this.auth.addPasskey(this.name().trim() || null));
      this.name.set('');
      this.snack.open('Passkey added.');
    } catch (error) {
      this.error.set(passkeyErrorMessage(error, this.auth.publicUrl()) ?? problemMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(passkey: Passkey): Promise<void> {
    const last = (this.passkeys()?.length ?? 0) <= 1;
    const confirmed = await confirm(this.dialog, {
      title: `Remove ${passkey.name}?`,
      message: last
        ? 'This is your only passkey. You can still sign in with an email link, and add a passkey again afterwards.'
        : 'The device that holds this passkey will no longer sign you in.',
      confirm: 'Remove passkey',
      destructive: true,
    });
    if (!confirmed) {
      return;
    }
    try {
      this.passkeys.set(await this.auth.removePasskey(passkey.id));
      this.snack.open('Passkey removed.');
    } catch (error) {
      this.snack.open(problemMessage(error), 'Close');
    }
  }

  protected async importFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    this.importing.set(true);
    this.importResult.set(null);
    this.importError.set(null);
    try {
      let data: unknown;
      try {
        data = JSON.parse(await file.text());
      } catch {
        data = null;
      }
      if (!data || typeof data !== 'object' || !Array.isArray((data as { portfolios?: unknown }).portfolios)) {
        throw new Error('That is not a Money Monkey export. Download "Everything (JSON)" from this page and import that file.');
      }
      const result = await this.api.importData(data);
      this.importResult.set(result);
      this.list.reload();
      this.snack.open(`Imported ${result.portfolios} ${result.portfolios === 1 ? 'portfolio' : 'portfolios'}.`);
    } catch (error) {
      this.importError.set(problemMessage(error));
    } finally {
      this.importing.set(false);
    }
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
  }

  protected async signOutEverywhere(): Promise<void> {
    const confirmed = await confirm(this.dialog, {
      title: 'Sign out everywhere?',
      message: 'Every device signed in to this account, including this one, will need to sign in again. Passkeys stay registered.',
      confirm: 'Sign out everywhere',
    });
    if (confirmed) {
      await this.auth.signOutEverywhere();
    }
  }

  private async load(): Promise<void> {
    try {
      this.passkeys.set(await this.auth.passkeys());
    } catch (error) {
      this.error.set(problemMessage(error));
      this.passkeys.set([]);
    }
  }
}
