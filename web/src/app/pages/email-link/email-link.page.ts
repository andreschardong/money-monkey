import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { problemMessage } from '../../core/api';
import { Auth, passkeyErrorMessage } from '../../core/auth';
import { AuthCard } from '../../templates/auth-card/auth-card';

type State = 'ready' | 'verifying' | 'switch' | 'failed' | 'offer-passkey';

const HEADINGS: Record<State, string> = {
  ready: 'Sign in to Money Monkey',
  verifying: 'Signing you in…',
  switch: 'Switch account?',
  failed: "This link didn't work",
  'offer-passkey': "You're in",
};

/**
 * Where an emailed link lands. Nothing happens until the person clicks, so a link opened by a mail scanner
 * is not used up, and a link for another account never replaces the current session silently.
 */
@Component({
  selector: 'app-email-link-page',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatIcon, RouterLink, AuthCard],
  template: `
    <app-auth-card [heading]="heading()">
      @switch (state()) {
        @case ('ready') {
          <p class="lede">Continue to sign in on this device. The link works once.</p>
          <button mat-flat-button type="button" (click)="verify()">Continue</button>
        }
        @case ('switch') {
          <p class="lede">{{ error() }}</p>
          <button mat-flat-button type="button" (click)="verify(true)">Switch to the link's account</button>
          <button mat-button type="button" class="skip" (click)="done()">Keep my current session</button>
        }
        @case ('failed') {
          <p class="lede">{{ error() }}</p>
          <a mat-flat-button routerLink="/sign-in">Go to sign-in</a>
        }
        @case ('offer-passkey') {
          <p class="lede">
            Add a passkey so this device signs you in with Windows Hello, Touch ID or your password manager, with no
            email next time.
          </p>
          <mat-form-field>
            <mat-label>Name for this passkey (optional)</mat-label>
            <input
              matInput
              [ngModel]="name()"
              (ngModelChange)="name.set($event)"
              maxlength="60"
              placeholder="Home PC"
            />
          </mat-form-field>
          <button mat-flat-button type="button" (click)="addPasskey()" [disabled]="busy()">
            <mat-icon svgIcon="fingerprint" />
            Add a passkey
          </button>
          <button mat-button type="button" class="skip" (click)="done()">Not now</button>
          @if (error()) {
            <p class="error" role="alert">{{ error() }}</p>
          }
        }
      }
    </app-auth-card>
  `,
  styles: `
    :host {
      display: block;
    }
    .lede {
      color: var(--ink-2);
      font-size: 0.9375rem;
      line-height: 1.5;
    }
    .error {
      padding: 10px 12px;
      border-radius: var(--radius-m);
      background: var(--loss-wash);
      color: var(--loss);
      font-size: 0.875rem;
    }
  `,
})
export class EmailLinkPage implements OnInit {
  private readonly auth = inject(Auth);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly state = signal<State>('ready');
  protected readonly error = signal<string | null>(null);
  protected readonly name = signal('');
  protected readonly busy = signal(false);
  protected readonly heading = computed(() => HEADINGS[this.state()]);
  private token = '';

  ngOnInit(): void {
    this.token = this.route.snapshot.queryParamMap.get('token') ?? '';
    if (!this.token) {
      this.fail('The link is incomplete. Copy the whole address from the email, or ask for a new link.');
    }
  }

  protected async verify(confirmSwitch = false): Promise<void> {
    this.state.set('verifying');
    try {
      const me = await this.auth.verifyEmailLink(this.token, confirmSwitch);
      if (this.auth.passkeysSupported && me.passkeys === 0) {
        this.state.set('offer-passkey');
      } else {
        await this.done();
      }
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 409) {
        this.error.set(problemMessage(error));
        this.state.set('switch');
      } else {
        this.fail(problemMessage(error));
      }
    }
  }

  protected async addPasskey(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.addPasskey(this.name().trim() || null);
      await this.done();
    } catch (error) {
      this.error.set(passkeyErrorMessage(error, this.auth.publicUrl()) ?? problemMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async done(): Promise<void> {
    await this.router.navigate(['/'], { replaceUrl: true });
  }

  private fail(message: string): void {
    this.error.set(message);
    this.state.set('failed');
  }
}
