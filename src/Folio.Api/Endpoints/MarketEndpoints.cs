using System.Text.RegularExpressions;
using Folio.Api.Data;
using Folio.Api.MarketData;
using Folio.Api.Portfolios;
using Folio.Core;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Folio.Api.Endpoints;

public static partial class MarketEndpoints
{
    public static void MapMarketEndpoints(this IEndpointRouteBuilder api)
    {
        var market = api.MapGroup("/market").WithTags("Market data");
        market.MapGet("/status", Status);
        market.MapPost("/refresh", Refresh);
        market.MapGet("/runs", Runs);

        api.MapGet("/fx", Rates).WithTags("Market data");
    }

    private static async Task<MarketStatusDto> Status(
        FolioDbContext db, RefreshCoordinator coordinator, MarketClock clock, IFallbackQuoteProvider fallback,
        IOptions<MarketDataOptions> options, CancellationToken ct)
    {
        var lastRun = await db.RefreshRuns.AsNoTracking().OrderByDescending(r => r.StartedAt).FirstOrDefaultAsync(ct);
        var mine = await MySymbolsAsync(db, ct);
        var tracked = db.Securities.Where(s => s.PriceSource == PriceSource.Yahoo
            && db.Transactions.Any(t => t.SecurityId == s.Id && db.Portfolios.Any(p => p.Id == t.PortfolioId)));
        return new MarketStatusDto(
            coordinator.IsRunning,
            lastRun is null ? null : ToDto(lastRun, mine),
            clock.NextScheduledRun(),
            options.Value.EnableScheduler,
            await db.FxRates.MaxAsync(r => (DateOnly?)r.Date, ct),
            await db.PriceBars.Where(b => tracked.Any(s => s.Id == b.SecurityId)).MaxAsync(b => (DateOnly?)b.Date, ct),
            await tracked.CountAsync(ct),
            await tracked.CountAsync(s => s.LastRefreshError != null, ct),
            fallback.IsConfigured,
            clock.Today);
    }

    private static Results<Accepted, Conflict<string>> Refresh(RefreshCoordinator coordinator) =>
        coordinator.Start("Manual") ? TypedResults.Accepted("/api/market/status") : TypedResults.Conflict("A refresh is already running.");

    private static async Task<List<RefreshRunDto>> Runs(int? take, FolioDbContext db, CancellationToken ct)
    {
        var mine = await MySymbolsAsync(db, ct);
        return (await db.RefreshRuns.AsNoTracking().OrderByDescending(r => r.StartedAt).Take(Math.Clamp(take ?? 20, 1, 100)).ToListAsync(ct))
            .Select(r => ToDto(r, mine))
            .ToList();
    }

    private static async Task<HashSet<string>> MySymbolsAsync(FolioDbContext db, CancellationToken ct) =>
        (await db.Transactions
            .Where(t => t.Security != null && db.Portfolios.Any(p => p.Id == t.PortfolioId))
            .Select(t => t.Security!.Symbol)
            .Distinct()
            .ToListAsync(ct)).ToHashSet(StringComparer.Ordinal);

    /// <summary>Canadian dollars per unit of every currency in use, on a date (today by default).</summary>
    private static async Task<FxRatesDto> Rates(
        DateOnly? date, FolioDbContext db, MarketDataService market, PortfolioCalculator calculator, MarketClock clock, CancellationToken ct)
    {
        var day = date is { } d && d <= clock.Today ? d : clock.Today;
        var currencies = new SortedSet<string>(Currencies.PortfolioCurrencies);
        currencies.UnionWith(await db.Securities.Select(s => s.Currency).Distinct().ToListAsync(ct));
        // Transactions have no query filter of their own, so they are narrowed to the portfolios this account can see.
        currencies.UnionWith(await db.Transactions.Where(t => db.Portfolios.Any(p => p.Id == t.PortfolioId)).Select(t => t.Currency).Distinct().ToListAsync(ct));
        currencies.UnionWith(await db.CashBalances.Where(c => db.Portfolios.Any(p => p.Id == c.PortfolioId)).Select(c => c.Currency).Distinct().ToListAsync(ct));

        if (day < clock.Today.AddDays(-7))
        {
            try
            {
                await market.EnsureFxAsync(currencies, day, ct);
            }
            catch (Exception ex) when (MarketDataErrors.IsTransient(ex))
            {
                // Use whatever is stored.
            }
        }

        var table = await calculator.LoadFxAsync(day, day, ct);
        var rates = currencies
            .Where(c => c != Currencies.Cad)
            .Select(c => table.GetRate(c, Currencies.Cad, day) is { } rate ? new FxRateDto(c, Currencies.Cad, PortfolioMapper.Rate(rate)) : null)
            .OfType<FxRateDto>()
            .Prepend(new FxRateDto(Currencies.Cad, Currencies.Cad, 1m))
            .ToList();
        var ratesDate = await db.FxRates.Where(r => r.Date <= day).MaxAsync(r => (DateOnly?)r.Date, ct);
        return new FxRatesDto(day, ratesDate, rates);
    }

    /// <summary>
    /// The run log mentions every account's symbols; each account sees only its own lines, and the updated and failed
    /// counts are worked out from those lines too, so they don't reveal how many securities other accounts hold.
    /// </summary>
    private static RefreshRunDto ToDto(RefreshRun r, HashSet<string> mySymbols)
    {
        if (r.Log is null)
            return new RefreshRunDto(r.Id, r.StartedAt, r.FinishedAt, r.Trigger, r.Status, 0, 0, r.FxRatesStored, null);

        var lines = r.Log.Split('\n').Select(line =>
        {
            var colon = line.IndexOf(':');
            return colon < 0 ? (Line: line, Head: line, Message: string.Empty) : (Line: line, Head: line[..colon], Message: line[(colon + 1)..]);
        }).ToList();
        var outcomes = lines.Where(l => mySymbols.Contains(l.Head))
            .GroupBy(l => l.Head, StringComparer.Ordinal)
            .Select(g => g.Any(l => UpdatedLine().IsMatch(l.Message)))
            .ToList();
        var log = string.Join('\n', lines.Where(l => l.Head.Contains(' ') || mySymbols.Contains(l.Head)).Select(l => l.Line));
        return new RefreshRunDto(r.Id, r.StartedAt, r.FinishedAt, r.Trigger, r.Status,
            outcomes.Count(updated => updated), outcomes.Count(updated => !updated), r.FxRatesStored, log);
    }

    /// <summary>What a symbol's log line says after its colon when its closes were stored (by Yahoo or the fallback).</summary>
    [GeneratedRegex(@"^ (no new closes|\S+ on \d{4}-\d{2}-\d{2}( from Alpha Vantage)?)\.$", RegexOptions.CultureInvariant)]
    private static partial Regex UpdatedLine();
}
