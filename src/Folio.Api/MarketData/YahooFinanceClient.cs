using System.Net;
using System.Text.Json;
using Folio.Core;

namespace Folio.Api.MarketData;

/// <summary>
/// Yahoo Finance's public chart and search endpoints. No API key is needed and they cover the TSX, TSXV,
/// US and European exchanges. Closes come back adjusted for splits, so they are restated to the prices
/// actually traded using the split events in the same response.
/// </summary>
public sealed class YahooFinanceClient(HttpClient http) : IQuoteProvider
{
    public const string ChartHost = "https://query1.finance.yahoo.com";
    public const string SearchHost = "https://query2.finance.yahoo.com";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<IReadOnlyList<SymbolMatch>> SearchAsync(string query, CancellationToken ct)
    {
        var url = $"{SearchHost}/v1/finance/search?q={Uri.EscapeDataString(query)}&quotesCount=15&newsCount=0&listsCount=0&enableFuzzyQuery=false";
        using var response = await http.GetAsync(url, ct);
        if (!response.IsSuccessStatusCode)
            throw new MarketDataException($"Yahoo Finance search returned HTTP {(int)response.StatusCode}.");

        var body = await response.Content.ReadFromJsonAsync<SearchResponse>(Json, ct);
        return (body?.Quotes ?? [])
            .Where(q => !string.IsNullOrWhiteSpace(q.Symbol) && Exchanges.IsHoldable(q.QuoteType))
            .Select(q => new SymbolMatch(
                q.Symbol!.ToUpperInvariant(),
                Decode(q.LongName ?? q.ShortName) ?? q.Symbol!,
                Exchanges.Name(q.Exchange, q.ExchDisp),
                Exchanges.AssetTypeOf(q.QuoteType)))
            .ToList();
    }

    public async Task<PriceHistory> GetHistoryAsync(string symbol, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var period1 = ToUnix(from);
        var period2 = ToUnix(to.AddDays(1));
        var url = $"{ChartHost}/v8/finance/chart/{Uri.EscapeDataString(symbol)}?period1={period1}&period2={period2}&interval=1d&events=div%2Csplit&includePrePost=false";

        using var response = await http.GetAsync(url, ct);
        if (response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.UnprocessableEntity)
            throw new SymbolNotFoundException(symbol);
        if (!response.IsSuccessStatusCode)
            throw new MarketDataException($"Yahoo Finance returned HTTP {(int)response.StatusCode} for {symbol}.");

        var body = await response.Content.ReadFromJsonAsync<ChartResponse>(Json, ct);
        var result = body?.Chart?.Result?.FirstOrDefault();
        if (result?.Meta is null)
            throw new SymbolNotFoundException(symbol);
        return Parse(symbol, result, from, to);
    }

    internal static PriceHistory Parse(string symbol, ChartResult result, DateOnly from, DateOnly to)
    {
        var meta = result.Meta!;
        var (currency, divisor) = NormalizeCurrency(meta.Currency)
            ?? throw new MarketDataException($"Yahoo Finance did not report a currency for {symbol}.");
        var offset = TimeSpan.FromSeconds(meta.Gmtoffset ?? 0);
        DateOnly DateOf(long unix) => DateOnly.FromDateTime(DateTimeOffset.FromUnixTimeSeconds(unix).ToOffset(offset).DateTime);

        var splits = (result.Events?.Splits?.Values ?? Enumerable.Empty<YahooSplit>())
            .Where(s => s.Numerator > 0 && s.Denominator > 0)
            .Select(s => new SplitInfo(DateOf(s.Date), (decimal)s.Numerator, (decimal)s.Denominator))
            .OrderBy(s => s.Date)
            .ToList();

        // Yahoo restates history for every later split; multiplying by those splits gives the price actually traded.
        decimal SplitFactorAfter(DateOnly date) =>
            splits.Where(s => s.Date > date).Aggregate(1m, (factor, s) => factor * s.Numerator / s.Denominator);

        var bars = new SortedDictionary<DateOnly, decimal>();
        var timestamps = result.Timestamp ?? [];
        var closes = result.Indicators?.Quote?.FirstOrDefault()?.Close ?? [];
        for (var i = 0; i < timestamps.Count && i < closes.Count; i++)
        {
            if (closes[i] is not { } close || !(close > 0))
                continue;
            var date = DateOf(timestamps[i]);
            if (date >= from && date <= to)
                bars[date] = RoundPrice(close) / divisor * SplitFactorAfter(date);
        }

        // Today's bar can lag the live quote, or be missing entirely.
        if (meta.RegularMarketPrice is > 0 && meta.RegularMarketTime is { } marketTime)
        {
            var date = DateOf(marketTime);
            if (date >= from && date <= to && (bars.Count == 0 || date >= bars.Keys.Last()))
                bars[date] = RoundPrice(meta.RegularMarketPrice.Value) / divisor;
        }

        var dividends = (result.Events?.Dividends?.Values ?? Enumerable.Empty<YahooDividend>())
            .Where(d => d.Amount > 0)
            .Select(d => new { Date = DateOf(d.Date), d.Amount })
            .GroupBy(d => d.Date)
            .Select(g => new DividendInfo(g.Key, g.Sum(d => RoundPrice(d.Amount)) / divisor * SplitFactorAfter(g.Key)))
            .OrderBy(d => d.Date)
            .ToList();

        var info = new SecurityInfo(
            (meta.Symbol ?? symbol).ToUpperInvariant(),
            Decode(meta.LongName ?? meta.ShortName) ?? symbol.ToUpperInvariant(),
            currency,
            Exchanges.Name(meta.ExchangeName, meta.FullExchangeName),
            Exchanges.AssetTypeOf(meta.InstrumentType));

        return new PriceHistory(info, bars.Select(b => new PricePoint(b.Key, b.Value)).ToList(), splits, dividends);
    }

