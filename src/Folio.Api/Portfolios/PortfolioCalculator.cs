using Folio.Api.Data;
using Folio.Api.MarketData;
using Folio.Core;
using Microsoft.EntityFrameworkCore;

namespace Folio.Api.Portfolios;

public sealed record PortfolioSnapshot(
    Portfolio Portfolio,
    IReadOnlyList<Transaction> Transactions,
    PortfolioLedger Ledger,
    CashLedger Cash,
    PortfolioValuation Valuation,
    IReadOnlyDictionary<Guid, Security> Securities,
    IReadOnlyList<string> MissingRates,
    AccessInfo Access);

/// <summary>Loads a portfolio's transactions and the market data needed to value it.</summary>
public sealed class PortfolioCalculator(FolioDbContext db, MarketDataService market, MarketClock clock, PortfolioAccess access)
{
    /// <summary>Rates and closes are read this far before a range, so as-of lookups find the previous business day.</summary>
    private const int LookbackDays = 14;

    public DateOnly Today => clock.Today;

    private DateOnly? _session;
    private bool _sessionLoaded;

    /// <summary>The trading session day changes refer to; the same for every portfolio, so totals add up.</summary>
    private async Task<DateOnly?> SessionAsync(CancellationToken ct)
    {
        if (!_sessionLoaded)
        {
            _session = await market.LatestSessionAsync(ct);
            _sessionLoaded = true;
        }

        return _session;
    }

    public async Task<PortfolioSnapshot> SnapshotAsync(Portfolio portfolio, CancellationToken ct)
    {
        var transactions = await LoadTransactionsAsync(portfolio.Id, ct);
        var ledger = PortfolioLedger.Replay(portfolio.BaseCurrency, transactions.Select(t => t.ToLedgerEntry()));
        var cash = await LoadCashAsync(portfolio.Id, ct);
        var today = clock.Today;
        var prices = await LoadLatestPricesAsync(ledger.OpenPositions.Select(p => p.SecurityId).ToList(), today, ct);
        var currencies = ledger.OpenPositions.Select(p => p.Currency).Concat(cash.Currencies).Distinct().ToList();
        await EnsureRatesAsync(currencies.Append(portfolio.BaseCurrency), today, ct);
        var fx = await LoadFxAsync(today, today, ct);
        var valuation = PortfolioValuator.Value(ledger, today, prices, fx, cash, await SessionAsync(ct));
        var securities = transactions
            .Where(t => t.Security is not null)
            .Select(t => t.Security!)
            .DistinctBy(s => s.Id)
            .ToDictionary(s => s.Id);
        var missing = currencies.Where(c => fx.GetRate(c, portfolio.BaseCurrency, today) is null).ToList();
        return new PortfolioSnapshot(portfolio, transactions, ledger, cash, valuation, securities, missing, await access.DescribeAsync(portfolio, ct));
    }

    /// <summary>Every cash balance entered for the portfolio, by currency and date.</summary>
    public async Task<CashLedger> LoadCashAsync(Guid portfolioId, CancellationToken ct)
    {
        var cash = new CashLedger();
        var rows = await db.CashBalances.AsNoTracking().Where(c => c.PortfolioId == portfolioId).ToListAsync(ct);
        foreach (var row in rows)
            cash.Set(row.Currency, row.Date, row.Balance);
        return cash;
    }

    /// <summary>
    /// Downloads rates for currencies that have none reaching back to <paramref name="from"/> (a fresh install, a new
    /// currency, or an app that started offline). Without them, conversions would silently fall back to 1:1.
    /// </summary>
    public async Task EnsureRatesAsync(IEnumerable<string> currencies, DateOnly from, CancellationToken ct)
    {
        try
        {
            await market.EnsureFxAsync(currencies, from.AddDays(-7), ct);
        }
        catch (Exception ex) when (!ct.IsCancellationRequested && MarketDataErrors.IsTransient(ex))
        {
            // Offline: value with what is stored; callers report the currencies still missing.
        }
    }

