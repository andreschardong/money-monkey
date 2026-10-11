using System.Globalization;
using System.Text.Json;
using Folio.Core;
using Microsoft.Extensions.Options;

namespace Folio.Api.MarketData;

/// <summary>
/// Alpha Vantage GLOBAL_QUOTE, used only when Yahoo Finance fails for a symbol. The free tier allows
/// 25 calls a day, so it supplies the latest close and nothing else.
/// </summary>
public sealed class AlphaVantageClient(HttpClient http, IOptions<MarketDataOptions> options, ILogger<AlphaVantageClient> logger)
    : IFallbackQuoteProvider
{
    // Yahoo suffix -> Alpha Vantage suffix, for the exchanges Alpha Vantage documents.
    private static readonly Dictionary<string, string> Suffixes = new(StringComparer.OrdinalIgnoreCase)
    {
        [".TO"] = ".TRT",
        [".V"] = ".TRV",
        [".L"] = ".LON",
        [".DE"] = ".DEX",
    };

    public bool IsConfigured => !string.IsNullOrWhiteSpace(options.Value.AlphaVantageApiKey);

    public async Task<PricePoint?> GetLatestAsync(string symbol, string currency, CancellationToken ct)
    {
        if (!IsConfigured || ToAlphaVantageSymbol(symbol) is not { } avSymbol)
            return null;

        var url = $"https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol={Uri.EscapeDataString(avSymbol)}&apikey={Uri.EscapeDataString(options.Value.AlphaVantageApiKey!)}";
        using var document = JsonDocument.Parse(await http.GetStringAsync(url, ct));
        var root = document.RootElement;

        if (!root.TryGetProperty("Global Quote", out var quote) || quote.ValueKind != JsonValueKind.Object
            || !quote.TryGetProperty("05. price", out var priceText)
            || !quote.TryGetProperty("07. latest trading day", out var dateText)
            || !decimal.TryParse(priceText.GetString(), NumberStyles.Number, CultureInfo.InvariantCulture, out var price)
            || !DateOnly.TryParseExact(dateText.GetString(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)
            || price <= 0)
        {
            // Rate limits and unknown symbols come back as a 200 with a "Note" or "Information" message.
            var note = root.TryGetProperty("Note", out var n) ? n.GetString()
                : root.TryGetProperty("Information", out var i) ? i.GetString()
                : "no quote returned";
            logger.LogWarning("Alpha Vantage had no quote for {Symbol}: {Note}", avSymbol, note);
            return null;
        }

        // London shares quote in pence (stored as GBP); London ETFs priced in USD or EUR do not.
        if (avSymbol.EndsWith(".LON", StringComparison.OrdinalIgnoreCase) && currency == "GBP")
            price /= 100m;
        return new PricePoint(date, price);
    }

    internal static string? ToAlphaVantageSymbol(string yahooSymbol)
    {
        var dot = yahooSymbol.LastIndexOf('.');
        if (dot < 0)
            return yahooSymbol;
        return Suffixes.TryGetValue(yahooSymbol[dot..], out var suffix) ? yahooSymbol[..dot] + suffix : null;
    }
}