    /// <summary>London, Johannesburg and Tel Aviv quote in minor units (pence, cents, agorot).</summary>
    internal static (string Currency, decimal Divisor)? NormalizeCurrency(string? currency) => currency switch
    {
        null or "" => null,
        "GBp" or "GBX" => ("GBP", 100m),
        "ZAc" or "ZAC" => ("ZAR", 100m),
        "ILA" => ("ILS", 100m),
        _ => (currency.ToUpperInvariant(), 1m),
    };

    /// <summary>Yahoo stores single-precision floats; seven significant digits recovers the quoted price.</summary>
    internal static decimal RoundPrice(double value)
    {
        if (value == 0 || double.IsNaN(value) || double.IsInfinity(value))
            return 0m;
        var decimals = 6 - (int)Math.Floor(Math.Log10(Math.Abs(value)));
        return decimal.Round((decimal)value, Math.Clamp(decimals, 0, 10));
    }

    private static string? Decode(string? text) => text is null ? null : WebUtility.HtmlDecode(text).Trim();

    private static long ToUnix(DateOnly date) =>
        new DateTimeOffset(date.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero).ToUnixTimeSeconds();

    internal sealed class ChartResponse
    {
        public ChartBody? Chart { get; set; }
    }

    internal sealed class ChartBody
    {
        public List<ChartResult>? Result { get; set; }
    }

    internal sealed class ChartResult
    {
        public ChartMeta? Meta { get; set; }
        public List<long>? Timestamp { get; set; }
        public ChartEvents? Events { get; set; }
        public ChartIndicators? Indicators { get; set; }
    }

    internal sealed class ChartMeta
    {
        public string? Currency { get; set; }
        public string? Symbol { get; set; }
        public string? ExchangeName { get; set; }
        public string? FullExchangeName { get; set; }
        public string? InstrumentType { get; set; }
        public string? LongName { get; set; }
        public string? ShortName { get; set; }
        public double? RegularMarketPrice { get; set; }
        public long? RegularMarketTime { get; set; }
        public int? Gmtoffset { get; set; }
    }

    internal sealed class ChartEvents
    {
        public Dictionary<string, YahooSplit>? Splits { get; set; }
        public Dictionary<string, YahooDividend>? Dividends { get; set; }
    }

    internal sealed class YahooSplit
    {
        public long Date { get; set; }
        public double Numerator { get; set; }
        public double Denominator { get; set; }
    }

    internal sealed class YahooDividend
    {
        public long Date { get; set; }
        public double Amount { get; set; }
    }

    internal sealed class ChartIndicators
    {
        public List<QuoteIndicator>? Quote { get; set; }
    }

    internal sealed class QuoteIndicator
    {
        public List<double?>? Close { get; set; }
    }

    internal sealed class SearchResponse
    {
        public List<SearchQuote>? Quotes { get; set; }
    }

    internal sealed class SearchQuote
    {
        public string? Symbol { get; set; }
        public string? ShortName { get; set; }
        public string? LongName { get; set; }
        public string? Exchange { get; set; }
        public string? ExchDisp { get; set; }
        public string? QuoteType { get; set; }
    }
}
