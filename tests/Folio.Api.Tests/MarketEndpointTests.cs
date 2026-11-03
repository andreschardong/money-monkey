using System.Net;
using Folio.Api.Data;
using Folio.Api.Endpoints;
using Folio.Api.MarketData;
using Folio.Core;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Folio.Api.Tests;

[Collection(FolioApiCollection.Name)]
public class MarketEndpointTests(FolioApiFactory factory)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static DateOnly Today => ApiClient.Today;

    private RefreshCoordinator Coordinator => factory.Services.GetRequiredService<RefreshCoordinator>();

    [Fact]
    public async Task WhenNoRefreshHasRunAndNothingIsHeld_ShouldDescribeAnIdleScheduleWithoutPrices()
    {
        var (client, _) = await factory.NewAccountAsync();
        await factory.WithDbAsync(db => db.RefreshRuns.ExecuteDeleteAsync(Ct));

        var status = await client.GetJsonAsync<MarketStatusDto>("/api/market/status");

        status.Running.ShouldBeFalse();
        status.LastRun.ShouldBeNull();
        status.SchedulerEnabled.ShouldBeFalse();
        status.Today.ShouldBe(Today);
        status.NextScheduledRun.ShouldBe(DateTimeOffset.Parse("2026-10-12T17:30:00-04:00"));
        (status.SecuritiesTracked, status.SecuritiesWithErrors, status.PricesAsOf).ShouldBe((0, 0, null));
        status.FallbackConfigured.ShouldBeFalse();
    }

    [Fact]
    public async Task WhenSecuritiesAreHeld_ShouldCountThemAndTheOnesWithErrors()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Tracked");
        await client.BuyAsync(portfolio, "STATX", 1, 10m);
        await client.BuyAsync(portfolio, "REFRY", 1, 10m);
        factory.Fallback.IsConfigured = true;
        try
        {
            var clean = await client.GetJsonAsync<MarketStatusDto>("/api/market/status");
            (clean.SecuritiesTracked, clean.SecuritiesWithErrors, clean.PricesAsOf, clean.FallbackConfigured).ShouldBe((2, 0, Today, true));

            await factory.WithDbAsync(db => db.Securities.IgnoreQueryFilters().Where(s => s.Symbol == "STATX")
                .ExecuteUpdateAsync(set => set.SetProperty(s => s.LastRefreshError, "boom"), Ct));
            var failing = await client.GetJsonAsync<MarketStatusDto>("/api/market/status");
            failing.SecuritiesWithErrors.ShouldBe(1);
        }
        finally
        {
            factory.Fallback.IsConfigured = false;
            await factory.WithDbAsync(db => db.Securities.IgnoreQueryFilters().Where(s => s.Symbol == "STATX")
                .ExecuteUpdateAsync(set => set.SetProperty(s => s.LastRefreshError, (string?)null), Ct));
        }
    }

    [Fact]
    public async Task WhenARunLogMentionsOtherAccountsSymbols_ShouldShowOnlyMyLinesAndTheGeneralOnes()
    {
        var (mine, _) = await factory.NewAccountAsync();
        var (other, _) = await factory.NewAccountAsync();
        var portfolio = await mine.CreatePortfolioAsync("Log");
        await mine.BuyAsync(portfolio, "AAPL", 1, 1m);
        var started = new DateTimeOffset(2040, 1, 1, 12, 0, 0, TimeSpan.Zero);
        var runId = await factory.WithDbAsync(async db =>
        {
            var run = new RefreshRun
            {
                StartedAt = started, FinishedAt = started.AddMinutes(1), Trigger = "Manual", Status = RefreshStatus.PartiallySucceeded,
                SecuritiesUpdated = 3, SecuritiesFailed = 1, FxRatesStored = 7,
                Log = "AAPL: 202 on 2026-10-09.\nMSFT: 1 on 2026-10-09.\nExchange rates: 7 stored (EUR, USD).\nRefresh failed: boom\nnoise\nAAPL",
            };
            db.RefreshRuns.Add(run);
            db.RefreshRuns.Add(new RefreshRun { StartedAt = started.AddHours(-1), Trigger = "Seed", Status = RefreshStatus.Succeeded });
            await db.SaveChangesAsync(Ct);
            return run.Id;
        });

        var mineRuns = await mine.GetJsonAsync<List<RefreshRunDto>>("/api/market/runs?take=100");
        var otherRuns = await other.GetJsonAsync<List<RefreshRunDto>>("/api/market/runs?take=100");

        var seen = mineRuns.Single(r => r.Id == runId);
        (seen.Trigger, seen.Status, seen.SecuritiesUpdated, seen.SecuritiesFailed, seen.FxRatesStored).ShouldBe(("Manual", RefreshStatus.PartiallySucceeded, 3, 1, 7));
        seen.Log.ShouldBe("AAPL: 202 on 2026-10-09.\nExchange rates: 7 stored (EUR, USD).\nRefresh failed: boom\nAAPL");
        otherRuns.Single(r => r.Id == runId).Log.ShouldBe("Exchange rates: 7 stored (EUR, USD).\nRefresh failed: boom");
        mineRuns.Single(r => r.Id == runId + 1).Log.ShouldBeNull();

        var status = await mine.GetJsonAsync<MarketStatusDto>("/api/market/status");
        status.LastRun!.Id.ShouldBe(runId);
        status.LastRun.Log.ShouldBe(seen.Log);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(0)]
    [InlineData(-5)]
    [InlineData(1)]
    [InlineData(5)]
    [InlineData(1000)]
    public async Task WhenRunsAreListed_ShouldReturnBetweenOneAndAHundredNewestFirst(int? take)
    {
        var (client, _) = await factory.NewAccountAsync();
        await factory.WithDbAsync(async db =>
        {
            for (var i = 0; i < 6; i++)
                db.RefreshRuns.Add(new RefreshRun { StartedAt = new DateTimeOffset(2032, 1, 1, 0, i, 0, TimeSpan.Zero), Trigger = "Seed", Status = RefreshStatus.Succeeded });
            await db.SaveChangesAsync(Ct);
        });

        var runs = await client.GetJsonAsync<List<RefreshRunDto>>("/api/market/runs" + (take is null ? string.Empty : $"?take={take}"));

        int expected = take is null ? 20 : Math.Clamp(take.Value, 1, 100);
        runs.Count.ShouldBeLessThanOrEqualTo(expected);
        runs.Count.ShouldBeGreaterThan(0);
        runs.Select(r => r.StartedAt).ShouldBe(runs.Select(r => r.StartedAt).OrderDescending());
        runs.First().StartedAt.Year.ShouldBeGreaterThanOrEqualTo(2032);
    }

    [Fact]
    public async Task WhenARefreshIsRequestedWhileOneRuns_ShouldAnswerConflictThenAcceptAfterItEnds()
    {
        var (client, _) = await factory.NewAccountAsync();
        var entered = new TaskCompletionSource();
        var release = new TaskCompletionSource();
        factory.Fx.BeforeRates = async () =>
        {
            entered.TrySetResult();
            await release.Task.WaitAsync(TimeSpan.FromSeconds(60));
        };
        try
        {
            var first = await client.PostJsonAsync("/api/market/refresh");
            first.StatusCode.ShouldBe(HttpStatusCode.Accepted);
            first.Headers.Location!.ToString().ShouldBe("/api/market/status");
            await entered.Task.WaitAsync(TimeSpan.FromSeconds(60), Ct);

            var running = await client.GetJsonAsync<MarketStatusDto>("/api/market/status");
            running.Running.ShouldBeTrue();
            var second = await client.PostJsonAsync("/api/market/refresh");
            second.StatusCode.ShouldBe(HttpStatusCode.Conflict);
            (await second.Content.ReadAsStringAsync(Ct)).ShouldContain("A refresh is already running.");
        }
        finally
        {
            release.TrySetResult();
            factory.Fx.BeforeRates = null;
        }

        await Eventually.WaitAsync(() => !Coordinator.IsRunning);
        (await client.GetJsonAsync<MarketStatusDto>("/api/market/status")).Running.ShouldBeFalse();
        var run = await factory.WithDbAsync(db => db.RefreshRuns.AsNoTracking().OrderByDescending(r => r.Id).FirstAsync(Ct));
        (run.Trigger, run.Status).ShouldBe(("Manual", RefreshStatus.Succeeded));
    }

    [Fact]
    public async Task WhenRatesAreAskedForToday_ShouldListCadFirstThenEachCurrencyInUse()
    {
        var (client, _) = await factory.NewAccountAsync();
        (await Coordinator.RunAsync("Test", Ct)).ShouldBeTrue();
        var portfolio = await client.CreatePortfolioAsync("Usd", "USD");
        await client.DepositAsync(portfolio, 10m);
        (await client.PutJsonAsync($"/api/portfolios/{portfolio}/cash", new SetCashRequest("GBP", 5m, null, null))).EnsureSuccessStatusCode();

        var rates = await client.GetJsonAsync<FxRatesDto>("/api/fx");

        rates.Date.ShouldBe(Today);
        rates.RatesDate.ShouldBe(Today);
        rates.Rates.Select(r => (r.From, r.To, r.Rate)).ShouldBe([("CAD", "CAD", 1m), ("EUR", "CAD", 1.5m), ("USD", "CAD", 1.4m)]);
    }

    [Fact]
    public async Task WhenRatesAreAskedForTheFutureOrAnOldDate_ShouldClampToTodayOrFetchThatDay()
    {
        var (client, _) = await factory.NewAccountAsync();
        await client.CreatePortfolioAsync("Usd", "USD");

        var future = await client.GetJsonAsync<FxRatesDto>("/api/fx?date=2027-01-04");
        var old = await client.GetJsonAsync<FxRatesDto>("/api/fx?date=2025-03-05");

        future.Date.ShouldBe(Today);
        old.Date.ShouldBe(new DateOnly(2025, 3, 5));
        old.RatesDate.ShouldBe(new DateOnly(2025, 3, 5));
        old.Rates.Single(r => r.From == "USD").Rate.ShouldBe(1.3m);
    }

    [Fact]
    public async Task WhenTheRateSourceIsDownForAnOldDate_ShouldAnswerWithWhatIsStored()
    {
        var (client, _) = await factory.NewAccountAsync();
        await client.CreatePortfolioAsync("Usd", "USD");
        await client.GetJsonAsync<FxRatesDto>("/api/fx?date=2025-03-05");
        factory.Fx.Failure = new HttpRequestException("down");
        try
        {
            var rates = await client.GetJsonAsync<FxRatesDto>("/api/fx?date=2024-02-01");

            rates.Date.ShouldBe(new DateOnly(2024, 2, 1));
            rates.RatesDate.ShouldBeNull();
            rates.Rates.ShouldHaveSingleItem().ShouldBe(new FxRateDto("CAD", "CAD", 1m));
        }
        finally
        {
            factory.Fx.Failure = null;
        }
    }
}

