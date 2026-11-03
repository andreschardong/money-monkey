using System.Net;
using System.Text;
using Microsoft.Extensions.Logging;

namespace Folio.Api.Tests;

/// <summary>An HTTP handler that answers from a function and remembers what it was asked, so no test touches the network.</summary>
public sealed class StubHttpHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
{
    private readonly List<Uri> _requests = [];

    public IReadOnlyList<Uri> Requests
    {
        get
        {
            lock (_requests)
                return [.. _requests];
        }
    }

    public static StubHttpHandler Json(string body, HttpStatusCode status = HttpStatusCode.OK) =>
        new(_ => new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") });

    public static StubHttpHandler Status(HttpStatusCode status) => new(_ => new HttpResponseMessage(status));

    public static StubHttpHandler Throwing(Exception exception) => new(_ => throw exception);

    public HttpClient CreateClient() => new(this);

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        lock (_requests)
            _requests.Add(request.RequestUri!);
        return Task.FromResult(respond(request));
    }
}

/// <summary>A fake clock that counts the timers created from it, so a test knows when a background loop is waiting on it.</summary>
public sealed class CountingFakeTimeProvider(DateTimeOffset start) : Microsoft.Extensions.Time.Testing.FakeTimeProvider(start)
{
    private int _timers;

    public int TimersCreated => Volatile.Read(ref _timers);

    public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
    {
        Interlocked.Increment(ref _timers);
        return base.CreateTimer(callback, state, dueTime, period);
    }
}

public static class Eventually
{
    /// <summary>Polls until the condition holds, for work that finishes on another thread.</summary>
    public static async Task WaitAsync(Func<bool> condition, int timeoutMilliseconds = 30_000)
    {
        var deadline = Environment.TickCount64 + timeoutMilliseconds;
        while (!condition())
        {
            if (Environment.TickCount64 > deadline)
                throw new TimeoutException("The expected state was not reached in time.");
            await Task.Delay(25, TestContext.Current.CancellationToken);
        }
    }

    public static async Task WaitAsync(Func<Task<bool>> condition, int timeoutMilliseconds = 30_000)
    {
        var deadline = Environment.TickCount64 + timeoutMilliseconds;
        while (!await condition())
        {
            if (Environment.TickCount64 > deadline)
                throw new TimeoutException("The expected state was not reached in time.");
            await Task.Delay(25, TestContext.Current.CancellationToken);
        }
    }
}

/// <summary>A logger that keeps what it was given, so tests can check what was reported.</summary>
public sealed class ListLogger<T> : ILogger<T>
{
    private readonly List<(LogLevel Level, string Message, Exception? Exception)> _entries = [];

    public IReadOnlyList<(LogLevel Level, string Message, Exception? Exception)> Entries
    {
        get
        {
            lock (_entries)
                return [.. _entries];
        }
    }

    public IDisposable? BeginScope<TState>(TState state)
        where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => true;

    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
    {
        lock (_entries)
            _entries.Add((logLevel, formatter(state, exception), exception));
    }
}
