using Folio.Api.MarketData;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NSubstitute;

namespace Folio.Api.Tests;

public class RefreshCoordinatorTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static (RefreshCoordinator Coordinator, IServiceScopeFactory Scopes, ListLogger<RefreshCoordinator> Log) Create()
    {
        var scopes = Substitute.For<IServiceScopeFactory>();
        var log = new ListLogger<RefreshCoordinator>();
        return (new RefreshCoordinator(scopes, Substitute.For<IHostApplicationLifetime>(), log), scopes, log);
    }

    [Fact]
    public async Task WhenARefreshFails_ShouldPropagateAndFreeTheGate()
    {
        var (coordinator, scopes, _) = Create();
        scopes.CreateScope().Returns(_ => throw new InvalidOperationException("no scope"));

        await Should.ThrowAsync<InvalidOperationException>(() => coordinator.RunAsync("Manual", Ct));

        coordinator.IsRunning.ShouldBeFalse();
    }

    [Fact]
    public async Task WhenARefreshIsRunning_ShouldRefuseASecondOneFromEitherEntryPoint()
    {
        var (coordinator, scopes, _) = Create();
        var entered = new TaskCompletionSource();
        var release = new ManualResetEventSlim();
        scopes.CreateScope().Returns(_ =>
        {
            entered.SetResult();
            release.Wait(TimeSpan.FromSeconds(30));
            throw new InvalidOperationException("done");
        });

        var first = Task.Run(() => coordinator.RunAsync("Manual", Ct), Ct);
        await entered.Task;

        coordinator.IsRunning.ShouldBeTrue();
        (await coordinator.RunAsync("Manual", Ct)).ShouldBeFalse();
        coordinator.Start("Manual").ShouldBeFalse();

        release.Set();
        await Should.ThrowAsync<InvalidOperationException>(() => first);
        coordinator.IsRunning.ShouldBeFalse();
    }

    [Fact]
    public async Task WhenABackgroundRefreshFails_ShouldLogItAndFreeTheGate()
    {
        var (coordinator, scopes, log) = Create();
        scopes.CreateScope().Returns(_ => throw new InvalidOperationException("no scope"));

        coordinator.Start("Manual").ShouldBeTrue();
        await Eventually.WaitAsync(() => log.Entries.Count == 1 && !coordinator.IsRunning);

        var entry = log.Entries.ShouldHaveSingleItem();
        entry.Level.ShouldBe(LogLevel.Error);
        entry.Message.ShouldBe("Background refresh failed");
        entry.Exception.ShouldBeOfType<InvalidOperationException>();
    }

    [Fact]
    public async Task WhenABackgroundRefreshIsCancelledByShutdown_ShouldStaySilent()
    {
        var (coordinator, scopes, log) = Create();
        scopes.CreateScope().Returns(_ => throw new OperationCanceledException());

        coordinator.Start("Manual").ShouldBeTrue();
        await Eventually.WaitAsync(() => !coordinator.IsRunning);

        log.Entries.ShouldBeEmpty();
    }
}
