namespace Folio.Core;

public sealed record HoldingValuation(
    Position Position,
    PricePoint? Price,
    decimal? PreviousClose,
    decimal FxRate,
    decimal MarketValueLocal,
    decimal MarketValueBase,
    decimal DayChangeBase)
{
    /// <summary>No price is known yet, so the holding is carried at cost.</summary>
    public bool PriceMissing => Price is null;

    public decimal UnrealizedBase => MarketValueBase - Position.CostBase;

    public decimal? UnrealizedPercent => Position.CostBase > 0 ? UnrealizedBase / Position.CostBase : null;

    public decimal? DayChangePercent =>
        Price is { } price && PreviousClose is > 0 ? (price.Close - PreviousClose.Value) / PreviousClose.Value : null;
}

public sealed record CashValuation(string Currency, decimal Balance, DateOnly AsOf, decimal FxRate, decimal ValueBase);

public sealed record PortfolioValuation(
    string BaseCurrency,
    DateOnly AsOf,
    IReadOnlyList<HoldingValuation> Holdings,
    IReadOnlyList<CashValuation> Cash,
    decimal NetContributions,
    decimal RealizedGain,
    decimal Dividends,
    decimal Interest,
    decimal Fees,
    decimal TaxWithheld,
    double? AnnualizedReturn,
    DateOnly? PricesAsOf)
{
    public decimal HoldingsValue => Holdings.Sum(h => h.MarketValueBase);
    public decimal CashValue => Cash.Sum(c => c.ValueBase);
    public decimal TotalValue => HoldingsValue + CashValue;
    public decimal CostBasis => Holdings.Sum(h => h.Position.CostBase);
    public decimal UnrealizedGain => Holdings.Sum(h => h.UnrealizedBase);
    public decimal DayChange => Holdings.Sum(h => h.DayChangeBase);

    public decimal? DayChangePercent
    {
        get
        {
            var previous = TotalValue - DayChange;
            return previous > 0 ? DayChange / previous : null;
        }
    }

    /// <summary>Everything the portfolio has gained: value now minus the money put in. Null until a deposit is recorded.</summary>
    public decimal? TotalReturn => HasContributions ? TotalValue - NetContributions : null;

    public decimal? TotalReturnPercent => NetContributions > 0 ? (TotalValue - NetContributions) / NetContributions : null;

    public bool HasContributions => NetContributions != 0m;

    public decimal? UnrealizedPercent => CostBasis > 0 ? UnrealizedGain / CostBasis : null;
}

public static class PortfolioValuator
{
    /// <summary>A day change is shown only when the latest close is this recent.</summary>
    private const int DayChangeMaxAgeDays = 6;

    /// <summary>Annualized return is reported once the money has been invested for at least a year.</summary>
    private const int MinDaysForAnnualized = 365;

    public static PortfolioValuation Value(PortfolioLedger ledger, DateOnly asOf, IPriceSource prices, IFxSource fx, CashLedger cash)
    {
        var holdings = new List<HoldingValuation>();
        foreach (var position in ledger.OpenPositions)
        {
            var rate = fx.GetRate(position.Currency, ledger.BaseCurrency, asOf) ?? 1m;
            var price = prices.GetPrice(position.SecurityId, asOf);
            if (price is null)
            {
                holdings.Add(new HoldingValuation(position, null, null, rate, position.CostLocal, position.CostBase, 0m));
                continue;
            }

            // A split can be recorded before its ex-date close is loaded; the close then still counts old shares.
            var close = price.Value.Close / SplitFactor(position, price.Value.Date, asOf);
            var current = new PricePoint(price.Value.Date, close);
            var fresh = asOf.DayNumber - price.Value.Date.DayNumber <= DayChangeMaxAgeDays;
            var previousClose = fresh ? PreviousClose(position, price.Value.Date, asOf, prices) : null;
            var valueLocal = position.Quantity * close;
            var dayChangeLocal = previousClose is { } prev ? position.Quantity * (close - prev) : 0m;
            holdings.Add(new HoldingValuation(position, current, previousClose, rate, valueLocal, valueLocal * rate, dayChangeLocal * rate));
        }

        var balances = cash.BalancesOn(asOf)
            .Select(c =>
            {
                var rate = fx.GetRate(c.Currency, ledger.BaseCurrency, asOf) ?? 1m;
                return new CashValuation(c.Currency, c.Balance, c.AsOf, rate, c.Balance * rate);
            })
            .OrderBy(c => c.Currency == ledger.BaseCurrency ? 0 : 1)
            .ThenBy(c => c.Currency)
            .ToList();

        var pricesAsOf = holdings.Where(h => h.Price is not null).Select(h => (DateOnly?)h.Price!.Value.Date).Max();
        var valuation = new PortfolioValuation(ledger.BaseCurrency, asOf, holdings, balances, ledger.NetContributions,
            ledger.RealizedGain, ledger.Dividends, ledger.Interest, ledger.Fees, ledger.TaxWithheld, null, pricesAsOf);

        return valuation with { AnnualizedReturn = Annualized(ledger, asOf, valuation.TotalValue) };
    }

    /// <summary>Total value only; the fast path used for charts.</summary>
    public static decimal TotalValue(PortfolioLedger ledger, DateOnly date, IPriceSource prices, IFxSource fx, CashLedger cash)
    {
        var total = 0m;
        foreach (var position in ledger.Positions.Values)
        {
            if (position.Quantity <= 0)
                continue;
            var rate = fx.GetRate(position.Currency, ledger.BaseCurrency, date) ?? 1m;
            total += prices.GetPrice(position.SecurityId, date) is { } price
                ? position.Quantity * price.Close / SplitFactor(position, price.Date, date) * rate
                : position.CostBase;
        }

        foreach (var position in cash.BalancesOn(date))
            total += position.Balance * (fx.GetRate(position.Currency, ledger.BaseCurrency, date) ?? 1m);

        return total;
    }

    /// <summary>The close before <paramref name="priceDate"/>, restated to the share count on <paramref name="asOf"/>.</summary>
    private static decimal? PreviousClose(Position position, DateOnly priceDate, DateOnly asOf, IPriceSource prices) =>
        prices.GetPriceBefore(position.SecurityId, priceDate) is { } previous
            ? previous.Close / SplitFactor(position, previous.Date, asOf)
            : null;

    /// <summary>How many shares one share of <paramref name="after"/> had become by <paramref name="upTo"/>, from recorded splits.</summary>
    private static decimal SplitFactor(Position position, DateOnly after, DateOnly upTo)
    {
        var factor = 1m;
        foreach (var split in position.Splits)
        {
            if (split.Date > after && split.Date <= upTo)
                factor *= split.Factor;
        }

        return factor;
    }

    private static double? Annualized(PortfolioLedger ledger, DateOnly asOf, decimal totalValue)
    {
        // Without recorded deposits there is nothing to measure the return against.
        if (ledger.ExternalFlows.Count == 0 || asOf.DayNumber - ledger.ExternalFlows[0].Date.DayNumber < MinDaysForAnnualized)
            return null;

        var flows = ledger.ExternalFlows
            .Select(f => (f.Date, Amount: -(double)f.Amount))
            .Append((asOf, (double)totalValue))
            .ToList();
        return Xirr.Calculate(flows);
    }
}
