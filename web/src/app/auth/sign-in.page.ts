import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { problemMessage } from '../core/api';
import { Auth, passkeyErrorMessage, safeReturnUrl } from '../core/auth';
import { EmailLinkSent } from '../core/models';

@Component({
  selector: 'app-sign-in-page',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatIcon, RouterLink],
  templateUrl: './sign-in.page.html',
  styleUrl: './sign-in.page.scss',
})
export class SignInPage {
  protected readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly address = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly sent = signal<EmailLinkSent | null>(null);

  protected async passkey(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.signInWithPasskey();
      await this.router.navigateByUrl(safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl')));
    } catch (error) {
      this.error.set(passkeyErrorMessage(error, this.auth.publicUrl()) ?? problemMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async email(): Promise<void> {
    const address = this.address().trim();
    if (!address.includes('@')) {
      this.error.set('Enter your email address.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      this.sent.set(await this.auth.requestEmailLink(address));
    } catch (error) {
      this.error.set(problemMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
