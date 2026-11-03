import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideAppTesting } from '../../../testing/app-testing';
import { FakeDialog, provideFakeDialog } from '../../../testing/dialog';
import { holding, transaction } from '../../../testing/fixtures';
import {
  expectRequest,
  flushNetworkError,
  flushProblem,
  settle,
  verifyNoOutstandingRequests,
} from '../../../testing/http';
import { formatDate } from '../../core/format';
import { ConfirmData, ConfirmDialog } from '../../molecules/confirm-dialog/confirm-dialog';
import { TransactionCommands } from './transaction-commands';
import { TransactionDialog, TransactionDialogData } from './transaction-dialog';

describe('TransactionCommands', () => {
  const data: TransactionDialogData = {
    portfolioId: 'p1',
    baseCurrency: 'CAD',
    holdings: [holding()],
    cashCurrencies: ['CAD'],
  };
  let dialog: FakeDialog;
  let snack: { open: ReturnType<typeof vi.fn> };
  let commands: TransactionCommands;

  beforeEach(() => {
    dialog = new FakeDialog();
    snack = { open: vi.fn() };
    TestBed.configureTestingModule({
      providers: [provideAppTesting(), provideFakeDialog(dialog), { provide: MatSnackBar, useValue: snack }],
    });
    commands = TestBed.inject(TransactionCommands);
  });

  afterEach(() => verifyNoOutstandingRequests());

  describe('opening the dialog', () => {
    it('opens the transaction dialog with the data it was given', () => {
      void commands.open(data);

      expect(dialog.last.component).toBe(TransactionDialog);
      expect(dialog.last.data).toBe(data);
      expect(dialog.last.config?.autoFocus).toBe('first-tabbable');
      expect(dialog.last.config?.maxWidth).toBe('96vw');
    });

    it('announces what was recorded and resolves true when the dialog saves', async () => {
      const done = commands.open(data);

      dialog.closeLast({ message: 'Buy recorded.' });

      await expect(done).resolves.toBe(true);
      expect(snack.open).toHaveBeenCalledExactlyOnceWith('Buy recorded.');
    });

    it('resolves false and says nothing when the dialog is cancelled', async () => {
      const done = commands.open(data);

      dialog.closeLast();

      await expect(done).resolves.toBe(false);
      expect(snack.open).not.toHaveBeenCalled();
    });
  });

  describe('deleting a transaction', () => {
    const buy = transaction({ id: 't7', type: 'Buy', symbol: 'XYZ', date: '2026-10-01' });

    function confirmation(): ConfirmData {
      expect(dialog.last.component).toBe(ConfirmDialog);
      return dialog.last.data as ConfirmData;
    }

    it('asks for confirmation naming the transaction and its date', () => {
      void commands.delete('p1', buy);

      expect(confirmation()).toEqual({
        title: 'Delete transaction?',
        message: `The buy of XYZ on ${formatDate('2026-10-01')} will be removed and every total recalculated.`,
        confirm: 'Delete transaction',
        destructive: true,
      });
    });

    it('leaves out the symbol for a transaction without a security', () => {
      void commands.delete('p1', transaction({ type: 'Deposit', symbol: null, securityId: null, date: '2026-09-15' }));

      expect(confirmation().message).toBe(
        `The deposit on ${formatDate('2026-09-15')} will be removed and every total recalculated.`,
      );
    });

    it('uses the lower-case label of a multi-word type', () => {
      void commands.delete('p1', transaction({ type: 'TransferIn', symbol: 'ABC' }));

      expect(confirmation().message).toContain('The transfer in of ABC on');
    });

    it('does nothing when the confirmation is declined', async () => {
      const done = commands.delete('p1', buy);

      dialog.closeLast(false);

      await expect(done).resolves.toBe(false);
      expect(snack.open).not.toHaveBeenCalled();
    });

    it('does nothing when the confirmation is dismissed', async () => {
      const done = commands.delete('p1', buy);

      dialog.closeLast();

      await expect(done).resolves.toBe(false);
    });

    it('deletes the transaction, says so, and resolves true', async () => {
      const done = commands.delete('p1', buy);
      dialog.closeLast(true);
      await settle();

      expectRequest('DELETE', '/api/portfolios/p1/transactions/t7').flush(null);

      await expect(done).resolves.toBe(true);
      expect(snack.open).toHaveBeenCalledExactlyOnceWith('Transaction deleted.');
    });

    it.each([
      [403, 'You can only view this portfolio.'],
      [404, 'That transaction no longer exists.'],
      [500, 'Something went wrong on our side.'],
    ])('shows the server explanation for a %i and resolves false', async (status, detail) => {
      const done = commands.delete('p1', buy);
      dialog.closeLast(true);
      await settle();

      flushProblem(expectRequest('DELETE', '/api/portfolios/p1/transactions/t7'), status, detail);

      await expect(done).resolves.toBe(false);
      expect(snack.open).toHaveBeenCalledExactlyOnceWith(detail, 'Close', { duration: 12_000 });
    });

    it('says the server is unreachable on a network error', async () => {
      const done = commands.delete('p1', buy);
      dialog.closeLast(true);
      await settle();

      flushNetworkError(expectRequest('DELETE', '/api/portfolios/p1/transactions/t7'));

      await expect(done).resolves.toBe(false);
      expect(snack.open).toHaveBeenCalledExactlyOnceWith(
        'The Money Monkey server is not reachable. Check that it is running.',
        'Close',
        { duration: 12_000 },
      );
    });
  });
});
