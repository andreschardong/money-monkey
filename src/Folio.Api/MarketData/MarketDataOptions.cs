namespace Folio.Api.MarketData;

public sealed class MarketDataOptions
{
    public const string Section = "MarketData";

    /// <summary>Time zone used for "today" and for the daily refresh schedule.</summary>
    public string TimeZone { get; set; } = "America/Toronto";

    /// <summary>Local time of the daily refresh, after North American markets close and the Bank of Canada publishes rates.</summary>
    public TimeOnly DailyRefreshTime { get; set; } = new(17, 30);

    /// <summary>Minutes between quote refreshes while markets are open, so "Today" follows the day; 0 turns them off.</summary>
    public int IntradayRefreshMinutes { get; set; } = 15;

    /// <summary>Start of the intraday window, the North American open, in the market time zone.</summary>
    public TimeOnly MarketOpen { get; set; } = new(9, 30);

    /// <summary>End of the intraday window: a little after the close, since free quotes arrive about 15 minutes late.</summary>
    public TimeOnly IntradayUntil { get; set; } = new(16, 30);

    /// <summary>Run the scheduled daily refresh (and catch up on start-up when one was missed).</summary>
    public bool EnableScheduler { get; set; } = true;

    /// <summary>Pause between Yahoo Finance requests during a refresh, to stay polite.</summary>
    public int RequestDelayMilliseconds { get; set; } = 350;

    /// <summary>Optional. Used only when Yahoo Finance fails for a symbol; the free tier allows 25 calls a day.</summary>
    public string? AlphaVantageApiKey { get; set; }

    /// <summary>Upper bound on Alpha Vantage calls in a single refresh.</summary>
    public int AlphaVantageMaxCallsPerRun { get; set; } = 20;
}
