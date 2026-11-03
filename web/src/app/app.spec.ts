import { TestBed } from '@angular/core/testing';
import { SwUpdate } from '@angular/service-worker';
import { provideAppTesting } from '../testing/app-testing';
import { FakeSwUpdate } from '../testing/browser-fakes';
import { FakeAuth, provideFakeAuth } from '../testing/fakes';
import { signedOutMe } from '../testing/fixtures';
import { App } from './app';

describe('App', () => {
  it('is the shell around the router outlet, and nothing else', () => {
    TestBed.configureTestingModule({
      providers: [
        provideAppTesting(),
        provideFakeAuth(new FakeAuth(signedOutMe())),
        { provide: SwUpdate, useValue: new FakeSwUpdate() },
      ],
    });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.children).toHaveLength(1);
    expect(root.children[0].tagName.toLowerCase()).toBe('app-shell');
    expect(root.querySelector('router-outlet')).not.toBeNull();
  });
});
