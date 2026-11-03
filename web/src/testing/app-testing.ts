import { HttpInterceptorFn, provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { EnvironmentProviders, Provider, makeEnvironmentProviders } from '@angular/core';
import { DateAdapter, MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { provideRouter, Routes } from '@angular/router';
import { LocalDateAdapter } from '../app/core/date-adapter';

export interface AppTestingOptions {
  /** Routes for the test router; empty by default, so navigation is accepted but nothing renders. */
  routes?: Routes;
  /** HTTP interceptors, e.g. `[authInterceptor]` when the spec is about 401 handling. None by default. */
  interceptors?: HttpInterceptorFn[];
  /** Extra providers, applied last so they win. */
  providers?: (Provider | EnvironmentProviders)[];
}

/**
 * What nearly every component spec needs: HttpClient backed by HttpClientTesting (read it back with
 * `TestBed.inject(HttpTestingController)` or the helpers in http.ts), a Router with empty routes, and the app's date
 * adapter in en-CA. Material animations need no provider in v22; icons never fetch (see icon-registry.ts).
 *
 * ```ts
 * TestBed.configureTestingModule({ providers: [provideAppTesting()] });
 * ```
 */
export function provideAppTesting(options: AppTestingOptions = {}): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideHttpClient(withInterceptors(options.interceptors ?? [])),
    provideHttpClientTesting(),
    provideRouter(options.routes ?? []),
    provideNativeDateAdapter(),
    { provide: DateAdapter, useClass: LocalDateAdapter },
    { provide: MAT_DATE_LOCALE, useValue: 'en-CA' },
    ...(options.providers ?? []),
  ]);
}
