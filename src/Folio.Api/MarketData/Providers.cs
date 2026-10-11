using Folio.Api.Data;
using Folio.Core;

namespace Folio.Api.MarketData;

public sealed record SymbolMatch(string Symbol, string Name, string? Exchange, AssetType AssetType);

public sealed record SecurityInfo(string Symbol, string Name, string Currency, string? Exchange, AssetType AssetType);

public sealed record SplitInfo(DateOnly Date, decimal Numerator, decimal Denominator);

/// <summary>Dividend per share, in the security's currency and restated to the share count of its own date.</summary>
public sealed record DividendInfo(DateOnly Date, decimal Amount);

/// <summary>Daily closes as actually traded (not adjusted for later splits), plus the splits and dividends in the period.</summary>
public sealed record PriceHistory(
    SecurityInfo Info,
    IReadOnlyList<PricePoint> Bars,
    IReadOnlyList<SplitInfo> Splits,
    IReadOnlyList<DividendInfo> Dividends);

public readonly record struct FxObservation(string Currency, DateOnly Date, decimal CadPerUnit, string Source);

/// <summary>The primary quote source: search, metadata and daily history.</summary>
public interface IQuoteProvider
{
    Task<IReadOnlyList<SymbolMatch>> SearchAsync(string query, CancellationToken ct);

    /// <exception cref="SymbolNotFoundException">The provider does not know the symbol.</exception>
    Task<PriceHistory> GetHistoryAsync(string symbol, DateOnly from, DateOnly to, CancellationToken ct);
}

/// <summary>A secondary source that can supply the latest close when the primary one fails.</summary>
public interface IFallbackQuoteProvider
{
    bool IsConfigured { get; }

    /// <param name="currency">The security's currency, which tells whether a London quote is in pence.</param>
    Task<PricePoint?> GetLatestAsync(string symbol, string currency, CancellationToken ct);
}

public interface IFxProvider
{
    /// <summary>Canadian dollars per unit of each currency, for every business day in the range.</summary>
    Task<IReadOnlyList<FxObservation>> GetCadRatesAsync(IReadOnlyCollection<string> currencies, DateOnly from, DateOnly to, CancellationToken ct);
}

public class MarketDataException(string message, Exception? inner = null) : Exception(message, inner);

public sealed class SymbolNotFoundException(string symbol)
    : MarketDataException($"No quotes were found for \"{symbol}\". Check the symbol, or add it with a manual price.")
{
    public string Symbol { get; } = symbol;
}

public static class MarketDataErrors
{
    /// <summary>Failures caused by the network or a provider, as opposed to bugs: worth a friendly message and a retry.</summary>
    public static bool IsTransient(Exception ex) =>
        ex is MarketDataException or HttpRequestException or System.Text.Json.JsonException or TimeoutException
            or Polly.Timeout.TimeoutRejectedException or Polly.CircuitBreaker.BrokenCircuitException
        || ex is TaskCanceledException { InnerException: TimeoutException };
}
