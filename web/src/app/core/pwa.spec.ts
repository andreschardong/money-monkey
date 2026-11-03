import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SwUpdate } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { FakeSwUpdate, stubMatchMedia } from '../../testing/browser-fakes';
import { Pwa } from './pwa';

class FakeSnackBar {
  readonly action = new Subject<void>();
  readonly open = vi.fn((_message: string, _action: string, _config: unknown) => ({ onAction: () => this.action }));
}

describe('Pwa', () => {
  let updates: FakeSwUpdate;
  let snack: FakeSnackBar;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    updates = new FakeSwUpdate();
    snack = new FakeSnackBar();
    TestBed.configureTestingModule({
      providers: [
        { provide: SwUpdate, useValue: updates },
        { provide: MatSnackBar, useValue: snack },
      ],
    });
  });

  afterEach(() => vi.useRealTimers());

  const installPrompt = (outcome: 'accepted' | 'dismissed') => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    const prompt = vi.fn(() => Promise.resolve());
    Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome }) });
    window.dispatchEvent(event);
    return { event, prompt };
  };

  describe('installing', () => {
    it('cannot install until the browser offers it', () => {
      expect(TestBed.inject(Pwa).canInstall()).toBe(false);
    });

    it("holds back the browser's own banner and offers the install once the browser allows it", () => {
      const pwa = TestBed.inject(Pwa);
      const { event } = installPrompt('accepted');
      expect(event.defaultPrevented).toBe(true);
      expect(pwa.canInstall()).toBe(true);
    });

    it('shows the browser prompt and stops offering once the person accepts', async () => {
      const pwa = TestBed.inject(Pwa);
      const { prompt } = installPrompt('accepted');
      await pwa.install();
      expect(prompt).toHaveBeenCalledOnce();
      expect(pwa.canInstall()).toBe(false);
    });

    it('keeps offering the install when the person dismisses the prompt', async () => {
      const pwa = TestBed.inject(Pwa);
      installPrompt('dismissed');
      await pwa.install();
      expect(pwa.canInstall()).toBe(true);
    });

    it('does nothing when asked to install without an offer', async () => {
      const pwa = TestBed.inject(Pwa);
      await expect(pwa.install()).resolves.toBeUndefined();
      expect(pwa.canInstall()).toBe(false);
    });

    it('becomes installed, and stops offering, after the app is installed', async () => {
      const pwa = TestBed.inject(Pwa);
      installPrompt('accepted');
      window.dispatchEvent(new Event('appinstalled'));
      expect(pwa.installed()).toBe(true);
      expect(pwa.canInstall()).toBe(false);
      await pwa.install();
    });
  });

  describe('display mode', () => {
    it('is a browser tab by default', () => {
      expect(TestBed.inject(Pwa).installed()).toBe(false);
    });

    it('is installed when it runs as a standalone app', () => {
      stubMatchMedia({ '(display-mode: standalone)': true });
      expect(TestBed.inject(Pwa).installed()).toBe(true);
    });

    it('is a browser tab when the browser has no matchMedia at all', () => {
      vi.stubGlobal('matchMedia', undefined);
      expect(TestBed.inject(Pwa).installed()).toBe(false);
    });
  });

  describe('platform', () => {
    afterEach(() => {
      delete (navigator as { maxTouchPoints?: number }).maxTouchPoints;
    });

    it.each([
      ['an iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'iPhone', 5],
      ['an iPad', 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 'iPad', 5],
      ['an iPad that claims to be a Mac', 'Mozilla/5.0 (Macintosh)', 'MacIntel', 5],
    ])('recognises %s', (_name, userAgent, platform, touchPoints) => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
      vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: touchPoints });
      expect(TestBed.inject(Pwa).isIos).toBe(true);
    });

    it.each([
      ['a Mac without a touch screen', 'Mozilla/5.0 (Macintosh)', 'MacIntel', 0],
      ['Windows', 'Mozilla/5.0 (Windows NT 10.0)', 'Win32', 0],
    ])('does not mistake %s for iOS', (_name, userAgent, platform, touchPoints) => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
      vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: touchPoints });
      expect(TestBed.inject(Pwa).isIos).toBe(false);
    });
  });

  describe('updates', () => {
    it('offers a reload when a new version is ready, and reloads when the person agrees', () => {
      const reload = vi.fn();
      vi.stubGlobal('location', { reload });
      TestBed.inject(Pwa);
      updates.versionUpdates.next({ type: 'VERSION_READY' });
      expect(snack.open).toHaveBeenCalledWith('A new version of Money Monkey is ready.', 'Reload', { duration: 0 });
      expect(reload).not.toHaveBeenCalled();
      snack.action.next();
      expect(reload).toHaveBeenCalledOnce();
    });

    it('ignores other service-worker events', () => {
      TestBed.inject(Pwa);
      updates.versionUpdates.next({ type: 'VERSION_DETECTED' });
      expect(snack.open).not.toHaveBeenCalled();
    });

    it('checks for an update once the app is stable, then every hour', () => {
      TestBed.inject(Pwa);
      expect(updates.checkForUpdate).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(60 * 60 * 1000);
      expect(updates.checkForUpdate).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(2 * 60 * 60 * 1000);
      expect(updates.checkForUpdate).toHaveBeenCalledTimes(4);
    });

    it('leaves the service worker alone when it is disabled', () => {
      updates.isEnabled = false;
      TestBed.inject(Pwa);
      updates.versionUpdates.next({ type: 'VERSION_READY' });
      vi.advanceTimersByTime(60 * 60 * 1000);
      expect(snack.open).not.toHaveBeenCalled();
      expect(updates.checkForUpdate).not.toHaveBeenCalled();
    });
  });
});
