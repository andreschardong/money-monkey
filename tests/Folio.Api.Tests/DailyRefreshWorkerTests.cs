using Folio.Api.Data;
using Folio.Api.MarketData;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

using NSubstitute;

namespace Folio.Api.Tests;

/// <summary>The real app with its refresh worker switched on and the clock under the test's control.</summary>
public sealed class SchedulerApiFactory(DateTimeOffset now, Action<IWebHostBuilder>? settings = null) : FolioApiFactory
{
    protected override bool EnableScheduler => true;

    protected override void ConfigureSettings(IWebHostBuilder builder)
    {
        Time.SetUtcNow(now);
        settings?.Invoke(builder);
    }
}

public class DailyRefreshWorkerTests
{
    private static readonly DateTimeOffset FridayEvening = new(2026, 10, 9, 22, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset MondayMorning = new(2026, 10, 12, 14, 0, 0, TimeSpan.Zero);

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static async Task<SchedulerApiFactory> StartAsync(DateTimeOffset now, Action<IWebHostBuilder>? settings = null)
    {
        var factory = new SchedulerApiFactory(now, settings);
        await factory.InitializeAsync();
        _ = factory.Services;   // builds and starts the host, and with it the worker
        await Eventually.WaitAsync(() => factory.Time.TimersCreated >= 2);   // the worker is now waiting on its first delay
        return factory;
    }

    private static async Task<List<RefreshRun>> RunsAsync(FolioApiFactory factory)
    {
        using var scope = factory.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<FolioDbContext>().RefreshRuns.AsNoTracking().OrderBy(r => r.Id).ToListAsync(Ct);
    }

    private static async Task SeedAsync(FolioApiFactory factory, DateTimeOffset startedAt, RefreshStatus status)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<FolioDbContext>();
        db.RefreshRuns.Add(new RefreshRun { StartedAt = startedAt, FinishedAt = startedAt.AddMinutes(1), Trigger = "Seed", Status = status });
        await db.SaveChangesAsync(Ct);
    }

    private static Task WaitForRunsAsync(FolioApiFactory factory, int count) =>
        Eventually.WaitAsync(async () => (await RunsAsync(factory)).Count(r => r.Status != RefreshStatus.Running) >= count);

    [Fact]
    public async Task WhenTheEveningRefreshWasMissed_ShouldRunItOnceShortlyAfterStartUp()
    {
        await using var factory = await StartAsync(FridayEvening);

        factory.Time.Advance(TimeSpan.FromSeconds(5));
        await WaitForRunsAsync(factory, 1);

        var run = (await RunsAsync(factory)).ShouldHaveSingleItem();
        run.Trigger.ShouldBe("Scheduled");
        run.Status.ShouldBe(RefreshStatus.Succeeded);

        // Done for the day and the market is shut: later checks start nothing.
        factory.Time.Advance(TimeSpan.FromMinutes(5));
        await Task.Delay(300, Ct);
        (await RunsAsync(factory)).Count.ShouldBe(1);
    }

    [Fact]
    public async Task WhenTheMarketIsOpenAndTheLastRefreshIsOldEnough_ShouldRefreshIntradayAtTheConfiguredInterval()
    {
        await using var factory = await StartAsync(MondayMorning);
        await SeedAsync(factory, new DateTimeOffset(2026, 10, 9, 21, 45, 0, TimeSpan.Zero), RefreshStatus.Succeeded);

        factory.Time.Advance(TimeSpan.FromSeconds(5));
        await WaitForRunsAsync(factory, 2);
        (await RunsAsync(factory))[1].Trigger.ShouldBe("Intraday");

        // Five minutes later the last attempt is too recent.
        factory.Time.Advance(TimeSpan.FromMinutes(5));
        await Task.Delay(300, Ct);
        (await RunsAsync(factory)).Count.ShouldBe(2);

        // Fifteen minutes after it, the next one is due.
        factory.Time.Advance(TimeSpan.FromMinutes(10));
        await WaitForRunsAsync(factory, 3);
        (await RunsAsync(factory))[2].Trigger.ShouldBe("Intraday");
    }

    [Fact]
    public async Task WhenIntradayRefreshIsTurnedOff_ShouldNotRefreshDuringTheDay()
    {
        await using var factory = await StartAsync(MondayMorning, b => b.UseSetting("MarketData:IntradayRefreshMinutes", "0"));
        await SeedAsync(factory, new DateTimeOffset(2026, 10, 9, 21, 45, 0, TimeSpan.Zero), RefreshStatus.Succeeded);

        factory.Time.Advance(TimeSpan.FromSeconds(5));
        await Task.Delay(500, Ct);

        (await RunsAsync(factory)).Count.ShouldBe(1);
    }

    [Fact]
    public async Task WhenNoRefreshHasEverRunWhileTheMarketIsOpen_ShouldRunTheScheduledOneFirst()
    {
        await using var factory = await StartAsync(MondayMorning);

        factory.Time.Advance(TimeSpan.FromSeconds(5));
        await WaitForRunsAsync(factory, 1);

        (await RunsAsync(factory)).ShouldHaveSingleItem().Trigger.ShouldBe("Scheduled");
    }

