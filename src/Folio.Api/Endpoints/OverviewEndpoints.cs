using Folio.Api.Data;
using Folio.Api.Portfolios;
using Folio.Core;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using static Folio.Api.Portfolios.PortfolioMapper;

namespace Folio.Api.Endpoints;

/// <summary>All portfolios together, converted to one display currency.</summary>
public static class OverviewEndpoints
{
    public static void MapOverviewEndpoints(this IEndpointRouteBuilder api)
    {
        var group = api.MapGroup("/overview").WithTags("Overview");
        group.MapGet("/", Get);
        group.MapGet("/history", History);
    }

    /// <param name="excludeRealEstate">Leave real-estate portfolios out of every figure, to read net worth as liquid investments only.</param>
    private static async Task<Results<Ok<OverviewDto>, ProblemHttpResult>> Get(
        string? currency, bool? excludeRealEstate, FolioDbContext db, PortfolioCalculator calculator, CancellationToken ct)
    {
        var display = Currencies.Normalize(currency ?? Currencies.Cad);
        if (!Currencies.IsPortfolioCurrency(display))
            return Problems.BadRequest("The display currency must be CAD, USD or EUR.");

        var today = calculator.Today;
        var all = await Included(db, excludeRealEstate, ct);
        var snapshots = new List<PortfolioSnapshot>();
        foreach (var portfolio in all)
            snapshots.Add(await calculator.SnapshotAsync(portfolio, ct));

        // Deposits are converted at their own dates (as in the chart), so a USD account viewed in CAD shows its
        // currency gain as return rather than hiding it inside the deposits.
        var firstFlow = snapshots.SelectMany(s => s.Ledger.ExternalFlows).Select(f => (DateOnly?)f.Date).Min() ?? today;
        await calculator.EnsureRatesAsync(all.Select(p => p.BaseCurrency).Append(display), firstFlow, ct);
        var fx = await calculator.LoadFxAsync(firstFlow, today, ct);
        var missingRates = new SortedSet<string>();
        decimal Convert(decimal amount, string from, DateOnly date)
        {
            if (fx.GetRate(from, display, date) is { } rate)
                return amount * rate;
            missingRates.Add(from);
            return amount;
        }
        decimal ToDisplay(decimal amount, string from) => Convert(amount, from, today);

        var portfolios = new List<OverviewPortfolioDto>();
        var byCurrency = new Dictionary<string, decimal>();
        var byType = new Dictionary<string, decimal>();
        var byCountry = new Dictionary<string, decimal>();
        var movers = new Dictionary<Guid, MoverDto>();
        decimal total = 0, dayChange = 0, totalReturn = 0, contributions = 0, cash = 0;
        var anyContributions = false;
        DateOnly? pricesAsOf = null;
        DateOnly? dayChangeDate = null;

        var warnings = new List<string>();
        foreach (var snapshot in snapshots)
        {
            var portfolio = snapshot.Portfolio;
            warnings.AddRange(snapshot.MissingRates.Select(c => $"{portfolio.Name}: no {c} exchange rate yet, counted 1:1."));
            var v = snapshot.Valuation;
            var baseCurrency = portfolio.BaseCurrency;

            var value = ToDisplay(v.TotalValue, baseCurrency);
            var deposits = snapshot.Ledger.ExternalFlows.Sum(f => Convert(f.Amount, baseCurrency, f.Date));
            // Return is only measurable once deposits are recorded.
            decimal? earned = v.HasContributions ? value - deposits : null;
            portfolios.Add(new OverviewPortfolioDto(portfolio.Id, portfolio.Name, baseCurrency, Money(v.TotalValue),
                Money(value), Money(ToDisplay(v.DayChange, baseCurrency)), Ratio(v.DayChangePercent),
                earned is { } e ? Money(e) : null, earned is { } r && deposits > 0 ? Ratio(r / deposits) : null, v.Holdings.Count,
                snapshot.Access.Access, snapshot.Access.OwnerEmail, portfolio.Country, portfolio.Kind));

            total += value;
            // A portfolio's whole value counts for its country; those without one are shown together as "Not set".
            Add(byCountry, portfolio.Country ?? string.Empty, value);
            dayChange += ToDisplay(v.DayChange, baseCurrency);
            totalReturn += earned ?? 0m;
            anyContributions |= earned is not null;
            contributions += deposits;
            cash += ToDisplay(v.CashValue, baseCurrency);
            if (v.PricesAsOf > pricesAsOf || pricesAsOf is null)
                pricesAsOf = v.PricesAsOf;
            if (v.DayChangeDate > dayChangeDate || dayChangeDate is null)
                dayChangeDate = v.DayChangeDate;

            foreach (var holding in v.Holdings)
            {
                var security = snapshot.Securities[holding.Position.SecurityId];
                var holdingValue = ToDisplay(holding.MarketValueBase, baseCurrency);
                Add(byCurrency, holding.Position.Currency, holdingValue);
                // A property's holding is real estate whatever its security says, and its manual prices are not market moves.
                var realEstate = portfolio.Kind == PortfolioKind.RealEstate;
                Add(byType, realEstate ? nameof(PortfolioKind.RealEstate) : security.AssetType.ToString(), holdingValue);
                if (!realEstate && holding is { DayChangePercent: { } change, Price: { } price })
                    movers[security.Id] = new MoverDto(security.Id, security.Symbol, security.Name, security.Currency, price.Close, Ratio(change)!.Value);
            }

            foreach (var balance in v.Cash)
            {
                var cashValue = ToDisplay(balance.ValueBase, baseCurrency);
                Add(byCurrency, balance.Currency, cashValue);
                Add(byType, "Cash", cashValue);
            }
        }

        var dayBase = total - dayChange;
        return TypedResults.Ok(new OverviewDto(
            display,
            Money(total),
            Money(dayChange),
            dayBase > 0 ? Ratio(dayChange / dayBase) : null,
            anyContributions ? Money(totalReturn) : null,
            anyContributions && contributions > 0 ? Ratio(totalReturn / contributions) : null,
            Money(contributions),
            Money(cash),
            pricesAsOf,
            portfolios,
            Slices(byCurrency, key => key),
            Slices(byType, Label),
            Slices(byCountry, key => key.Length == 0 ? "Not set" : key),
            movers.Values.OrderByDescending(m => Math.Abs(m.DayChangePercent)).Take(6).ToList(),
            warnings.Concat(missingRates.Select(c => $"No {c} to {display} exchange rate yet; {c} amounts are counted 1:1.")).ToList(),
            dayChangeDate));
    }

