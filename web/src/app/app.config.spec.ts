import { HttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { formatDate as formatWithLocale } from '@angular/common';
import { LOCALE_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DateAdapter, MAT_DATE_LOCALE } from '@angular/material/core';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { MatIconRegistry } from '@angular/material/icon';
import { MAT_SNACK_BAR_DEFAULT_OPTIONS } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { expectRequest, flushProblem } from '../testing/http';
import { appConfig } from './app.config';
import { routes } from './app.routes';
import { Auth } from './core/auth';
import { LocalDateAdapter } from './core/date-adapter';

describe('appConfig', () => {
  beforeEach(() => {
    // The real icon registry (the test environment swaps in one that never fetches) so registerIcons can be observed.
    TestBed.configureTestingModule({
      providers: [...appConfig.providers, provideHttpClientTesting(), MatIconRegistry],
    });
  });

  it('reads and writes in Canadian English', () => {
    expect(TestBed.inject(LOCALE_ID)).toBe('en-CA');
    expect(TestBed.inject(MAT_DATE_LOCALE)).toBe('en-CA');
    expect(formatWithLocale(new Date(2026, 9, 9), 'mediumDate', 'en-CA')).toBe('Oct 9, 2026');
  });

  it('picks dates with the adapter that reads typed ISO days as local days', () => {
    expect(TestBed.inject(DateAdapter)).toBeInstanceOf(LocalDateAdapter);
  });

  it('gives form fields the outlined look and snack bars a four-second life at the start edge', () => {
    expect(TestBed.inject(MAT_FORM_FIELD_DEFAULT_OPTIONS)).toEqual({
      appearance: 'outline',
      subscriptSizing: 'dynamic',
    });
    expect(TestBed.inject(MAT_SNACK_BAR_DEFAULT_OPTIONS)).toEqual({ duration: 4000, horizontalPosition: 'start' });
  });

  it("routes with the app's route table", () => {
    expect(TestBed.inject(Router).config).toEqual(routes);
  });

  it("registers the app's icons when it starts", async () => {
    const svg = await firstValueFrom(TestBed.inject(MatIconRegistry).getNamedSvgIcon('add'));
    expect(svg.querySelector('path')).not.toBeNull();
  });

  it('ends the session and goes to sign-in when the API answers 401', async () => {
    const auth = TestBed.inject(Auth);
    const sessionEnded = vi.spyOn(auth, 'sessionEnded');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const failed = firstValueFrom(TestBed.inject(HttpClient).get('/api/portfolios')).catch((e: unknown) => e);
    flushProblem(expectRequest('GET', '/api/portfolios'), 401);
    expect(await failed).toMatchObject({ status: 401 });
    expect(sessionEnded).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/sign-in'], expect.objectContaining({ replaceUrl: true }));
  });
});
