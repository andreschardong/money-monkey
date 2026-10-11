---
name: dotnet-practices
description: Conventions for Money Monkey's .NET 10 API and ledger engine (src/): minimal APIs with TypedResults, EF Core tenancy through query filters and PortfolioAccess, the Core engine's invariants, auth and rate-limit rules, market-data providers, Serilog, and how to test with the xunit v3 executables and Testcontainers. Use before adding or changing anything under src/ or tests/.
---

# .NET practices for this app

## Shape of the API

- Minimal APIs, one static class per area under `Endpoints/`, mapped on the `/api` group that already requires a
  session. Handlers are static methods returning `Results<Ok<T>, NotFound, ProblemHttpResult>` with
  `TypedResults`; errors through `Problems.BadRequest/Forbidden/Conflict/Unavailable` with a sentence a person can
  act on. DTOs are sealed records in `Endpoints/Contracts.cs`, mirrored in `web/src/app/core/models.ts`.
- Configuration through options classes bound from `appsettings.json` and environment variables
  (`Auth__*`, `Email__*`, `MarketData__*`); secrets never in appsettings. Read values that may change at runtime
  through `IOptionsMonitor<T>` (the allowed email list does).
- Style: file-scoped namespaces, primary constructors, `sealed` by default, `async` with a `CancellationToken`
  on every I/O path, XML summaries that say why rather than what, no regions.

## Data and tenancy

- EF Core 10 on PostgreSQL with snake_case names. Tenancy lives in global query filters on `FolioDbContext`:
  portfolios are mine or shared with me; securities are public, mine, or held in a portfolio shared with me.
  User-facing reads never bypass them (`IgnoreQueryFilters` is for migrations and admin-only code).
- Authorization beyond visibility goes through `PortfolioAccess` (`IsOwner`, `CanEditAsync`): owners rename,
  share and delete; "can edit" shares record transactions and cash; everything else is view-only and answers 403.
- Writes to a portfolio go through `TransactionWriter`, which replays the whole ledger
  (`PortfolioLedger.Replay`) and refuses a change that would sell more than is held, with the reason.
- Migrations: `dotnet ef migrations add <Name> --project src/Folio.Api --output-dir Data/Migrations`, applied at
  start-up. Price and rate writes are upserts (`unnest ... ON CONFLICT`). Identity tables keep their PascalCase
  names (`"AspNetUsers"`, lower-case columns).

## The engine (`src/Folio.Core`)

- No framework references. Money is `decimal`, dates are `DateOnly`, currencies go through `Currencies`.
  Cash is an entered balance per currency and date (`CashLedger`); trades, dividends and fees never change it.
  Closes are stored as traded, never split-adjusted; a recorded split restates them for the chart.
- Every behaviour change gets a test: `LedgerBuilder` in `tests/Folio.Core.Tests` for the engine, or an API test.

## Accounts and abuse controls

- Identity with passkeys (schema v3) and one-time email links (random, stored hashed, single use). The allowed
  email list is enforced in the cookie validator on every request, on every link request and on passkey sign-in;
  taking an address off the list signs it out at its next request.
- Rate-limit policies `email` and `verify` by client address; add `RequireRateLimiting` to any new endpoint that
  sends mail or could be brute-forced. The forgery guard refuses unsafe `/api` methods whose `Sec-Fetch-Site`
  isn't `same-origin`. Security headers and the content security policy are in `Program.cs`; `/scalar` and
  `/openapi` stay exempt.
- Behind the platform proxy (`Auth:BehindProxy=true`) the client address comes from forwarded headers; the proxy
  appends the real address, which the live check confirmed can't be spoofed.

## Market data

- Providers sit behind `IQuoteProvider`, `IFallbackQuoteProvider` and `IFxProvider`; `MarketDataErrors.IsTransient`
  decides what is retried. Quoted securities are shared by everyone; manually priced ones belong to an account.
  The daily refresh runs once per process after the Toronto close and catches up at start-up.

## Logging

- Serilog to console (and daily files locally). Mask addresses with `EmailMasking.Mask`; never log tokens,
  connection strings or request bodies. Client cancellations are 499 at Debug, not errors. EF logs one harmless
  error on a brand-new database while it checks the migrations table.

## Tests

- xunit v3 on Microsoft.Testing.Platform. Run the executables:
  `tests\Folio.Api.Tests\bin\Debug\net10.0\Folio.Api.Tests.exe -class Folio.Api.Tests.SharingApiTests` (or
  `dotnet run --project tests/Folio.Api.Tests`); `dotnet test` has reported zero tests with this SDK.
- `FolioApiFactory` starts PostgreSQL in Docker, replaces quotes, rates and mail with fakes, fixes the clock at
  `FolioApiFactory.Today`, signs clients in with `CreateSignedInClientAsync(email)`, and lets a test change
  configuration at runtime with `Settings.Set(...)`. `RestrictedFolioApiFactory` has an allowed list set.
- Name tests after the behaviour (`A_shared_portfolio_shows_up_for_the_other_account_...`), assert on status codes
  and the problem text people see, and cover the refusal path as well as the happy path.
