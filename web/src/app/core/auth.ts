import { HttpClient, HttpErrorResponse, HttpInterceptorFn, httpResource } from '@angular/common/http';
import { Injectable, computed, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, filter, firstValueFrom, throwError } from 'rxjs';
import { EmailLinkSent, Me, Passkey } from './models';

const SIGNED_OUT: Me = { signedIn: false, email: null, passkeys: 0, inboxUrl: null, publicUrl: '' };

/** Who is signed in, plus the passkey and email-link ceremonies. */
@Injectable({ providedIn: 'root' })
export class Auth {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly me = httpResource<Me>(() => '/api/auth/me', { defaultValue: SIGNED_OUT });
  readonly signedIn = computed(() => this.me.hasValue() && this.me.value().signedIn);
  readonly email = computed(() => (this.me.hasValue() ? this.me.value().email : null));
  readonly inboxUrl = computed(() => (this.me.hasValue() ? this.me.value().inboxUrl : null));
  readonly publicUrl = computed(() => (this.me.hasValue() ? this.me.value().publicUrl : ''));

  private readonly settled$ = toObservable(this.me.status).pipe(
    filter(status => status === 'resolved' || status === 'error' || status === 'local'));

  /** Passkeys need a secure context (https, or localhost) and a browser with the WebAuthn JSON helpers. */
  readonly passkeysSupported =
    typeof PublicKeyCredential !== 'undefined' && window.isSecureContext && typeof PublicKeyCredential.parseRequestOptionsFromJSON === 'function';

  /** Resolves once the first "who am I" request has answered, or failed. */
  async ready(): Promise<void> {
    await firstValueFrom(this.settled$);
  }

  requestEmailLink(email: string): Promise<EmailLinkSent> {
    return firstValueFrom(this.http.post<EmailLinkSent>('/api/auth/email-link', { email }));
  }

  async verifyEmailLink(token: string, confirmSwitch = false): Promise<Me> {
    const me = await firstValueFrom(this.http.post<Me>('/api/auth/email-link/verify', { token, confirmSwitch }));
    this.me.set(me);
    return me;
  }

  /** Ends the session on every device, this one included. */
  async signOutEverywhere(): Promise<void> {
    await firstValueFrom(this.http.post<void>('/api/account/sign-out-everywhere', null));
    this.me.set(SIGNED_OUT);
    await this.router.navigate(['/sign-in']);
  }

  async signInWithPasskey(): Promise<Me> {
    const optionsJson = await firstValueFrom(this.http.post<PublicKeyCredentialRequestOptionsJSON>('/api/auth/passkey/options', null));
    const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(optionsJson);
    const credential = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
    if (!credential) {
      throw new Error('No passkey was used.');
    }
    const me = await firstValueFrom(this.http.post<Me>('/api/auth/passkey', { credential: serialize(credential) }));
    this.me.set(me);
    return me;
  }

  async addPasskey(name: string | null): Promise<Passkey[]> {
    const optionsJson = await firstValueFrom(this.http.post<PublicKeyCredentialCreationOptionsJSON>('/api/account/passkeys/options', null));
    const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON(optionsJson);
    const credential = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
    if (!credential) {
      throw new Error('The passkey was not created.');
    }
    const passkeys = await firstValueFrom(this.http.post<Passkey[]>('/api/account/passkeys', { credential: serialize(credential), name }));
    this.me.reload();
    return passkeys;
  }

  passkeys(): Promise<Passkey[]> {
    return firstValueFrom(this.http.get<Passkey[]>('/api/account/passkeys'));
  }

  async removePasskey(id: string): Promise<Passkey[]> {
    const passkeys = await firstValueFrom(this.http.delete<Passkey[]>(`/api/account/passkeys/${encodeURIComponent(id)}`));
    this.me.reload();
    return passkeys;
  }

  async signOut(): Promise<void> {
    await firstValueFrom(this.http.post<void>('/api/auth/sign-out', null));
    this.me.set(SIGNED_OUT);
    await this.router.navigate(['/sign-in']);
  }

  /** The server no longer knows this session (it expired, or was ended elsewhere). */
  sessionEnded(): void {
    if (this.signedIn()) {
      this.me.set(SIGNED_OUT);
    }
  }
}

/** Pages that need an account: wait for the session check, then send strangers to the sign-in page. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(Auth);
  const router = inject(Router);
  await auth.ready();
  if (auth.signedIn()) {
    return true;
  }
  return router.createUrlTree(['/sign-in'], { queryParams: state.url && state.url !== '/' ? { returnUrl: state.url } : {} });
};

/** The sign-in page has nothing to offer someone who is already in. */
export const signedOutGuard: CanActivateFn = async () => {
  const auth = inject(Auth);
  const router = inject(Router);
  await auth.ready();
  return auth.signedIn() ? router.createUrlTree(['/']) : true;
};

/** A 401 from the API means the session ended: forget it and go to the sign-in page, keeping the return address. */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(Auth);
  const router = inject(Router);
  return next(request).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401
        && request.url.startsWith('/api/') && !request.url.startsWith('/api/auth/')) {
        auth.sessionEnded();
        void router.navigate(['/sign-in'], { queryParams: { returnUrl: router.url }, replaceUrl: true });
      }
      return throwError(() => error);
    }));
};

/** Only a path on this site may be returned to after signing in. */
export function safeReturnUrl(url: string | null): string {
  return url && url.startsWith('/') && !url.startsWith('//') ? url : '/';
}

/** Explains a WebAuthn failure in the browser's words, before it reaches the server. */
export function passkeyErrorMessage(error: unknown, publicUrl = ''): string | null {
  if (!(error instanceof DOMException)) {
    return null;
  }
  switch (error.name) {
    case 'NotAllowedError':
      return 'No passkey was used. Try again, or email yourself a sign-in link.';
    case 'InvalidStateError':
      return 'This device already has a passkey for your account.';
    case 'SecurityError':
      return publicUrl
        ? `Passkeys only work at Money Monkey's own address, ${publicUrl}, over https or on localhost. Open Money Monkey there and try again.`
        : 'Passkeys only work over https or on localhost, at the address Money Monkey is set up for.';
    default:
      return `The passkey step failed (${error.name}).`;
  }
}

/**
 * The credential as JSON, the way ASP.NET Core Identity expects it. Browsers provide toJSON(); some password
 * managers break it, so the fields are encoded by hand when that happens.
 */
function serialize(credential: PublicKeyCredential): string {
  const withJson = credential as PublicKeyCredential & { toJSON?: () => unknown; authenticatorAttachment?: string | null };
  if (typeof withJson.toJSON === 'function') {
    try {
      return JSON.stringify(withJson.toJSON());
    } catch {
      // Fall through to the manual encoding.
    }
  }

  const raw = credential.response as AuthenticatorAttestationResponse & AuthenticatorAssertionResponse & { getTransports?: () => string[] };
  const response: Record<string, unknown> = { clientDataJSON: base64Url(raw.clientDataJSON) };
  if (raw.attestationObject) {
    response['attestationObject'] = base64Url(raw.attestationObject);
    response['transports'] = raw.getTransports?.() ?? [];
  }
  if (raw.authenticatorData) {
    response['authenticatorData'] = base64Url(raw.authenticatorData);
    response['signature'] = base64Url(raw.signature);
    if (raw.userHandle) {
      response['userHandle'] = base64Url(raw.userHandle);
    }
  }
  return JSON.stringify({
    id: credential.id,
    rawId: base64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: withJson.authenticatorAttachment ?? null,
    clientExtensionResults: credential.getClientExtensionResults(),
    response,
  });
}

function base64Url(buffer: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(buffer)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
