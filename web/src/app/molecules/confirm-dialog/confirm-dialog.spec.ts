import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { FakeDialog, provideDialogData, provideFakeDialog } from '../../../testing';
import { ConfirmData, ConfirmDialog, confirm } from './confirm-dialog';

describe('ConfirmDialog', () => {
  function render(data: ConfirmData) {
    TestBed.configureTestingModule({ providers: [provideDialogData(data)] });
    const fixture = TestBed.createComponent(ConfirmDialog);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { el, buttons: Array.from(el.querySelectorAll('button')) };
  }

  it('shows the title, the message and both choices', () => {
    const { el, buttons } = render({
      title: 'Delete portfolio?',
      message: 'This cannot be undone.',
      confirm: 'Delete',
    });

    expect(el.querySelector('h2')?.textContent).toBe('Delete portfolio?');
    expect(el.querySelector('p')?.textContent).toBe('This cannot be undone.');
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Cancel', 'Delete']);
  });

  it('marks the confirm button destructive only when asked', () => {
    expect(render({ title: 't', message: 'm', confirm: 'Go', destructive: true }).buttons[1].classList).toContain(
      'destructive',
    );
  });

  it('leaves the confirm button plain by default', () => {
    expect(render({ title: 't', message: 'm', confirm: 'Go' }).buttons[1].classList).not.toContain('destructive');
  });
});

describe('confirm', () => {
  const data: ConfirmData = { title: 'Remove?', message: 'Sure?', confirm: 'Remove' };

  async function ask(result: unknown) {
    const dialog = new FakeDialog();
    TestBed.configureTestingModule({ providers: [provideFakeDialog(dialog)] });
    const answer = confirm(TestBed.inject(MatDialog), data);
    dialog.closeLast(result);
    return { dialog, answer: await answer };
  }

  it('opens the confirmation with the given text', async () => {
    const { dialog } = await ask(true);

    expect(dialog.last.component).toBe(ConfirmDialog);
    expect(dialog.last.data).toBe(data);
  });

  it('resolves true when the person confirms', async () => {
    expect((await ask(true)).answer).toBe(true);
  });

  it('resolves false when the person cancels or dismisses', async () => {
    expect((await ask(undefined)).answer).toBe(false);
  });

  it('resolves false for any result other than an explicit true', async () => {
    expect((await ask('yes')).answer).toBe(false);
  });
});
