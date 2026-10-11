using Folio.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Folio.Api.MarketData;

/// <summary>Ensures only one market data refresh runs at a time, whether scheduled or requested from the UI.</summary>
public sealed class RefreshCoordinator(IServiceScopeFactory scopes, IHostApplicationLifetime lifetime, ILogger<RefreshCoordinator> logger)
{
    private readonly SemaphoreSlim _gate = new(1, 1);

    public bool IsRunning => _gate.CurrentCount == 0;

    /// <summary>Runs a refresh and waits for it; returns false when another one is already running.</summary>
    public async Task<bool> RunAsync(string trigger, CancellationToken ct)
    {
        if (!_gate.Wait(0, ct))
            return false;
        await RunHoldingGateAsync(trigger, ct);
        return true;
    }

    /// <summary>Starts a refresh without waiting for it; returns false when one is already running.</summary>
    public bool Start(string trigger)
    {
        // Taken here, not in the background task, so the status reads "running" as soon as this returns.
        if (!_gate.Wait(0))
            return false;

        _ = Task.Run(async () =>
        {
            try
            {
                await RunHoldingGateAsync(trigger, lifetime.ApplicationStopping);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Background refresh failed");
            }
        });
        return true;
    }

    private async Task RunHoldingGateAsync(string trigger, CancellationToken ct)
    {
        try
        {
            using var scope = scopes.CreateScope();
            await scope.ServiceProvider.GetRequiredService<MarketDataService>().RefreshAllAsync(trigger, ct);
        }
        finally
        {
            _gate.Release();
        }
    }
}

/// <summary>
/// Refreshes quotes once each weekday after the close. The PC may be off at that time, so a refresh that was
/// missed runs as soon as the app is up again.
/// </summary>
public sealed class DailyRefreshWorker(
    RefreshCoordinator coordinator,
    IServiceScopeFactory scopes,
    MarketClock clock,
    IOptions<MarketDataOptions> options,
    ILogger<DailyRefreshWorker> logger) : BackgroundService
{
    private static readonly TimeSpan CheckInterval = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan RetryAfterFailure = TimeSpan.FromMinutes(30);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.EnableScheduler)
            return;

        using var timer = new PeriodicTimer(CheckInterval);
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            do
            {
                try
                {
                    if (await IsDueAsync(stoppingToken))
                        await coordinator.RunAsync("Scheduled", stoppingToken);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    logger.LogError(ex, "Scheduled refresh check failed");
                }
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
    }

    private async Task<bool> IsDueAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<FolioDbContext>();
        var since = clock.PreviousScheduledRun().ToUniversalTime();
        var done = await db.RefreshRuns.AnyAsync(
            r => r.StartedAt >= since && (r.Status == RefreshStatus.Succeeded || r.Status == RefreshStatus.PartiallySucceeded), ct);
        if (done)
            return false;

        // Don't hammer the providers while offline: wait a while after a failed attempt.
        var lastAttempt = await db.RefreshRuns.MaxAsync(r => (DateTimeOffset?)r.StartedAt, ct);
        return lastAttempt is null || clock.UtcNow - lastAttempt > RetryAfterFailure;
    }
}
