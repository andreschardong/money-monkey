import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideAppTesting, transaction } from '../../../testing';
import { formatDate, formatMoney, formatPrice, formatQuantity } from '../../core/format';
import { Transaction, TransactionType } from '../../core/models';
import { TransactionsTable } from './transactions-table';

@Component({
  imports: [TransactionsTable],
  template: `<app-transactions-table
    [transactions]="transactions()"
    [readonly]="readonly()"
    (edit)="edited.push($event)"
    (remove)="removed.push($event)"
  />`,
})
class Host {
  readonly transactions = signal<Transaction[]>([]);
  readonly readonly = signal(false);
  readonly edited: Transaction[] = [];
  readonly removed: Transaction[] = [];
}

const buy = transaction({
  id: 'b',
  type: 'Buy',
  date: '2026-10-01',
  symbol: 'AAA',
  securityName: 'Alpha Inc',
  total: 900,
  note: 'First lot',
});
const sell = transaction({
  id: 's',
  type: 'Sell',
  date: '2026-10-03',
  symbol: 'CCC',
  securityName: 'Gamma Ltd',
  total: 300,
  currency: 'USD',
});
const dividend = transaction({
  id: 'd',
  type: 'Dividend',
  date: '2026-10-02',
  symbol: 'ZZZ',
  securityName: 'Zeta Corp',
  amount: 40,
  total: 40,
  quantity: 0,
  price: 0,
});

