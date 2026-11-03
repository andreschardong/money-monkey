# Test kit

Helpers for the Vitest + jsdom specs (`ng test`). Nothing here ships: `src/testing` is excluded from `tsconfig.app.json`
and from coverage. Import with a relative path, or from `src/testing/index.ts`.

## Registered for every spec (angular.json `test` options)

- `setup.ts` (`setupFiles`): `ResizeObserver` and `IntersectionObserver` no-ops, `matchMedia` (always "no"),
  `URL.createObjectURL`, `scrollIntoView`; after each test `vi.restoreAllMocks()`, `vi.unstubAllGlobals()`,
  `localStorage.clear()` and the `data-theme` attribute removed. So: no clean-up code in specs for those.
- `providers.ts` (`providersFile`): `MatIconRegistry` is replaced by `FakeIconRegistry`, which answers every
  `<mat-icon svgIcon="x">` with an empty `<svg data-icon="x">` and never fetches. Assert the icon with
  `el.querySelector('mat-icon svg')?.getAttribute('data-icon')`.

## Helpers

| Import | What it gives you |
| --- | --- |
| `app-testing.ts` `provideAppTesting({ routes?, interceptors?, providers? })` | HttpClient on `HttpClientTesting`, Router (empty routes), en-CA `LocalDateAdapter`. Start every component spec with it. |
| `http.ts` | `expectRequest(method, url)` (url as written, query included), `flush(method, url, body)` (answers, then settles), `flushProblem(req, status, detail)` (Problem Details), `flushStatus`, `flushNetworkError`, `bodyOf(req)`, `settle()` (effects + microtasks so an `httpResource` has fired or updated), `verifyNoOutstandingRequests()`, `httpController()`. |
| `dialog.ts` | `FakeDialog` + `provideFakeDialog(dialog)` replace `MatDialog`: `dialog.last.component` / `.data` / `.config`, then `dialog.closeLast(result)` to drive `afterClosed()`. For a dialog component's own spec: `provideDialogData(data)` supplies `MAT_DIALOG_DATA` and a `FakeDialogRef` (`TestBed.inject(MatDialogRef)`, `ref.close` is a spy, `ref.lastResult`). |
| `fixtures.ts` | Complete DTO builders taking `Partial` overrides: `portfolioSummary`, `portfolioDetail`, `holding`, `cashBalance`, `transaction`, `security`, `symbolMatch`, `overview`, `overviewPortfolio`, `allocation`, `mover`, `history`, `historyPoint`, `assets`, `assetHolding`, `me`, `signedOutMe`, `passkey`, `share`, `marketStatus`, `refreshRun`, `version`. |
| `fakes.ts` | `FakeAuth` / `provideFakeAuth` (writable `signedIn`, `email`, `hideGains`, ..., spies for every method; `auth.apply(me())`, `auth.signOutLocally()`), `FakePortfolioList`, `FakeMarketStatusStore`, `FakeVersionStore` with their `provideFake*`, and `FakeResource` / `loadingResource` / `failedResource` for the `httpResource` shape (`value`, `status`, `hasValue`, `error`, `reload`). Use the real `DisplayCurrency`, `RealEstateFilter` and `Theme`: they are plain signals over `localStorage`. |
| `echarts.ts` | Fake ECharts for `EChart` users. In the spec: `vi.mock('echarts/core', async () => (await import('<rel>/testing/echarts')).echartsCoreModule());`, `beforeEach(() => fakeEcharts.reset())`, then `fakeEcharts.last.lastOption` / `.setOption` shows what the component drew. |
| `browser-fakes.ts` | `stubMatchMedia({ '(prefers-reduced-motion: reduce)': true })` (returns `{ change(bool) }` for system changes), `FakeSwUpdate` (provide as `SwUpdate`), `installPasskeys()` + `fakeCredential()` (fake `navigator.credentials`, `PublicKeyCredential`, secure context; call before the first `inject(Auth)`, `restore()` in `afterEach`). |

## Conventions

- `it` names are sentences about behaviour a person sees; `describe` the unit.
- After creating a component that reads an `httpResource`, `await settle()` to let it send, `flush(...)` the answer,
  and read the DOM. End with `verifyNoOutstandingRequests()` when the spec should not leave requests behind.
- Add to the kit when two specs need the same thing; keep helpers small and typed (a fake that needs `any` hides it here).
