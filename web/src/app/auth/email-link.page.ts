import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { problemMessage } from '../core/api';
import { Auth, passkeyErrorMessage } from '../core/auth';

type State = 'ready' | 'verifying' | 'switch' | 'failed' | 'offer-passkey';

/**
 * Where an emailed link lands. Nothing happens until the person clicks, so a link opened by a mail scanner
 * is not used up, and a link for another account never replaces the current session silently.
 */
@Component({
  selector: 'app-email-link-page',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatIcon, RouterLink],
  template: `
    <div class="card">
      <span class="brand">Money Monkey</span>
      @switch (state()) {
        @case ('ready') {
          <h1>Sign in to Money Monkey</h1>
          <p class="lede">Continue to sign in on this device. The link works once.</p>
          <button mat-flat-button type="button" (click)="verify()">Continue</button>
        }
        @case ('verifying') {
          <h1>Signing you in…</h1>
        }
        @case ('switch') {
          <h1>Switch account?</h1>
          <p class="lede">{{ error() }}</p>
          <button mat-flat-button type="button" (click)="verify(true)">Switch to the link's account</button>
          <button mat-button type="button" class="skip" (click)="done()">Keep my current session</button>
        }
        @case ('failed') {
          <h1>This link didn't work</h1>
          <p class="lede">{{ error() }}</p>
          <a mat-flat-button routerLink="/sign-in">Go to sign-in</a>
        }
        @case ('offer-passkey') {
          <h1>You're in</h1>
          <p class="lede">
            Add a passkey so this device signs you in with Windows Hello, Touch ID or your password manager, with no
            email next time.
          </p>
          <mat-form-field>
            <mat-label>Name for this passkey (optional)</mat-label>
            <input matInput [ngModel]="name()" (ngModelChange)="name.set($event)" maxlength="60" placeholder="Home PC">
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
    </div>
  `,
  styleUrl: './sign-in.page.scss',
})
export class EmailLinkPage implements OnInit {
  private readonly auth = inject(Auth);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly state = signal<State>('ready');
  protected readonly error = signal<string | null>(null);
  protected readonly name = signal('');
  protected readonly busy = signal(false);
  private token: string | null = null;

  ngOnInit(): void {
    this.token = this.route.snapshot.queryParamMap.get('token');
    if (!this.token) {
      this.fail('The link is incomplete. Copy the whole address from the email, or ask for a new link.');
    }
  }

  protected async verify(confirmSwitch = false): Promise<void> {
    if (!this.token) {
      return;
    }
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