    public async Task<List<Transaction>> LoadTransactionsAsync(Guid portfolioId, CancellationToken ct) =>
        await db.Transactions.AsNoTracking()
            .Include(t => t.Security)
            .Where(t => t.PortfolioId == portfolioId)
            .OrderBy(t => t.Date)
            .ThenBy(t => t.Sequence)
            .ToListAsync(ct);

    /// <summary>Recent closes for each security, enough for its value and day change on <paramref name="asOf"/>.</summary>
    public async Task<PriceTable> LoadLatestPricesAsync(IReadOnlyCollection<Guid> securityIds, DateOnly asOf, CancellationToken ct)
    {
        var table = new PriceTable();
        if (securityIds.Count == 0)
            return table;

        var recentFrom = asOf.AddDays(-30);
        var recent = await db.PriceBars.AsNoTracking()
            .Where(b => securityIds.Contains(b.SecurityId) && b.Date >= recentFrom && b.Date <= asOf)
            .Select(b => new { b.SecurityId, b.Date, b.Close })
            .ToListAsync(ct);
        foreach (var bar in recent)
            table.Add(bar.SecurityId, bar.Date, bar.Close);

        // Manually priced or stale securities: fall back to their last two closes, however old.
        var covered = recent.Select(b => b.SecurityId).ToHashSet();
        foreach (var id in securityIds.Where(id => !covered.Contains(id)))
        {
            var older = await db.PriceBars.AsNoTracking()
                .Where(b => b.SecurityId == id && b.Date <= asOf)
                .OrderByDescending(b => b.Date)
                .Take(2)
                .ToListAsync(ct);
            foreach (var bar in older)
                table.Add(bar.SecurityId, bar.Date, bar.Close);
        }

        return table;
    }

    /// <summary>Every close in the range, plus the last one before it, for each security.</summary>
    public async Task<PriceTable> LoadPricesAsync(IReadOnlyCollection<Guid> securityIds, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var table = new PriceTable();
        if (securityIds.Count == 0)
            return table;

        var start = from.AddDays(-LookbackDays);
        var bars = await db.PriceBars.AsNoTracking()
            .Where(b => securityIds.Contains(b.SecurityId) && b.Date >= start && b.Date <= to)
            .Select(b => new { b.SecurityId, b.Date, b.Close })
            .ToListAsync(ct);
        foreach (var bar in bars)
            table.Add(bar.SecurityId, bar.Date, bar.Close);

        var before = await db.PriceBars.AsNoTracking()
            .Where(b => securityIds.Contains(b.SecurityId) && b.Date < start)
            .GroupBy(b => b.SecurityId)
            .Select(g => g.OrderByDescending(b => b.Date).First())
            .ToListAsync(ct);
        foreach (var bar in before)
            table.Add(bar.SecurityId, bar.Date, bar.Close);

        return table;
    }

    /// <summary>Exchange rates for the range, plus each currency's last rate before it.</summary>
    public async Task<FxTable> LoadFxAsync(DateOnly from, DateOnly to, CancellationToken ct)
    {
        var table = new FxTable();
        var start = from.AddDays(-LookbackDays);
        var rows = await db.FxRates.AsNoTracking()
            .Where(r => r.Date >= start && r.Date <= to)
            .Select(r => new { r.Currency, r.Date, r.CadPerUnit })
            .ToListAsync(ct);
        foreach (var row in rows)
            table.Add(row.Currency, row.Date, row.CadPerUnit);

        // Covers a PC that was off for weeks: the newest rate before the window is still the best available.
        var before = await db.FxRates.AsNoTracking()
            .Where(r => r.Date < start)
            .GroupBy(r => r.Currency)
            .Select(g => g.OrderByDescending(r => r.Date).First())
            .ToListAsync(ct);
        foreach (var row in before)
            table.Add(row.Currency, row.Date, row.CadPerUnit);

        return table;
    }
}
