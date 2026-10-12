using System.Globalization;
using Folio.Api.MarketData;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Time.Testing;

namespace Folio.Api.Tests;

public class MarketClockTests
{
    private static MarketClock At(string utc) =>
        new(new FakeTimeProvider(DateTimeOffset.Parse(utc, CultureInfo.InvariantCulture)), Options.Create(new MarketDataOptions()));

    [Theory]
    [InlineData("2026-10-12T13:29:00Z", false)]   // Monday 9:29 in Toronto (UTC-4): not open yet
    [InlineData("2026-10-12T13:30:00Z", true)]    // the open
    [InlineData("2026-10-12T20:30:00Z", true)]    // 4:30 p.m., the last delayed prices
    [InlineData("2026-10-12T20:31:00Z", false)]
    [InlineData("2026-10-10T15:00:00Z", false)]   // a Saturday
    [InlineData("2026-12-14T14:30:00Z", true)]    // 9:30 in winter (UTC-5)
    public void Intraday_refreshes_run_on_weekdays_from_the_open_until_just_after_the_close(string utc, bool expected) =>
        Assert.Equal(expected, At(utc).IsTradingHours());
}