describe('TransactionsTable', () => {
  function render(list: Transaction[] = [buy, sell, dividend], readonly = false) {
    TestBed.configureTestingModule({ imports: [Host], providers: [provideAppTesting()] });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.transactions.set(list);
    fixture.componentInstance.readonly.set(readonly);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const filter = (text: string) => {
      const input = el.querySelector<HTMLInputElement>('input[type=search]')!;
      input.value = text;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    return {
      fixture,
      el,
      host: fixture.componentInstance,
      filter,
      tickers: () => Array.from(el.querySelectorAll('tbody .details .ticker')).map((t) => t.textContent),
      details: () =>
        Array.from(el.querySelectorAll('tbody .details')).map((d) => d.textContent?.replace(/\s+/g, ' ').trim()),
      header: (name: string) =>
        Array.from(el.querySelectorAll<HTMLElement>('thead th')).find((th) => th.textContent?.trim() === name)!,
      count: () => el.querySelector('.count')?.textContent,
    };
  }

  const menuItems = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button[mat-menu-item]'));

  describe('rows', () => {
    it('lists the newest first with date, type, symbol, details and total', () => {
      const { el, tickers } = render();

      expect(tickers()).toEqual(['CCC', 'ZZZ', 'AAA']);
      const first = el.querySelector('tbody tr')!;
      expect(first.querySelector('.date')?.textContent).toBe('Oct 3, 2026');
      expect(first.querySelector('.type')?.textContent).toBe('Sell');
      expect(first.querySelector('.type mat-icon svg')?.getAttribute('data-icon')).toBe('sell');
      expect(first.querySelector('td.num:not(.date)')?.textContent?.trim()).toBe(formatMoney(300, 'USD'));
    });

    it('shows how many of the transactions the filter keeps', () => {
      expect(render().count()).toBe('3 of 3');
    });

    it('shows a dash for a transaction with no total', () => {
      const { el } = render([transaction({ total: 0 })]);

      expect(el.querySelector('tbody td.right.num .muted')?.textContent).toBe('—');
    });

    it('shows the note under the details when there is one', () => {
      const { el } = render([buy, sell]);

      expect(el.querySelectorAll('.note')).toHaveLength(1);
      expect(el.querySelector('.note')?.textContent).toBe('First lot');
    });

    it('leaves out the symbol for a cash transaction', () => {
      const { el } = render([transaction({ type: 'Deposit', symbol: null, securityName: null })]);

      expect(el.querySelector('.details .ticker')).toBeNull();
    });

    it.each<[TransactionType, string]>([
      ['Buy', 'shopping_cart'],
      ['Sell', 'sell'],
      ['Split', 'call_split'],
      ['Deposit', 'south'],
      ['Withdrawal', 'north'],
      ['Dividend', 'payments'],
      ['Interest', 'savings'],
      ['Fee', 'receipt_long'],
      ['TransferIn', 'login'],
    ])('draws the %s icon', (type, icon) => {
      const { el } = render([transaction({ type })]);

      expect(el.querySelector('.type mat-icon svg')?.getAttribute('data-icon')).toBe(icon);
    });
  });

  describe('details wording', () => {
    const detailsOf = (t: Partial<Transaction>) => {
      TestBed.resetTestingModule();
      return render([transaction(t)]).details()[0];
    };

    it('gives quantity and price for a buy', () => {
      expect(detailsOf({ type: 'Buy', quantity: 10, price: 90, fee: 0 })).toContain(
        `${formatQuantity(10)} at ${formatPrice(90, 'CAD')}`,
      );
      expect(detailsOf({ type: 'Buy', quantity: 10, price: 90, fee: 0 })).not.toContain('commission');
    });

    it('adds the commission to a sell when there was one', () => {
      expect(detailsOf({ type: 'Sell', quantity: 5, price: 20, fee: 9.99 })).toContain(
        `, ${formatMoney(9.99, 'CAD')} commission`,
      );
    });

    it('gives the cost for a transfer in', () => {
      expect(detailsOf({ type: 'TransferIn', quantity: 4, price: 25 })).toContain(
        `${formatQuantity(4)} at a cost of ${formatPrice(25, 'CAD')}`,
      );
    });

    it('describes a split in the singular and the plural', () => {
      expect(detailsOf({ type: 'Split', splitFrom: 1, splitTo: 2 })).toContain('1 share became 2');
      expect(detailsOf({ type: 'Split', splitFrom: 2, splitTo: 3 })).toContain('2 shares became 3');
    });

    it('gives the dividend amount, and what was withheld when something was', () => {
      expect(detailsOf({ type: 'Dividend', amount: 40, fee: 0 })).toContain(formatMoney(40, 'CAD'));
      expect(detailsOf({ type: 'Dividend', amount: 40, fee: 6 })).toContain(
        `${formatMoney(40, 'CAD')} less ${formatMoney(6, 'CAD')} withheld`,
      );
    });

    it.each<TransactionType>(['Deposit', 'Withdrawal', 'Interest', 'Fee'])(
      'gives just the currency for a %s',
      (type) => {
        expect(detailsOf({ type, currency: 'EUR', symbol: null })).toContain('EUR');
      },
    );
  });

  describe('filter', () => {
    it('keeps transactions whose symbol matches, ignoring case and surrounding spaces', () => {
      const { filter, tickers, count } = render();

      filter('  aaa ');

      expect(tickers()).toEqual(['AAA']);
      expect(count()).toBe('1 of 3');
    });

    it('matches the security name', () => {
      const { filter, tickers } = render();
      filter('gamma');
      expect(tickers()).toEqual(['CCC']);
    });

    it('matches the type as shown, such as "Transfer in"', () => {
      const { filter, tickers } = render([buy, transaction({ id: 'ti', type: 'TransferIn', symbol: 'TTT' })]);
      filter('transfer in');
      expect(tickers()).toEqual(['TTT']);
    });

    it('matches the note', () => {
      const { filter, tickers } = render();
      filter('first lot');
      expect(tickers()).toEqual(['AAA']);
    });

    it('matches the currency', () => {
      const { filter, tickers } = render();
      filter('usd');
      expect(tickers()).toEqual(['CCC']);
    });

    it('copes with transactions that have no symbol, name or note', () => {
      const { filter, el } = render([transaction({ type: 'Deposit', symbol: null, securityName: null, note: null })]);
      filter('nothing like this');
      expect(el.querySelector('.empty')?.textContent?.trim()).toBe('No transactions match the filter.');
    });

    it('says so when nothing matches, and recovers when the filter is cleared', () => {
      const { filter, el, count, tickers } = render();

      filter('qqq');
      expect(el.querySelector('.empty')?.textContent?.trim()).toBe('No transactions match the filter.');
      expect(el.querySelector('table')).toBeNull();
      expect(count()).toBe('0 of 3');

      filter('');
      expect(tickers()).toHaveLength(3);
    });

    it('says there are no transactions yet when the list is empty', () => {
      const { el, count } = render([]);

      expect(el.querySelector('.empty')?.textContent?.trim()).toBe('No transactions yet.');
      expect(count()).toBe('0 of 0');
    });
  });

  describe('sorting', () => {
    it.each([
      ['Date', ['AAA', 'ZZZ', 'CCC']],
      ['Type', ['AAA', 'ZZZ', 'CCC']],
      ['Details', ['AAA', 'CCC', 'ZZZ']],
      ['Total', ['AAA', 'CCC', 'ZZZ']],
    ])('sorts by %s and reverses on a second click', (column, expected) => {
      const { fixture, tickers, header } = render();

      header(column).click();
      fixture.detectChanges();
      const first = tickers();
      header(column).click();
      fixture.detectChanges();

      // Date is already the sorted column (newest first), so its first click reverses it.
      expect(first).toEqual(expected);
      expect(tickers()).toEqual([...first].reverse());
    });

    it('puts a transaction with no symbol first when sorting details ascending', () => {
      const { fixture, tickers, header, el } = render([
        buy,
        transaction({ id: 'dep', type: 'Deposit', symbol: null, securityName: null }),
      ]);

      header('Details').click();
      fixture.detectChanges();

      expect(el.querySelectorAll('tbody tr')).toHaveLength(2);
      expect(tickers()).toEqual(['AAA']);
      expect(el.querySelector('tbody tr')?.querySelector('.ticker')).toBeNull();
    });

    it('breaks a date tie by when the entry was made', () => {
      const { tickers } = render([
        transaction({ id: '1', symbol: 'OLD', date: '2026-10-01', createdAt: '2026-10-01T10:00:00Z' }),
        transaction({ id: '2', symbol: 'NEW', date: '2026-10-01', createdAt: '2026-10-01T15:00:00Z' }),
      ]);

      expect(tickers()).toEqual(['NEW', 'OLD']);
    });
  });

  describe('actions', () => {
    it('labels each menu button with the type and date, and offers Edit and Delete', () => {
      const { el } = render([buy]);

      const trigger = el.querySelector<HTMLButtonElement>('td.actions button')!;
      expect(trigger.getAttribute('aria-label')).toBe(`Actions for Buy on ${formatDate('2026-10-01')}`);
      trigger.click();

      expect(menuItems().map((b) => b.textContent?.trim())).toEqual(['Edit', 'Delete']);
    });

    it('emits the transaction to edit', () => {
      const { el, host } = render([buy]);

      el.querySelector<HTMLButtonElement>('td.actions button')!.click();
      menuItems()[0].click();

      expect(host.edited).toEqual([buy]);
      expect(host.removed).toEqual([]);
    });

    it('emits the transaction to delete', () => {
      const { el, host } = render([buy]);

      el.querySelector<HTMLButtonElement>('td.actions button')!.click();
      menuItems()[1].click();

      expect(host.removed).toEqual([buy]);
      expect(host.edited).toEqual([]);
    });

    it('offers no actions to someone who can only view', () => {
      const { el } = render([buy], true);

      expect(el.querySelector('td.actions button')).toBeNull();
      expect(el.querySelector('th .visually-hidden')?.textContent).toBe('Actions');
    });
  });
});
