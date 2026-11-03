using Folio.Api.Data;
using Folio.Api.Portfolios;
using Folio.Core;

namespace Folio.Api.Endpoints;

internal static class HistoryQuery
{
    /// <summary>Where each chart range starts, from today and from the first activity (a start before that is moved up to it).</summary>
    private static readonly Dictionary<string, Func<DateOnly, DateOnly, DateOnly>> RangeStarts = new(StringComparer.Ordinal)
    {
        ["1M"] = (today, _) => today.AddMonths(-1),
        ["3M"] = (today, _) => today.AddMonths(-3),
        ["6M"] = (today, _) => today.AddMonths(-6),
        ["YTD"] = (today, _) => new DateOnly(today.Year, 1, 1),
        ["1Y"] = (today, _) => today.AddYears(-1),
        ["3Y"] = (today, _) => today.AddYears(-3),
        ["5Y"] = (today, _) => today.AddYears(-5),
        ["ALL"] = (_, first) => first,
    };

    /// <summary>The first day of a named range; an unknown or missing name means one year back.</summary>
    public static DateOnly RangeStart(string? range, DateOnly today, DateOnly first) =>
        range is not null && RangeStarts.TryGetValue(range.ToUpperInvariant(), out var start) ? start(today, first) : today.AddYears(-1);

    public static async Task<HistoryDto> BuildAsync(
        IReadOnlyList<(string BaseCurrency, List<Transaction> Transactions, CashLedger Cash)> portfolios,
        string displayCurrency,
        string? range,
        PortfolioCalculator calculator,
        CancellationToken ct)
    {
        var requested = range?.ToUpperInvariant();
        var key = requested is not null && RangeStarts.ContainsKey(requested) ? requested : "1Y";
        var all = portfolios.SelectMany(p => p.Transactions).ToList();
        var firstCash = portfolios.Select(p => p.Cash.FirstDate).Where(d => d is not null).Min();
        if (all.Count == 0 && firstCash is null)
            return new HistoryDto(displayCurrency, key, []);

        var today = calculator.Today;
        var first = all.Count == 0 ? firstCash!.Value : firstCash is { } fc && fc < all.Min(t => t.Date) ? fc : all.Min(t => t.Date);
        var from = RangeStarts[key](today, first);
        if (from < first)
            from = first;

        var securityIds = all.Where(t => t.SecurityId is not null).Select(t => t.SecurityId!.Value).Distinct().ToList();
        var prices = await calculator.LoadPricesAsync(securityIds, from, today, ct);

        // Contributions are converted at their own dates, which may precede the chart range.
        var currencies = all.Select(t => t.Currency)
            .Concat(portfolios.SelectMany(p => p.Cash.Currencies))
            .Concat(portfolios.Select(p => p.BaseCurrency))
            .Append(displayCurrency);
        await calculator.EnsureRatesAsync(currencies, first, ct);
        var fx = await calculator.LoadFxAsync(first, today, ct);
        var inputs = portfolios
            .Select(p => new LedgerInput(p.BaseCurrency, p.Transactions.Select(t => t.ToLedgerEntry()).ToList(), p.Cash))
            .ToList();

        var points = HistoryBuilder.Build(inputs, displayCurrency, from, today, prices, fx)
            .Select(p => new HistoryPointDto(p.Date, PortfolioMapper.Money(p.Value), PortfolioMapper.Money(p.NetContributions)))
            .ToList();
        return new HistoryDto(displayCurrency, key, points);
    }
}
