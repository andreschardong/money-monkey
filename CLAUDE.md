# Money Monkey, for Claude Code

A personal portfolio tracker: .NET 10 minimal API + EF Core on PostgreSQL (`src/Folio.Api`), a framework-free
ledger engine (`src/Folio.Core`), an Angular 22 front end (`web`) served by the API from one container, and
Playwright browser checks (`tests/browser`). Read the README first; it explains how the numbers work.

Project skills with the conventions to follow: `.claude/skills/angular-practices` for the front end and
`.claude/skills/dotnet-practices` for the API and engine. Load the relevant one before changing code there.

## Commands that work

| Task | Command |
| --- | --- |
| Build everything | `dotnet build Folio.slnx` and `cd web; npx ng build --configuration development` |
| Engine and API tests | `tests\Folio.Core.Tests\bin\Debug\net10.0\Folio.Core.Tests.exe` and `tests\Folio.Api.Tests\bin\Debug\net10.0\Folio.Api.Tests.exe` (`-class Folio.Api.Tests.X` to filter; API tests start PostgreSQL in Docker). `dotnet test` on the solution has reported "zero tests ran" with this SDK; the executables are reliable. |
| API coverage gate | `.\coverage.ps1` runs both suites under `dotnet-coverage` and fails below 100 % lines or branches (report in `coverage\Index.html`). Docker must be running. |
| Web unit tests | `cd web; npx ng test --watch=false` (`npx vitest run` alone does not work) |
| Web coverage gate | `cd web; npm run coverage` fails below 100 % statements, branches, functions and lines (report in `web\coverage\`). |
| Web architecture | `cd web; npm run architecture` fails on a layer importing from a layer above it, or a component without its spec. |
| Browser checks | `cd tests/browser; npm run account`, `trading`, `suggestions`, `sharing`, `mobile`, `pwa`, `charts`, `gains`, `country`, `realestate`, `screens` against `http://localhost:8090` with registration open (below) |
| Local container | `docker compose up -d --build app` (database and Mailpit stay up); `docker compose restart app` resets the email rate limiter |
| Cloud | `.\deploy\azure\push-image.ps1` then `.\deploy\azure\deploy.ps1 -Image <printed tag>`; `bind-domain.ps1` for the host name. Values come from `.env`. |

## Rules

- **Atomic design.** `web/src/app` is `atoms` (one element, no data), `molecules` (atoms working together),
  `organisms` (sections and dialogs that know the domain), `templates` (page frames with slots) and `pages` (routed,
  fed with data), plus `core` (services, models, formatting). A layer imports only from layers below it; see
  `.claude/skills/angular-practices`. New UI starts as the lowest layer that fits and gets its spec beside it.
- **Coverage stays at 100 %** for the API and engine (`coverage.ps1`) and for the web app (`npm run coverage`). A change
  that adds code adds the tests in the same change. Excluding code from coverage is a last resort: it needs an
  `[ExcludeFromCodeCoverage(Justification = ...)]` or a comment saying why, and the generated EF migrations are the
  only standing exclusion.
- **Never run `docker compose down -v`** or anything that drops the local database: it holds the owner's real
  portfolios. `backup.ps1` dumps it to `backups/` before anything risky.
- `.env` is personal and ignored by git (API key, allowed emails, host name, Gmail sender, Docker Hub user).
  Never commit it, print it, or hard-code its values into scripts or docs.
- Browser checks create throwaway accounts, so the allowed list must be empty while they run:
  `$env:FOLIO_ALLOWED_EMAILS=''; docker compose up -d app`, and afterwards `docker compose up -d app` from a
  fresh shell to restore the list from `.env`. The cloud list is read from the app on publish and must never be
  reset by a deploy.
- The content security policy forbids inline scripts: no `<script>` in `index.html`, no inline event handlers,
  and the production build keeps `inlineCritical: false` (Angular's critical-CSS inliner would otherwise leave the
  stylesheet unloaded).
- Text shown to people is Canadian English (colour, centre, cheque). The product name is Money Monkey; internal
  names (projects, folders, image, Azure resources, cookie) stay `folio`.
- Verify end to end before reporting anything as done: build, the test executables, and the browser checks that
  touch the change. Patch scripts must be idempotent; check for a unique marker rather than "new text already
  present", which duplicated a property once.
- Commit only when asked. Commits and pull requests end with the attribution lines Claude Code provides.
