import { HttpTestingController, TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Problem } from '../app/core/models';

/** What `TestRequest.flush` accepts as a body. */
export type Body = object | string | number | boolean | null;

export type Method = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/** `HttpTestingController` from the current TestBed. */
export function httpController(): HttpTestingController {
  return TestBed.inject(HttpTestingController);
}

/**
 * Runs pending effects and timers so an `httpResource` has issued its request (and so a flushed one has updated its
 * signals). Call it after creating a component or changing an input a resource depends on, and again after a flush
 * before reading the view.
 */
export async function settle(): Promise<void> {
  TestBed.tick();
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve));
  TestBed.tick();
}

/** The single open request for method + URL (path and query, as written); fails if none or several match. */
export function expectRequest(method: Method, url: string): TestRequest {
  return httpController().expectOne(
    (request) => request.method === method && request.urlWithParams === url,
    `${method} ${url}`,
  );
}

/** Like expectRequest, but matches on the URL as written to HttpClient (a query typed into the string counts; HttpParams do not). */
export function expectRequestToPath(method: Method, path: string): TestRequest {
  return httpController().expectOne(
    (request) => request.method === method && request.url === path,
    `${method} ${path}`,
  );
}

/** Answers the single open request for method + URL with a JSON body, then settles. */
export async function flush(method: Method, url: string, body: Body): Promise<TestRequest> {
  const request = expectRequest(method, url);
  request.flush(body);
  await settle();
  return request;
}

/** Answers with an RFC 9457 Problem Details body, as the API does for 4xx/5xx. */
export function flushProblem(request: TestRequest, status: number, detail?: string, title = 'Request failed'): void {
  const problem: Problem = { title, status, ...(detail === undefined ? {} : { detail }) };
  request.flush(problem, { status, statusText: statusText(status) });
}

/** Answers with a failed status and an optional body (a plain string for the API's 409 text, say). */
export function flushStatus(request: TestRequest, status: number, body: Body = null): void {
  request.flush(body, { status, statusText: statusText(status) });
}

/** A network failure: the server is unreachable (HttpErrorResponse.status === 0). */
export function flushNetworkError(request: TestRequest): void {
  request.error(new ProgressEvent('error'));
}

/** Fails the spec if a request was made that nobody answered or expected. */
export function verifyNoOutstandingRequests(): void {
  httpController().verify();
}

/** The JSON body a request carried. */
export function bodyOf<T = unknown>(request: TestRequest): T {
  return request.request.body as T;
}

function statusText(status: number): string {
  const names: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    422: 'Unprocessable Entity',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    503: 'Service Unavailable',
  };
  return names[status] ?? 'Error';
}