[Collection(FolioApiCollection.Name)]
public class MarketRefreshTests(FolioApiFactory factory)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static DateOnly Today => ApiClient.Today;

    private RefreshCoordinator Coordinator => factory.Services.GetRequiredService<RefreshCoordinator>();

    private async Task<RefreshRun> RefreshAsync()
    {
        (await Coordinator.RunAsync("Test", Ct)).ShouldBeTrue();
        return await factory.WithDbAsync(db => db.RefreshRuns.AsNoTracking().OrderByDescending(r => r.Id).FirstAsync(Ct));
    }

    private async Task<HttpClient> HolderOfAsync(params string[] symbols)
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Refresh");
        foreach (var symbol in symbols)
            await client.BuyAsync(portfolio, symbol, 1, 10m);
        return client;
    }

    [Fact]
    public async Task WhenEveryQuoteAndRateArrives_ShouldRecordASuccessfulRunWithTheLatestCloses()
    {
        await HolderOfAsync("SHOP.TO", "AAPL");

        var run = await RefreshAsync();

        run.Status.ShouldBe(RefreshStatus.Succeeded);
        run.Trigger.ShouldBe("Test");
        run.SecuritiesFailed.ShouldBe(0);
        run.SecuritiesUpdated.ShouldBeGreaterThanOrEqualTo(2);
        run.FinishedAt.ShouldNotBeNull();
        run.Log.ShouldNotBeNull();
        run.Log!.ShouldContain("SHOP.TO: 101.00 on 2026-10-09.");
        run.Log!.ShouldContain("AAPL: 202.00 on 2026-10-09.");
        run.Log!.ShouldContain("Exchange rates: ");
    }

    [Fact]
    public async Task WhenAProviderHasNoNewCloses_ShouldLogThatAndStillCountTheSecurityAsUpdated()
    {
        await HolderOfAsync("EMPTYX");

        var run = await RefreshAsync();

        run.Log!.ShouldContain("EMPTYX: no new closes.");
        run.Status.ShouldBe(RefreshStatus.Succeeded);
    }

    [Fact]
    public async Task WhenOneSecurityFails_ShouldCountItAndKeepTheMessageOnTheSecurity()
    {
        var client = await HolderOfAsync("REFRX", "AAPL");
        factory.Quotes.Failures["REFRX"] = new HttpRequestException("quote service is down");
        try
        {
            var run = await RefreshAsync();

            run.Status.ShouldBe(RefreshStatus.PartiallySucceeded);
            run.SecuritiesFailed.ShouldBeGreaterThanOrEqualTo(1);
            run.SecuritiesUpdated.ShouldBeGreaterThanOrEqualTo(1);
            run.Log!.ShouldContain("REFRX: quote service is down");
            var security = await client.ResolveAsync("REFRX");
            security.LastRefreshError.ShouldBe("quote service is down");
        }
        finally
        {
            factory.Quotes.Failures.TryRemove("REFRX", out _);
        }

        (await RefreshAsync()).Status.ShouldBe(RefreshStatus.Succeeded);
        (await client.ResolveAsync("REFRX")).LastRefreshError.ShouldBeNull();
    }

    [Fact]
    public async Task WhenEveryQuoteFails_ShouldMarkTheRunFailed()
    {
        await HolderOfAsync("REFRX");
        factory.Quotes.BeforeHistory = _ => throw new HttpRequestException("everything is down");
        try
        {
            var run = await RefreshAsync();

            run.Status.ShouldBe(RefreshStatus.Failed);
            run.SecuritiesUpdated.ShouldBe(0);
            run.SecuritiesFailed.ShouldBeGreaterThanOrEqualTo(1);
        }
        finally
        {
            factory.Quotes.BeforeHistory = null;
            (await Coordinator.RunAsync("Cleanup", Ct)).ShouldBeTrue();   // clears the errors the outage left on every security
        }
    }

    [Fact]
    public async Task WhenExchangeRatesCannotBeFetched_ShouldFailTheRunEvenIfQuotesArrive()
    {
        await HolderOfAsync("REFRY");
        factory.Fx.Failure = new HttpRequestException("rates are down");
        try
        {
            var run = await RefreshAsync();

            run.Status.ShouldBe(RefreshStatus.Failed);
            run.FxRatesStored.ShouldBe(0);
            run.SecuritiesUpdated.ShouldBeGreaterThanOrEqualTo(1);
            run.Log!.ShouldContain("Exchange rates failed: rates are down");
        }
        finally
        {
            factory.Fx.Failure = null;
        }
    }

    [Fact]
    public async Task WhenAQuoteFailsAndTheSecondSourceIsConfigured_ShouldUseItsCloseAndClearTheError()
    {
        var client = await HolderOfAsync("REFRX");
        factory.Quotes.Failures["REFRX"] = new HttpRequestException("quote service is down");
        factory.Fallback.IsConfigured = true;
        factory.Fallback.Latest = new PricePoint(Today, 55m);
        try
        {
            var run = await RefreshAsync();

            run.Log!.ShouldContain("REFRX: 55 on 2026-10-09 from Alpha Vantage.");
            factory.Fallback.Calls.ShouldContain("REFRX");
            var bar = await factory.WithDbAsync(db => db.PriceBars.AsNoTracking()
                .SingleAsync(b => b.Date == Today && db.Securities.IgnoreQueryFilters().Any(s => s.Id == b.SecurityId && s.Symbol == "REFRX"), Ct));
            (bar.Close, bar.Source).ShouldBe((55m, PriceSource.AlphaVantage));
            (await client.ResolveAsync("REFRX")).LastRefreshError.ShouldBeNull();
        }
        finally
        {
            factory.Quotes.Failures.TryRemove("REFRX", out _);
            factory.Fallback.IsConfigured = false;
            factory.Fallback.Latest = null;
            factory.Fallback.Calls.Clear();
        }
    }

    [Fact]
    public async Task WhenTheSecondSourceHasNoQuoteEitherOrFails_ShouldCountTheSecurityAsFailed()
    {
        await HolderOfAsync("REFRX", "AAPL");
        factory.Quotes.Failures["REFRX"] = new HttpRequestException("quote service is down");
        factory.Fallback.IsConfigured = true;
        try
        {
            var none = await RefreshAsync();
            none.Status.ShouldBe(RefreshStatus.PartiallySucceeded);
            factory.Fallback.Calls.ShouldContain("REFRX");

            factory.Fallback.Failure = new HttpRequestException("second source is down");
            var failing = await RefreshAsync();
            failing.Status.ShouldBe(RefreshStatus.PartiallySucceeded);
            failing.Log!.ShouldNotContain("from Alpha Vantage");
        }
        finally
        {
            factory.Quotes.Failures.TryRemove("REFRX", out _);
            factory.Fallback.IsConfigured = false;
            factory.Fallback.Failure = null;
            factory.Fallback.Calls.Clear();
        }
    }

    [Fact]
    public async Task WhenTheSecondSourceCallLimitIsReached_ShouldNotAskAgain()
    {
        await HolderOfAsync("REFRX");
        var options = factory.Services.GetRequiredService<IOptions<MarketDataOptions>>().Value;
        var original = options.AlphaVantageMaxCallsPerRun;
        options.AlphaVantageMaxCallsPerRun = 0;
        factory.Quotes.Failures["REFRX"] = new HttpRequestException("quote service is down");
        factory.Fallback.IsConfigured = true;
        factory.Fallback.Latest = new PricePoint(Today, 55m);
        try
        {
            var run = await RefreshAsync();

            run.Status.ShouldBe(RefreshStatus.PartiallySucceeded);
            factory.Fallback.Calls.ShouldBeEmpty();
        }
        finally
        {
            options.AlphaVantageMaxCallsPerRun = original;
            factory.Quotes.Failures.TryRemove("REFRX", out _);
            factory.Fallback.IsConfigured = false;
            factory.Fallback.Latest = null;
        }
    }

    [Fact]
    public async Task WhenTheRefreshIsCancelledMidway_ShouldLeaveAFinishedFailedRunBehind()
    {
        await HolderOfAsync("AAPL");
        using var cts = new CancellationTokenSource();
        factory.Fx.BeforeRates = () =>
        {
            cts.Cancel();
            return Task.CompletedTask;
        };
        try
        {
            var ex = await Record.ExceptionAsync(() => Coordinator.RunAsync("Cancelled", cts.Token));
            ex.ShouldBeAssignableTo<OperationCanceledException>();
        }
        finally
        {
            factory.Fx.BeforeRates = null;
        }

        var run = await factory.WithDbAsync(db => db.RefreshRuns.AsNoTracking().OrderByDescending(r => r.Id).FirstAsync(Ct));
        (run.Trigger, run.Status).ShouldBe(("Cancelled", RefreshStatus.Failed));
        run.FinishedAt.ShouldNotBeNull();
        Coordinator.IsRunning.ShouldBeFalse();
    }

    [Fact]
    public async Task WhenASecurityHasNeitherPricesNorAHistoryStart_ShouldFetchThePastMonthForIt()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("No start");
        var security = await factory.SeedSecurityAsync(source: PriceSource.Yahoo, symbol: "NOSTART");
        await factory.WithDbAsync(async db =>
        {
            await db.Securities.IgnoreQueryFilters().Where(s => s.Id == security.Id).ExecuteUpdateAsync(set => set.SetProperty(s => s.HistoryStart, (DateOnly?)null), Ct);
            db.Transactions.Add(new Transaction
            {
                Id = Guid.CreateVersion7(), PortfolioId = portfolio, Type = TransactionType.Buy, Date = new DateOnly(2026, 2, 2), Sequence = 1,
                SecurityId = security.Id, Currency = "CAD", Quantity = 1, Price = 1, CreatedAt = factory.Time.GetUtcNow(), UpdatedAt = factory.Time.GetUtcNow(),
            });
            await db.SaveChangesAsync(Ct);
        });

        var run = await RefreshAsync();

        run.Log!.ShouldContain("NOSTART: 50.50 on 2026-10-09.");
        var bars = await factory.WithDbAsync(db => db.PriceBars.Where(b => b.SecurityId == security.Id).Select(b => b.Date).ToListAsync(Ct));
        bars.Min().ShouldBeGreaterThanOrEqualTo(new DateOnly(2026, 9, 9));
    }

    [Fact]
    public async Task WhenStoringAnUpdateFailsMidRun_ShouldReleaseTheGateAndLetTheNextRefreshRun()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Poisoned");
        var security = await factory.SeedSecurityAsync(source: PriceSource.Yahoo, symbol: "NULNAME");
        await client.AddAsync(portfolio, new TransactionRequest(TransactionType.Buy, new DateOnly(2026, 2, 2), SecurityId: security.Id, Quantity: 1, Price: 1m));
        try
        {
            // The provider's name for this security contains a character the database cannot store; saving it fails,
            // and so does the attempt to close the run's record, because the same bad value is still waiting to be saved.
            var failure = await Record.ExceptionAsync(() => Coordinator.RunAsync("Poisoned", Ct));

            failure.ShouldBeOfType<DbUpdateException>().InnerException.ShouldBeOfType<Npgsql.PostgresException>().SqlState.ShouldBe("22021");
            Coordinator.IsRunning.ShouldBeFalse();
        }
        finally
        {
            await factory.WithDbAsync(async db =>
            {
                await db.Transactions.Where(t => t.SecurityId == security.Id).ExecuteDeleteAsync(Ct);
                await db.Securities.IgnoreQueryFilters().Where(s => s.Id == security.Id).ExecuteDeleteAsync(Ct);
            });
        }

        (await RefreshAsync()).Status.ShouldBe(RefreshStatus.Succeeded);
    }
}
