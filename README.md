# Money Monkey

[![CI](https://github.com/andreschardong/money-monkey/actions/workflows/ci.yml/badge.svg)](https://github.com/andreschardong/money-monkey/actions/workflows/ci.yml)

A personal portfolio tracker for stocks, ETFs and funds on the TSX, TSXV, NYSE, Nasdaq and European exchanges.
Portfolios report in CAD, USD or EUR, and each one can hold cash and securities in any currency.

![Money Monkey on a desktop and a phone](docs/screenshots/hero.png)

<table>
  <tr>
    <td><img src="docs/screenshots/portfolio.png" alt="A portfolio: value, return, suggestions for dividends and splits, and the value chart"></td>
    <td><img src="docs/screenshots/assets.png" alt="All assets across portfolios, in CAD"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/quotes.png" alt="Quotes: a year of closes for SHOP.TO with range statistics"></td>
    <td><img src="docs/screenshots/overview-dark.png" alt="The overview in dark mode"></td>
  </tr>
</table>

<p align="center"><img src="docs/screenshots/phone.png" alt="The overview and a portfolio on a phone" width="560"></p>

The screenshots show demo data; `tests/browser/readme-shots.mjs` regenerates them.

## What it does

- **Portfolios in CAD, USD or EUR.** Like a Questrade or IBKR account, a CAD portfolio can hold USD cash and US
  stocks. Totals are shown in the portfolio's currency, and the overview adds everything up in whichever of the
  three you pick.
- **Transactions:** buy, sell, split (or consolidation), dividend (with tax withheld), deposit, withdrawal,
  interest, fee, and transfer in (for shares you already own, at their original cost).
- **Quotes.** Look up any symbol, held or not: latest close, a history chart with ranges, recent closes, and the
  dividends and splits on record. Linked from every holding and from Prices and rates.
- **Every table sorts.** Click a column header to sort by it, again to flip; works with the keyboard too.
- **All assets in one table.** Every holding consolidated across portfolios (total shares, blended average cost,
  value, gain, weight) and cash summed per currency, each line broken down by portfolio, in CAD, USD or EUR.
- **Cash is an asset you enter.** Type the balance from your statement, per currency, with the date it was true.
  Buys, sells and dividends never change it; earlier entries stay, so the chart knows what you held on past days.
- **Book value is the adjusted cost base** (average cost), kept in the security's currency and in the portfolio's
  currency at each trade's own exchange rate. Realized gains, dividends and interest are summarized by year.
- **Nothing can quietly break the history.** Every add, edit or delete replays all transactions; a change that
  would sell shares you don't hold is refused with the reason.
- **Daily prices without an API key.** Closes come from Yahoo Finance once each weekday after the markets close
  (5:30 p.m. Toronto). A refresh missed while the PC was off runs when Money Monkey starts. If a symbol fails and an
  Alpha Vantage key is set, its latest close comes from there instead.
- **Official exchange rates** from the Bank of Canada (ECB rates before 2017 and as a backup).
- **Suggestions** for splits and recent dividends that Yahoo reports but you haven't recorded.
- **Manual prices** for holdings without a quote, such as GICs or private funds.
- **Your own account, no password.** An emailed link activates the account; after that a passkey (Windows Hello,
  Touch ID, Face ID or a password manager) signs you in. An email link also works as the fallback on a new device.
  Each account sees only its own portfolios and the ones shared with it.
- **Private by invitation.** `FOLIO_ALLOWED_EMAILS` lists who may use Folio. The API enforces it on every request:
  an address not on the list cannot create an account, request a sign-in link or sign in with a passkey, and an
  existing session is signed out the moment its address is taken off the list. Leave it empty to let anyone who
  can reach the app sign up.
- **Share a portfolio** with another account, to view or to edit. The other person sees it exactly as you do; with
  editing allowed they can record transactions and cash as well. Renaming, sharing and deleting stay with the owner.
- **Export and import.** The Account page downloads everything you entered as CSV files and as one JSON file, and
  imports such a JSON file as new portfolios, which is how you move to another PC or to the cloud.

## Run it

Docker Desktop must be running.

```powershell
cd C:\repos\folio
docker compose up -d --build
```

Open <http://localhost:8090>, enter your email and ask for a link. On this PC the email lands in the bundled
inbox at <http://localhost:8025> (Mailpit): open it, click the link, then add a passkey. The app and the inbox are
bound to this PC only.

| Task | Command |
| --- | --- |
| Stop | `docker compose stop` |
| Start again | `docker compose up -d` |
| Update after code changes | `docker compose up -d --build` |
| Logs | `docker compose logs -f app`, or the daily files in `logs/` (Serilog, kept 14 days) |
| Emails sent | <http://localhost:8025> |
| Back up the database | `.\backup.ps1` (to `backups\`) |
| Restore a backup | `Get-Content backups\folio-<timestamp>.sql \| docker compose exec -T db psql -U folio -d folio` |

The containers restart with Docker Desktop, so turning on "Start Docker Desktop when you sign in" keeps Money Monkey
available. Data lives in the Docker volume `folio_folio-db`; it survives `stop`, `down`, restarts and rebuilds.

**Never run `docker compose down -v`: the `-v` deletes the database, accounts and passkeys included.** Take a
backup with `.\backup.ps1` before upgrades; it writes `backups\folio-<timestamp>.sql`, and the script's header
shows the restore command.

Settings that differ per machine go in a `.env` file next to `docker-compose.yml` (see `.env.example`): who may
create an account, the optional Alpha Vantage backup key, the public address and passkey domain, and a real SMTP
server once emails should leave this PC. After changing `.env`, run `docker compose up -d app`.

## Sharing with someone else

1. Add their email to `FOLIO_ALLOWED_EMAILS` in `.env` (comma-separated) and run `docker compose up -d app`.
2. They open Money Monkey, ask for a sign-in link with that email, open it from the inbox and add a passkey. That creates
   their account; it starts empty.
3. On your portfolio page, open the menu (⋮) and choose **Share…**, enter their email and tick **Can edit** if they
   should record transactions and cash too. The portfolio appears in their list marked "shared by you"; their
   overview and All assets include it. Untick or **Remove** at any time.

Sharing is only with existing accounts: Money Monkey never emails an invitation, and an address that has no account is
refused with a message saying so.

## Export and import

The Account page has **Export my data**: transactions, cash balances and today's holdings as CSV files for a
spreadsheet, and **Everything (JSON)**, the complete record. **Import** loads such a JSON file into the signed-in
account: each portfolio in the file becomes a new portfolio (a name already in use gets "(imported)" added), with
its transactions and cash entries; nothing already there is changed. Quoted stocks are looked up again; a symbol
that cannot be quoted is kept as a manually priced security and reported after the import. The export holds only
the account's own portfolios, not the ones shared with it.

## Install it as an app

Money Monkey is a progressive web app: once it is served over https it installs like a native app, opens in its
own window, and keeps working offline for what it has already shown (data still needs the connection).

- **Android** (Chrome, Edge): open the site, then the browser menu → **Install app**, or the **Install app** entry
  at the bottom of Money Monkey's own menu.
- **iPhone and iPad** (Safari): the **Share** button → **Add to Home Screen**.
- **Windows and Mac** (Edge, Chrome): the install icon at the right end of the address bar, or the **Install app**
  entry in Money Monkey's menu.

Updates: the installed app checks for a new version when it opens and every hour afterwards, and offers a
**Reload** when one is ready. The service worker caches only the app's own files; every request to the API, and
every download, goes to the server.

## Getting started with accounts you already have

1. Create one portfolio per account (TFSA, RRSP, non-registered, US account), in the currency its statements use.
2. Enter what you hold today. Two ways, and they can be mixed:
   - **Quick:** a *Transfer in* per holding, with its original purchase date and average cost from your broker's
     book value. Book value and gains are right from day one; the history chart starts at those dates.
   - **Complete:** replay the account: deposits, buys and sells, in date order. This also gives a true
     money-weighted return.
3. Enter the cash balance (the **Cash** button on the portfolio page) in each currency the account holds.
4. Check the suggestions banner: it flags splits and recent dividends Yahoo knows about but the portfolio
   doesn't.

## Develop

| Part | How |
| --- | --- |
| Database and inbox | `docker compose up -d db mailpit` (PostgreSQL on `localhost:5434`, Mailpit on 1025/8025) |
| API | `dotnet run --project src/Folio.Api` on <http://localhost:5080>; API explorer at `/scalar` |
| Web | `cd web; npm install; npx ng serve` on <http://localhost:4200> (proxies `/api` to the API) |
| Tests | `dotnet test` (the API tests start PostgreSQL in Docker) and `cd web; npx ng test --watch=false` |
| Browser checks | `cd tests/browser; npm run account`, `trading`, `suggestions`, `sharing`, `screens`, `mobile` (phone-size screenshots into `shots/` plus an overflow report), `pwa` (manifest, service worker, downloads bypass the cache) against the running container; `live` checks the deployed site anonymously; `icons` re-renders the app icons from `web/public/favicon.svg` (registration must be open: an empty `FOLIO_ALLOWED_EMAILS` while they run) |
| Migrations | `dotnet ef migrations add <Name> --project src/Folio.Api --output-dir Data/Migrations` (applied on start-up) |

The version number lives in `Directory.Build.props` (`<Version>`); bump it for a release. The API reports it at
`/api/version` together with the commit and build time the image was built with, and the app shows it at the
bottom of the navigation and on the Account page. Images built by `deploy/azure/push-image.ps1` or CI carry the
commit and build time; a plain `docker compose up --build` doesn't pass them, so the local app shows the version
alone.

The production build keeps critical-CSS inlining off (`inlineCritical: false` in `angular.json`): Angular's
inliner loads the rest of the stylesheet through an inline `onload` handler, which the content security policy
blocks, and the page would lose most of its global styles.

The development API reads the Alpha Vantage key from user secrets:
`dotnet user-secrets set MarketData:AlphaVantageApiKey <key> --project src/Folio.Api`.

```text
src/Folio.Core   ledger engine: cost base, splits, entered cash, valuation, history, XIRR (no framework code)
src/Folio.Api    ASP.NET Core API, EF Core + PostgreSQL, market data clients, daily refresh
web              Angular 22, Angular Material, ECharts
tests            xUnit v3: engine tests, Yahoo parsing tests, API tests on a real PostgreSQL
```

## How the numbers work

- **Value** is each holding at its latest close times that day's exchange rate, plus the cash balances you
  entered (the latest entry on or before the day).
- **Net deposits** are deposits minus withdrawals (transfers in count at their book value), each at the exchange
  rate of its own date. They are for the return figures only and do not change the cash balance.
- **Total return** is value minus net deposits, shown once a deposit is recorded. After a year of history, the
  money-weighted annual return (XIRR) is shown too.
- **Today** is shares times the change between the last two closes, restated across a split.
- **Prices are stored as actually traded**, not adjusted for later splits, so a split has to be recorded (or the
  suggestion accepted) for the share count and the chart to line up.
- Buys and sells use the Bank of Canada rate for their date unless you enter your broker's rate.

## Deploying to the cloud

The image is self-contained: the API serves the Angular app, applies database migrations on start-up and refreshes
prices itself every weekday evening. It needs PostgreSQL, https on its own host name, a mail server, and a few
settings. The settings are plain environment variables (the `FOLIO_*` names are only how `docker-compose.yml`
fills them in):

| Variable | Value in the cloud |
| --- | --- |
| `ConnectionStrings__Folio` or `DATABASE_URL` | the PostgreSQL connection; a `postgresql://user:password@host:5432/db?sslmode=require` URL is accepted (its `require` becomes full certificate verification) |
| `Auth__PublicUrl` | `https://<host>`: where people open Money Monkey; emailed links point here, and passkeys check it |
| `Auth__PasskeyDomain` | `<host>` (no scheme or port). Passkeys are bound to it: change it and everyone adds a new passkey |
| `Auth__BehindProxy` | `true`: the host's proxy ends https, so the app must believe its forwarded headers |
| `Auth__AllowedEmails` | the two or three addresses that may use the app; enforced on every API request |
| `Auth__InboxUrl` | empty (no Mailpit in the cloud) |
| `Email__Host`, `Email__Port`, `Email__Security`, `Email__User`, `Email__Password`, `Email__From` | an SMTP account; `Email__Security` is `StartTls` for port 587 or `SslOnConnect` for 465 |
| `MarketData__AlphaVantageApiKey` | optional backup quotes |
| `LogFile__Path` | empty: a cloud host keeps the console log; files would be lost on each deploy |
| `TZ` | `America/Toronto`, so the refresh runs after the Toronto close |
| `PORT` | set by hosts such as Railway; the app listens on it when present |

**Gmail is the planned mail server:** `smtp.gmail.com`, port 587, `StartTls`, your Gmail address as user and
an app password as password (Google Account → Security → 2-Step Verification → App passwords; the 16-character
code is the password). `.env.example` has the block. One caveat: **Railway blocks outbound SMTP on its Free, Trial
and Hobby plans** (Pro, about $20 a month, allows it). Fly.io, Render, Cloud Run and a plain VPS allow port 587,
so with Gmail the choice is Railway Pro or one of those; a transactional-email HTTP API (Brevo, Resend, Postmark)
is the other way around the block and would need a small addition to the mailer.

### Azure, free: Container Apps + Neon (the chosen set-up)

Azure Container Apps on the consumption plan scales to zero and has a permanent monthly free grant (180,000
vCPU-seconds, 360,000 GiB-seconds, 2 million requests) that a personal app stays inside; custom domain and managed
certificate are included. Azure's own PostgreSQL is free only for the first year of a new account, so the database
is Neon's free Postgres. Gmail on port 587 works from Azure. Two trade-offs: the first visit after an idle spell
takes a few seconds to wake, and the daily price refresh runs at the first visit after the close (the start-up
catch-up) rather than at 5:30 sharp.

Accounts you need once: a personal Azure subscription (`az login`), a Docker Hub account for the image
(`docker login`; the repository can stay private), a Neon project (console.neon.tech, free plan, copy its
connection string) and a Gmail app password. The scripts in `deploy/azure` do the rest:

1. `.\deploy\azure\push-image.ps1 -DockerHubUser <you>` builds the image and pushes it; it prints the image name.
2. `.\deploy\azure\deploy.ps1 -Image <that name> -AllowedEmails 'you@gmail.com,her@example.com'` creates the
   resource group (`folio`, Canada Central), the environment and the app with every setting, and prints the CNAME
   and TXT records for Cloudflare. It is safe to rerun; a rerun updates the image and settings.
3. In the Azure portal (Container App → Security → Secrets) replace the two placeholders: `database-url` with the Neon
   connection string and `email-password` with the Gmail app password. Then rerun step 2 so a new revision picks
   them up.
4. Add the two DNS records (DNS only, proxy off), wait a minute, then `.\deploy\azure\bind-domain.ps1` attaches
   `moneymonkey.example.com` with a free certificate.
5. Open the address, sign in with an email link, add a passkey, Account → Import the JSON exported from this PC.

Updates later: step 1, then step 2 with the new image name. Leave `-AllowedEmails` out and the script keeps the
list currently set on the app, so an address added in the portal survives a publish. Logs: `az containerapp logs show -g folio -n folio
--follow`. Neon keeps point-in-time restore for the last day on the free plan; `.\backup.ps1`'s approach (`pg_dump`
with the Neon connection string) works for a copy on this PC.

### Railway, step by step

Railway runs the container continuously (so the daily refresh just works), adds PostgreSQL in one click, gives an
https host name, and costs about $5 to $10 a month for an app this size.

1. Install the CLI and sign in: `npm install -g @railway/cli`, then `railway login`.
2. In `C:\repos\folio`: `railway init` (new project), `railway add --database postgres`, then `railway up` to build
   the Dockerfile and deploy the app service. (`railway up` uploads the working directory; no GitHub needed.)
3. In the Railway dashboard, open the app service → **Settings → Networking → Custom Domain** and enter
   `moneymonkey.example.com`; add the CNAME record Railway shows at your DNS provider (DNS only, proxy
   off, until the certificate is issued). A generated `*.up.railway.app` host name works too, but passkeys bind to
   the host name, so pick the final one first.
4. Still on the app service, **Variables**: add the table above, with `Auth__PublicUrl=https://moneymonkey.example.com`
   and `Auth__PasskeyDomain=moneymonkey.example.com`. `DATABASE_URL` is a reference to the database service:
   `${{Postgres.DATABASE_URL}}`. Save; Railway redeploys.
5. Open the host name, ask for a sign-in link with your (allowed) email, open it from the real inbox, add a passkey.
6. **Move your data:** on this PC, Account → **Everything (JSON)**; in the cloud, Account → **Import** that file.
   Then share with your wife there, after she has signed up with her allowed email.
7. Back up the cloud database now and then: `railway connect postgres` opens `psql`, or use Railway's backups.

### Any other Docker host

A VPS, Cloud Run, Fly, Azure Container Apps and the like all take the same image. The only extra on a plain VPS is
https: put Caddy or nginx in front of port 8080 with a certificate, since the compose file binds the app to the
machine only. Where instances scale to zero (Cloud Run), the evening refresh needs an always-on instance
(`--min-instances 1`) or an external scheduler calling `POST /api/market/refresh` with a signed-in session.

## Status and caveats

A personal project, shared for personal use, learning and demos. Prices come from Yahoo Finance's unofficial
endpoints, which suit a personal tool and nothing more: they can change without notice, and their terms do not
allow a commercial service. Nothing here is financial advice, and the numbers are only as good as what you enter.

## Licence

[PolyForm Noncommercial 1.0.0](LICENSE): use it, change it and share it for personal, educational and other
noncommercial purposes. Commercial use, including running it as a paid service, is not allowed. Contributions are
accepted under the same licence; see `CONTRIBUTING.md`, and `SECURITY.md` for reporting a vulnerability.
