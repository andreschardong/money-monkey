using Folio.Api.Data;
using Folio.Api.Portfolios;
using Folio.Core;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using static Folio.Api.Portfolios.PortfolioMapper;

namespace Folio.Api.Endpoints;

/// <summary>Everything held across all portfolios, one line per security and per cash currency.</summary>
public static class AssetEndpoints
{
    public static void MapAssetEndpoints(this IEndpointRouteBuilder api) =>
        api.MapGet("/assets", Get).WithTags("Overview");

    private static async Task<Results<Ok<AssetsDto>, ProblemHttpResult>> Get(
        string? currency, FolioDbContext db, PortfolioCalculator calculator, CancellationToken ct)
    {
        var display = Currencies.Normalize(currency ?? Currencies.Cad);
        if (!Currencies.IsPortfolioCurrency(display))
            return Problems.BadRequest("The display currency must be CAD, USD or EUR.");

        var today = calculator.Today;
        var portfolios = await db.Portfolios.AsNoTracking().OrderBy(p => p.CreatedAt).ToListAsync(ct);
        var snapshots = new List<PortfolioSnapshot>();
        foreach (var portfolio in portfolios)
            snapshots.Add(await calculator.SnapshotAsync(portfolio, ct));

        await calculator.EnsureRatesAsync(portfolios.Select(p => p.BaseCurrency).Append(display), today, ct);
        var fx = await calculator.LoadFxAsync(today, today, ct);
        var missingRates = new SortedSet<string>();
        decimal ToDisplay(decimal amount, string from)
        {
            if (fx.GetRate(from, display, today) is { } rate)
                return amount * rate;
            missingRates.Add(from);
            return amount;
        }

        var holdings = new Dictionary<Guid, HoldingTotal>();
        var cash = new Dictionary<string, CashTotal>(StringComparer.Ordinal);
        var warnings = new List<string>();
        DateOnly? pricesAsOf = null;
        DateOnly? dayChangeDate = null;

        foreach (var snapshot in snapshots)
        {
            var portfolio = snapshot.Portfolio;
            var baseCurrency = portfolio.BaseCurrency;
            var v = snapshot.Valuation;
            warnings.AddRange(snapshot.MissingRates.Select(c => $"{portfolio.Name}: no {c} exchange rate yet, counted 1:1."));
            if (v.PricesAsOf is { } asOf && (pricesAsOf is null || asOf > pricesAsOf))
                pricesAsOf = asOf;
            if (v.DayChangeDate is { } session && (dayChangeDate is null || session > dayChangeDate))
                dayChangeDate = session;

            foreach (var h in v.Holdings)
            {
                var security = snapshot.Securities[h.Position.SecurityId];
                if (!holdings.TryGetValue(security.Id, out var total))
                    holdings[security.Id] = total = new HoldingTotal(security, h.Position.Currency);

                var value = ToDisplay(h.MarketValueBase, baseCurrency);
                total.Quantity += h.Position.Quantity;
                total.CostLocal += h.Position.CostLocal;
                total.CostBasis += ToDisplay(h.Position.CostBase, baseCurrency);
                total.MarketValueLocal += h.MarketValueLocal;
                total.MarketValue += value;
                total.DayChange += ToDisplay(h.DayChangeBase, baseCurrency);
                total.Price ??= h.Price;
                total.DayChangePercent ??= h.DayChangePercent;
                total.PriceMissing |= h.PriceMissing;
                total.Slices.Add(new AssetSliceDto(portfolio.Id, portfolio.Name, h.Position.Quantity, Money(value)));
            }

            foreach (var c in v.Cash)
            {
                if (!cash.TryGetValue(c.Currency, out var total))
                    cash[c.Currency] = total = new CashTotal();

                var value = ToDisplay(c.ValueBase, baseCurrency);
                total.Balance += c.Balance;
                total.Value += value;
                total.Slices.Add(new AssetSliceDto(portfolio.Id, portfolio.Name, c.Balance, Money(value)));
            }
        }

        var holdingsValue = holdings.Values.Sum(h => h.MarketValue);
        var cashValue = cash.Values.Sum(c => c.Value);
        var totalValue = holdingsValue + cashValue;
        var dayChange = holdings.Values.Sum(h => h.DayChange);
        var costBasis = holdings.Values.Sum(h => h.CostBasis);
        var unrealized = holdingsValue - costBasis;
        var dayBase = totalValue - dayChange;

        var holdingDtos = holdings.Values
            .OrderByDescending(h => h.MarketValue)
            .Select(h => new AssetHoldingDto(
                h.Security.Id, h.Security.Symbol, h.Security.Name, h.Security.Exchange, h.Security.AssetType, h.Currency,
                h.Quantity,
                h.Quantity > 0 ? Price(h.CostLocal / h.Quantity) : 0m,
                Money(h.CostBasis),
                h.Price?.Close,
                h.Price?.Date,
                Ratio(h.DayChangePercent),
                Money(h.MarketValue),
                Money(h.MarketValueLocal),
                Money(h.DayChange),
                Money(h.MarketValue - h.CostBasis),
                h.CostBasis > 0 ? Ratio((h.MarketValue - h.CostBasis) / h.CostBasis) : null,
                totalValue > 0 ? Ratio(h.MarketValue / totalValue)!.Value : 0m,
                h.PriceMissing,
                h.Slices.OrderByDescending(s => s.Value).ToList()))
            .ToList();

        var cashDtos = cash
            .OrderBy(c => c.Key == display ? 0 : 1)
            .ThenBy(c => c.Key)
            .Select(c => new AssetCashDto(c.Key, Money(c.Value.Balance), Money(c.Value.Value),
                totalValue > 0 ? Ratio(c.Value.Value / totalValue)!.Value : 0m,
                c.Value.Slices.OrderByDescending(s => s.Value).ToList()))
            .ToList();

        return TypedResults.Ok(new AssetsDto(
            display,
            portfolios.Count,
            Money(totalValue),
            Money(holdingsValue),
            Money(cashValue),
            Money(dayChange),
            dayBase > 0 ? Ratio(dayChange / dayBase) : null,
            Money(costBasis),
            Money(unrealized),
            costBasis > 0 ? Ratio(unrealized / costBasis) : null,
            pricesAsOf,
            holdingDtos,
            cashDtos,
            warnings.Concat(missingRates.Select(c => $"No {c} to {display} exchange rate yet; {c} amounts are counted 1:1.")).ToList(),
            dayChangeDate));
    }

    private sealed class HoldingTotal(Security security, string currency)
    {
        public Security Security { get; } = security;
        public string Currency { get; } = currency;
        public decimal Quantity;
        public decimal CostLocal;
        public decimal CostBasis;
        public decimal MarketValueLocal;
        public decimal MarketValue;
        public decimal DayChange;
        public PricePoint? Price;
        public decimal? DayChangePercent;
        public bool PriceMissing;
        public List<AssetSliceDto> Slices { get; } = [];
    }

    private sealed class CashTotal
    {
        public decimal Balance;
        public decimal Value;
        public List<AssetSliceDto> Slices { get; } = [];
    }
}
