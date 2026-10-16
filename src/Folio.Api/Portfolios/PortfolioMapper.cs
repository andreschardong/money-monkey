using System.Globalization;
using Folio.Api.Data;
using Folio.Api.Endpoints;
using Folio.Core;

namespace Folio.Api.Portfolios;

public static class PortfolioMapper
{
    public static PortfolioSummaryDto ToSummary(PortfolioSnapshot snapshot)
    {
        var (portfolio, v) = (snapshot.Portfolio, snapshot.Valuation);
        return new PortfolioSummaryDto(
            portfolio.Id,
            portfolio.Name,
            portfolio.BaseCurrency,
            portfolio.Description,
            Money(v.TotalValue),
            Money(v.HoldingsValue),
            Money(v.CashValue),
            Money(v.DayChange),
            Ratio(v.DayChangePercent),
            v.TotalReturn is { } totalReturn ? Money(totalReturn) : null,
            Ratio(v.TotalReturnPercent),
            v.AnnualizedReturn is { } annual ? Math.Round(annual, 6) : null,
            Money(v.NetContributions),
            v.Holdings.Count,
            snapshot.Transactions.Count,
            v.PricesAsOf,
            snapshot.Ledger.FirstDate,
            snapshot.Access.Access,
            snapshot.Access.OwnerEmail,
            snapshot.Access.SharedWith,
            v.DayChangeDate,
            portfolio.Country);
    }

    public static PortfolioDetailDto ToDetail(PortfolioSnapshot snapshot)
    {
        var v = snapshot.Valuation;
        var weightBase = v.TotalValue > 0 ? v.TotalValue : v.HoldingsValue;
        var holdings = v.Holdings
            .Select(h => ToHolding(h, snapshot.Securities[h.Position.SecurityId], weightBase))
            .OrderByDescending(h => h.MarketValue)
            .ToList();
        var cash = v.Cash.Select(c => new CashBalanceDto(c.Currency, Money(c.Balance), c.AsOf, Rate(c.FxRate), Money(c.ValueBase))).ToList();

        return new PortfolioDetailDto(
            ToSummary(snapshot),
            Money(v.CostBasis),
            Money(v.UnrealizedGain),
            Ratio(v.UnrealizedPercent),
            Money(v.RealizedGain),
            Money(v.Dividends),
            Money(v.Interest),
            Money(v.Fees),
            Money(v.TaxWithheld),
            holdings,
            cash,
            Warnings(snapshot));
    }

    public static HoldingDto ToHolding(HoldingValuation h, Security security, decimal weightBase) => new(
        security.Id,
        security.Symbol,
        security.Name,
        security.Exchange,
        security.AssetType,
        h.Position.Currency,
        h.Position.Quantity,
        Price(h.Position.AverageCostLocal),
        Money(h.Position.CostBase),
        h.Price?.Close,
        h.Price?.Date,
        h.PreviousClose is { } previous ? Price(previous) : null,
        Ratio(h.DayChangePercent),
        Money(h.MarketValueBase),
        Money(h.MarketValueLocal),
        Money(h.DayChangeBase),
        Money(h.UnrealizedBase),
        Ratio(h.UnrealizedPercent),
        Money(h.Position.RealizedBase),
        Money(h.Position.DividendsBase),
        weightBase > 0 ? Ratio(h.MarketValueBase / weightBase)!.Value : 0m,
        Rate(h.FxRate),
        h.PriceMissing);

    public static TransactionDto ToDto(Transaction t) => new(
        t.Id,
        t.Type,
        t.Date,
        t.SecurityId,
        t.Security?.Symbol,
        t.Security?.Name,
        t.Currency,
        t.Quantity,
        t.Price,
        t.Amount,
        t.Fee,
        t.FxRate,
        t.SplitFrom,
        t.SplitTo,
        t.Note,
        Money(t.ToLedgerEntry().Total),
        t.CreatedAt);

    /// <summary>The change is shown only when the latest close is recent, as for the day change on holdings.</summary>
    public static SecurityDto ToDto(Security s, LatestQuote? quote, bool inUse, DateOnly today)
    {
        var last = quote?.Last;
        decimal? previous = quote?.Previous is { } p ? p.Close / quote.SplitFactor : null;
        var fresh = last is not null && today.DayNumber - last.Date.DayNumber <= 6;
        decimal? change = fresh && previous is > 0 ? Ratio((last!.Close - previous.Value) / previous.Value) : null;
        return new SecurityDto(s.Id, s.Symbol, s.Name, s.Currency, s.Exchange, s.AssetType, s.PriceSource,
            last?.Close, last?.Date, previous is { } prev ? Price(prev) : null, change, s.LastRefreshAt, s.LastRefreshError, inUse);
    }

    private static List<string> Warnings(PortfolioSnapshot snapshot)
    {
        var warnings = new List<string>();
        foreach (var currency in snapshot.MissingRates)
        {
            warnings.Add($"No {currency} exchange rate has been downloaded yet, so {currency} amounts are counted 1:1 in " +
                         $"{snapshot.Portfolio.BaseCurrency} until the next refresh.");
        }

        foreach (var holding in snapshot.Valuation.Holdings.Where(h => h.PriceMissing))
        {
            var symbol = snapshot.Securities[holding.Position.SecurityId].Symbol;
            warnings.Add($"No price is available for {symbol} yet, so it is shown at cost.");
        }

        return warnings;
    }

    public static decimal Money(decimal value) => decimal.Round(value, 4, MidpointRounding.AwayFromZero);

    public static decimal? Ratio(decimal? value) => value is { } v ? decimal.Round(v, 6, MidpointRounding.AwayFromZero) : null;

    public static decimal Price(decimal value) => decimal.Round(value, 6, MidpointRounding.AwayFromZero);

    public static decimal Rate(decimal value) => decimal.Round(value, 8, MidpointRounding.AwayFromZero);
}
