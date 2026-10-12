using Microsoft.Extensions.Options;

namespace Folio.Api.MarketData;

/// <summary>"Today" and the refresh schedule, both in the market time zone (Toronto by default).</summary>
public sealed class MarketClock(TimeProvider time, IOptions<MarketDataOptions> options)
{
    private readonly TimeZoneInfo _zone = TimeZoneInfo.FindSystemTimeZoneById(options.Value.TimeZone);
    private readonly TimeSpan _refreshAt = options.Value.DailyRefreshTime.ToTimeSpan();
    private readonly TimeSpan _open = options.Value.MarketOpen.ToTimeSpan();
    private readonly TimeSpan _intradayUntil = options.Value.IntradayUntil.ToTimeSpan();

    /// <summary>A weekday between the open and a little after the close, when quotes are worth refreshing often.</summary>
    public bool IsTradingHours()
    {
        var local = LocalNow.DateTime;
        return !IsWeekend(local) && local.TimeOfDay >= _open && local.TimeOfDay <= _intradayUntil;
    }

    public DateTimeOffset UtcNow => time.GetUtcNow();

    public DateTimeOffset LocalNow => TimeZoneInfo.ConvertTime(UtcNow, _zone);

    public DateOnly Today => DateOnly.FromDateTime(LocalNow.DateTime);

    /// <summary>The most recent weekday refresh time that has already passed.</summary>
    public DateTimeOffset PreviousScheduledRun()
    {
        var local = LocalNow.DateTime;
        var candidate = local.Date + _refreshAt;
        if (candidate > local)
            candidate = candidate.AddDays(-1);
        while (IsWeekend(candidate))
            candidate = candidate.AddDays(-1);
        return ToOffset(candidate);
    }

    public DateTimeOffset NextScheduledRun()
    {
        var local = LocalNow.DateTime;
        var candidate = local.Date + _refreshAt;
        if (candidate <= local)
            candidate = candidate.AddDays(1);
        while (IsWeekend(candidate))
            candidate = candidate.AddDays(1);
        return ToOffset(candidate);
    }

    private DateTimeOffset ToOffset(DateTime local) => new(local, _zone.GetUtcOffset(local));

    private static bool IsWeekend(DateTime day) => day.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday;
}