    [Fact]
    public async Task WhenTheLastAttemptFailedRecently_ShouldWaitHalfAnHourBeforeTryingAgain()
    {
        await using var factory = await StartAsync(FridayEvening);
        await SeedAsync(factory, FridayEvening.AddMinutes(-10), RefreshStatus.Failed);

        factory.Time.Advance(TimeSpan.FromSeconds(5));
        await Task.Delay(500, Ct);
        (await RunsAsync(factory)).Count.ShouldBe(1);

        factory.Time.Advance(TimeSpan.FromMinutes(25));
        await WaitForRunsAsync(factory, 2);
        (await RunsAsync(factory))[1].Trigger.ShouldBe("Scheduled");
    }

    [Fact]
    public async Task WhenAPartialRefreshAlreadyHappenedSinceTheScheduledTime_ShouldNotRunAnother()
    {
        await using var factory = await StartAsync(FridayEvening);
        await SeedAsync(factory, new DateTimeOffset(2026, 10, 9, 21, 40, 0, TimeSpan.Zero), RefreshStatus.PartiallySucceeded);

        factory.Time.Advance(TimeSpan.FromSeconds(5));
        await Task.Delay(500, Ct);

        (await RunsAsync(factory)).Count.ShouldBe(1);
    }

    [Fact]
    public async Task WhenNoRefreshHasEverRunAndTheMarketIsOpen_ShouldCallAnIntradayRefreshDue()
    {
        await using var factory = await StartAsync(MondayMorning);
        var worker = factory.Services.GetServices<IHostedService>().OfType<DailyRefreshWorker>().Single();

        (await worker.IsIntradayDueAsync(Ct)).ShouldBeTrue();
    }

    private sealed class Rig
    {
        public CountingFakeTimeProvider Time { get; } = new(FridayEvening);

        public IServiceScopeFactory Scopes { get; } = Substitute.For<IServiceScopeFactory>();

        public ListLogger<DailyRefreshWorker> Log { get; } = new();

        public DailyRefreshWorker Worker { get; }

        public Rig(bool enabled = true)
        {
            var options = Options.Create(new MarketDataOptions { EnableScheduler = enabled });
            var coordinator = new RefreshCoordinator(Scopes, Substitute.For<IHostApplicationLifetime>(), new ListLogger<RefreshCoordinator>());
            Worker = new DailyRefreshWorker(coordinator, Scopes, new MarketClock(Time, options), Time, options, Log);
        }
    }

    [Fact]
    public async Task WhenSchedulerIsDisabled_ShouldFinishAtOnceAndNeverLookAtTheDatabase()
    {
        var rig = new Rig(enabled: false);

        await rig.Worker.StartAsync(Ct);
        await rig.Worker.ExecuteTask!;

        rig.Scopes.DidNotReceive().CreateScope();
    }

    [Fact]
    public async Task WhenStoppedBeforeTheFirstCheck_ShouldEndQuietly()
    {
        var rig = new Rig();
        await rig.Worker.StartAsync(Ct);
        await Eventually.WaitAsync(() => rig.Time.TimersCreated >= 2);

        await rig.Worker.StopAsync(Ct);

        rig.Worker.ExecuteTask!.IsCompletedSuccessfully.ShouldBeTrue();
        rig.Scopes.DidNotReceive().CreateScope();
    }

    [Fact]
    public async Task WhenACheckFails_ShouldLogItAndCheckAgainAtTheNextTick()
    {
        var rig = new Rig();
        rig.Scopes.CreateScope().Returns(_ => throw new InvalidOperationException("database is down"));
        await rig.Worker.StartAsync(Ct);
        await Eventually.WaitAsync(() => rig.Time.TimersCreated >= 2);

        rig.Time.Advance(TimeSpan.FromSeconds(5));
        await Eventually.WaitAsync(() => rig.Log.Entries.Count == 1);
        rig.Time.Advance(TimeSpan.FromMinutes(5));
        await Eventually.WaitAsync(() => rig.Log.Entries.Count == 2);

        rig.Log.Entries.ShouldAllBe(e => e.Level == LogLevel.Error && e.Message == "Scheduled refresh check failed");
        await rig.Worker.StopAsync(Ct);
        rig.Worker.ExecuteTask!.IsCompletedSuccessfully.ShouldBeTrue();
    }

    [Fact]
    public async Task WhenACheckIsCancelledForAnotherReason_ShouldNotSwallowIt()
    {
        var rig = new Rig();
        rig.Scopes.CreateScope().Returns(_ => throw new OperationCanceledException());
        await rig.Worker.StartAsync(Ct);
        await Eventually.WaitAsync(() => rig.Time.TimersCreated >= 2);

        rig.Time.Advance(TimeSpan.FromSeconds(5));

        await Should.ThrowAsync<OperationCanceledException>(() => rig.Worker.ExecuteTask!);
    }
}
