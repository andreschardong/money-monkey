using Folio.Api.Data;
using Folio.Api.MarketData;
using Folio.Api.Portfolios;
using Folio.Core;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Folio.Api.Endpoints;

public static class MarketEndpoints
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
        currencies.UnionWith(await db.Transactions.Select(t => t.Currency).Distinct().ToListAsync(ct));
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

    /// <summary>The run log mentions every account's symbols; each account sees only its own lines.</summary>
    private static RefreshRunDto ToDto(RefreshRun r, HashSet<string> mySymbols)
    {
        var log = r.Log is null ? null : string.Join('\n', r.Log.Split('\n').Where(line =>
        {
            var colon = line.IndexOf(':');
            var head = colon < 0 ? line : line[..colon];
            return head.Contains(' ') || mySymbols.Contains(head);
        }));
        return new RefreshRunDto(r.Id, r.StartedAt, r.FinishedAt, r.Trigger, r.Status, r.SecuritiesUpdated, r.SecuritiesFailed, r.FxRatesStored, log);
    }
}
