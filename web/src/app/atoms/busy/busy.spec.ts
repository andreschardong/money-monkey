import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Busy } from './busy';

describe('Busy', () => {
  let fixture: ComponentFixture<Busy>;
  const host = () => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(Busy);
  });

  it('is a polite live region, so assistive technology announces it once', () => {
    fixture.detectChanges();
    expect(host().getAttribute('role')).toBe('status');
    expect(host().getAttribute('aria-live')).toBe('polite');
  });

  it('shows only the spinner, hidden from assistive technology, when there is no label', () => {
    fixture.detectChanges();
    expect(host().querySelector('.label')).toBeNull();
    expect(host().querySelector('mat-spinner')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('says what is loading', () => {
    fixture.componentRef.setInput('label', 'Loading portfolios…');
    fixture.detectChanges();
    expect(host().querySelector('.label')?.textContent).toBe('Loading portfolios…');
  });

  it('is a large centred spinner by default', () => {
    fixture.detectChanges();
    expect(host().classList).not.toContain('inline');
    expect((host().querySelector('mat-spinner') as HTMLElement).style.width).toBe('32px');
  });

  it('becomes a small row when inline, whether set as a bare attribute or a boolean', () => {
    fixture.componentRef.setInput('inline', true);
    fixture.detectChanges();
    expect(host().classList).toContain('inline');
    expect((host().querySelector('mat-spinner') as HTMLElement).style.width).toBe('20px');
    fixture.componentRef.setInput('inline', '');
    fixture.detectChanges();
    expect(host().classList).toContain('inline');
    fixture.componentRef.setInput('inline', false);
    fixture.detectChanges();
    expect(host().classList).not.toContain('inline');
  });
});
