import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { Api, problemMessage } from '../core/api';
import { TRANSACTION_LABELS, formatDate } from '../core/format';
import { Transaction } from '../core/models';
import { confirm } from '../shared/confirm-dialog';
import { TransactionDialog, TransactionDialogData, TransactionDialogResult } from './transaction-dialog';

/** Add, edit and delete flows shared by the portfolio and holding pages. Each resolves true when data changed. */
@Injectable({ providedIn: 'root' })
export class TransactionCommands {
  private readonly api = inject(Api);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);

  async open(data: TransactionDialogData): Promise<boolean> {
    const ref = this.dialog.open<TransactionDialog, TransactionDialogData, TransactionDialogResult>(TransactionDialog, {
      data,
      autoFocus: 'first-tabbable',
      maxWidth: '96vw',
    });
    const result = await firstValueFrom(ref.afterClosed());
    if (!result) {
      return false;
    }
    this.snack.open(result.message);
    return true;
  }

  async delete(portfolioId: string, transaction: Transaction): Promise<boolean> {
    const label = TRANSACTION_LABELS[transaction.type].toLowerCase();
    const what = transaction.symbol ? `${label} of ${transaction.symbol}` : label;
    const confirmed = await confirm(this.dialog, {
      title: 'Delete transaction?',
      message: `The ${what} on ${formatDate(transaction.date)} will be removed and every total recalculated.`,
      confirm: 'Delete transaction',
      destructive: true,
    });
    if (!confirmed) {
      return false;
    }

    try {
      await this.api.deleteTransaction(portfolioId, transaction.id);
      this.snack.open('Transaction deleted.');
      return true;
    } catch (error) {
      this.snack.open(problemMessage(error), 'Close', { duration: 12_000 });
      return false;
    }
  }
}
