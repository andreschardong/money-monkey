using Folio.Api.Data;
using Folio.Api.Portfolios;
using Folio.Core;

namespace Folio.Api.Endpoints;

internal static class HistoryQuery
{
    public static readonly string[] Ranges = ["1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y", "ALL"];

    public static async Task<HistoryDto> BuildAsync(
        IReadOnlyList<(string BaseCurrency, List<Transaction> Transactions, CashLedger Cash)> portfolios,
        string displayCurrency,
        string? range,
        PortfolioCalculator calculator,
        CancellationToken ct)
    {
        var key = Ranges.Contains(range?.ToUpperInvariant()) ? range!.ToUpperInvariant() : "1Y";
        var all = portfolios.SelectMany(p => p.Transactions).ToList();
        var firstCash = portfolios.Select(p => p.Cash.FirstDate).Where(d => d is not null).Min();
        if (all.Count == 0 && firstCash is null)
            return new HistoryDto(displayCurrency, key, []);

        var today = calculator.Today;
        var first = all.Count == 0 ? firstCash!.Value : firstCash is { } fc && fc < all.Min(t => t.Date) ? fc : all.Min(t => t.Date);
        var from = key switch
        {
            "1M" => today.AddMonths(-1),
            "3M" => today.AddMonths(-3),
            "6M" => today.AddMonths(-6),
            "YTD" => new DateOnly(today.Year, 1, 1),
            "3Y" => today.AddYears(-3),
            "5Y" => today.AddYears(-5),
            "ALL" => first,
            _ => today.AddYears(-1),
        };
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
