---
name: angular-practices
description: Conventions for Money Monkey's Angular 22 front end (web/): signals and zoneless change detection, httpResource reads, the Api service for commands, Material 22 tokens, phone layout rules, CSP constraints, and how to verify with the unit and browser checks. Use before adding or changing anything under web/src.
---

# Angular practices for this app

## Atomic design (the folder layout of `web/src/app`)

| Folder | What lives there | May import |
| --- | --- | --- |
| `atoms/` | One element with no knowledge of the domain: `busy`, `change`, `hero-figure`, `notice`, `echart`, the `appSort` header. Inputs in, DOM out. | `core` |
| `molecules/` | A few atoms doing one job: `allocation-bar`, `currency-switch`, `panel`, `page-header`, `state-message`, `security-picker`, `confirm-dialog`. | atoms, `core` |
| `organisms/` | A section or dialog that knows the domain and may inject services: the charts, the holdings, transactions and income tables, `nav-rail`, every `*-dialog`. | molecules, atoms, other organisms, `core` |
| `templates/` | Page frames with slots and no data of their own: `shell`, `auth-card`. | organisms and below, `core` |
| `pages/` | Routed components that fetch data and fill a template. One folder per route; lazy-loaded from `app.routes.ts`. | everything below, never another page |
| `core/` | Services, stores, models, formatting, theme, icons, design tokens (`chart-theme`). No components. | `core` |

- A component is `<layer>/<name>/<name>.ts` (plus `.html` / `.scss` when large) with `<name>.spec.ts` beside it. Pick the
  lowest layer that fits; promote it only when it starts to know the domain or compose others.
- Presentational pieces take `input()`s and emit `output()`s; data fetching and commands stay in pages and organisms.
- `npm run architecture` enforces the table (and that every source file has a spec). It runs in CI.

## Architecture

- Standalone components, zoneless change detection, signals for all state: `signal`, `computed`, `linkedSignal`,
  `input()`, `output()`. No `@Input()` decorators, no `BehaviorSubject` state, no manual `subscribe` where a
  resource fits.
- **Reads** come from `httpResource` keyed by signals (see `portfolio.page.ts`); keep the previous value during a
  reload with `linkedSignal` so pages don't flash. Shared lists live in `core/stores.ts` and are `reload()`ed
  after a write.
- **Commands** go through `core/api.ts` (`Api`), which returns Promises via `firstValueFrom`; show failures with
  `problemMessage(error)` in a snackbar or an inline `<p class="error" role="alert">`.
- `core/models.ts` mirrors `src/Folio.Api/Endpoints/Contracts.cs`; when a DTO changes, change both.
- Routing: lazy pages, `title` per route ("Page | Money Monkey"), one `router-outlet` in the shell (a second one
  replayed a one-time sign-in token once).

## Templates and style

- Control flow blocks (`@if`, `@for` with `track`, `@empty`), never structural directives. Pipes from
  `FORMAT_PIPES` for money, dates, quantities and percentages; never format numbers by hand.
- Canadian English, sentence case, short labels. Icon buttons get `aria-label`; `data-testid` only for hooks the
  browser checks use.
- Material 22: theme through `mat.theme` and the `--mat-*` tokens in `styles.scss` and `core/theme.ts`; no
  `::ng-deep` and no overriding internal class names. Dialogs open with `autoFocus: 'first-tabbable'` and
  `maxWidth: '96vw'`.
- Icons are bundled SVG text registered in `core/icons.ts`: add the import and the map entry, and check the file
  exists under `web/node_modules/@material-symbols/svg-400/rounded/` first.
- Tables: `table.data` with `th[appSort]` and a `TableSort` instance, inside a `.scroll` wrapper. Every table
  sorts by every column.

## Phones (390 px wide is the target)

- Mark secondary columns `hide-s` (gone under 600 px) or `hide-m` (under 960 px); dates get class `date` so they
  never wrap. Dialog grids collapse to one column under 480 px. Tab labels put counts and long words in spans
  hidden on phones. Nothing may be wider than the viewport: `npm run mobile` screenshots every page at phone size
  and reports overflow.

## Security constraints that shape the front end

- The content security policy allows only the app's own scripts: no inline `<script>`, no inline event handler
  attributes, no CDN scripts. Styles may be inline (Material needs it). `theme-boot.js` exists for this reason.
- Requests that change something must come from the app's own origin; the browser sends `Sec-Fetch-Site` and the
  API refuses other origins. Don't add cross-origin fetches.
- Passkeys are bound to the configured domain; the sign-in error text names it (`auth.publicUrl()`).

## Verify

- Compile: `npx ng build --configuration development`. Unit tests: `npx ng test --watch=false`. The gate is
  `npm run coverage` (100 % statements, branches, functions and lines, thresholds in `angular.json`) together with
  `npm run architecture`.
- Specs use vitest globals with Angular's `TestBed`: render the component, set inputs with
  `fixture.componentRef.setInput`, `await fixture.whenStable()`, and assert on the DOM and on emitted outputs, not
  on private members. HTTP goes through `provideHttpClientTesting()` and `HttpTestingController`; Material dialogs,
  `Router`, `SwUpdate`, `navigator.credentials` and ECharts are replaced with test doubles from `src/testing/`.
- Behaviour: the Playwright checks in `tests/browser` against the running container, with registration open.
  Use `context.request` for API calls and downloads (page `fetch` has no cookies; `page.goto` on a download
  throws), use `exact: true` when a label is a prefix of another, and wait for the expected state before reading
  a table. Watch the rate limiter: five sign-in emails per ten minutes per address; `docker compose restart app`
  resets it.
- After layout changes run `npm run mobile` and look at the screenshots, not only the overflow report.
