import { ApplicationRef, Injectable, inject, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SwUpdate } from '@angular/service-worker';
import { filter, first } from 'rxjs';

/** The browser's own install prompt, where it offers one (Chromium on Android and desktop). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Installing Money Monkey as an app, and picking up a new version after a deploy. */
@Injectable({ providedIn: 'root' })
export class Pwa {
  private readonly updates = inject(SwUpdate);
  private readonly snack = inject(MatSnackBar);
  private readonly app = inject(ApplicationRef);
  private installEvent: BeforeInstallPromptEvent | null = null;

  /** True when the browser can install the app right now. iOS never says so: there it is Share → Add to Home Screen. */
  readonly canInstall = signal(false);
  /** True when running as the installed app rather than in a browser tab. */
  readonly installed = signal(typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);
  readonly isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  constructor() {
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      this.installEvent = event as BeforeInstallPromptEvent;
      this.canInstall.set(true);
    });
    window.addEventListener('appinstalled', () => {
      this.installEvent = null;
      this.canInstall.set(false);
      this.installed.set(true);
    });

    if (this.updates.isEnabled) {
      // A new build downloads in the background; offer it rather than swapping it in under the person's feet.
      this.updates.versionUpdates.pipe(filter(event => event.type === 'VERSION_READY')).subscribe(() => {
        this.snack.open('A new version of Money Monkey is ready.', 'Reload', { duration: 0 })
          .onAction().subscribe(() => location.reload());
      });
      // Check once the app has settled, then every hour while it stays open.
      this.app.isStable.pipe(first(stable => stable)).subscribe(() => {
        void this.updates.checkForUpdate();
        setInterval(() => void this.updates.checkForUpdate(), 60 * 60 * 1000);
      });
    }
  }

  async install(): Promise<void> {
    const event = this.installEvent;
    if (!event) {
      return;
    }
    await event.prompt();
    if ((await event.userChoice).outcome === 'accepted') {
      this.installEvent = null;
      this.canInstall.set(false);
    }
  }
}