    private static async Task<Results<Ok<HistoryDto>, ProblemHttpResult>> History(
        string? currency, string? range, bool? excludeRealEstate, FolioDbContext db, PortfolioCalculator calculator, CancellationToken ct)
    {
        var display = Currencies.Normalize(currency ?? Currencies.Cad);
        if (!Currencies.IsPortfolioCurrency(display))
            return Problems.BadRequest("The display currency must be CAD, USD or EUR.");

        var inputs = new List<(string, List<Transaction>, CashLedger)>();
        foreach (var portfolio in await Included(db, excludeRealEstate, ct))
            inputs.Add((portfolio.BaseCurrency, await calculator.LoadTransactionsAsync(portfolio.Id, ct), await calculator.LoadCashAsync(portfolio.Id, ct)));
        return TypedResults.Ok(await HistoryQuery.BuildAsync(inputs, display, range, calculator, ct));
    }

    /// <summary>The portfolios the overview counts, in creation order; real estate only when asked for.</summary>
    private static async Task<List<Portfolio>> Included(FolioDbContext db, bool? excludeRealEstate, CancellationToken ct)
    {
        var portfolios = db.Portfolios.AsNoTracking();
        if (excludeRealEstate == true)
            portfolios = portfolios.Where(p => p.Kind != PortfolioKind.RealEstate);
        return await portfolios.OrderBy(p => p.CreatedAt).ToListAsync(ct);
    }

    private static void Add(Dictionary<string, decimal> slices, string key, decimal value) =>
        slices[key] = slices.GetValueOrDefault(key) + value;

    private static List<AllocationDto> Slices(Dictionary<string, decimal> values, Func<string, string> label)
    {
        // Negative balances (cash borrowed) would distort the shares, so only positive amounts are charted.
        var positive = values.Where(v => v.Value > 0).ToList();
        var sum = positive.Sum(v => v.Value);
        return positive
            .OrderByDescending(v => v.Value)
            .Select(v => new AllocationDto(v.Key, label(v.Key), Money(v.Value), sum > 0 ? Ratio(v.Value / sum)!.Value : 0m))
            .ToList();
    }

    private static string Label(string assetType) => assetType switch
    {
        nameof(AssetType.Stock) => "Stocks",
        nameof(AssetType.Etf) => "ETFs",
        nameof(AssetType.Fund) => "Funds",
        nameof(AssetType.Crypto) => "Crypto",
        nameof(AssetType.Other) => "Other",
        nameof(PortfolioKind.RealEstate) => "Real estate",
        _ => assetType,
    };
}
