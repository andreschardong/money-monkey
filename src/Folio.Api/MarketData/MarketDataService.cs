using Folio.Api.Auth;
using Folio.Api.Data;
using Folio.Core;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Npgsql;

namespace Folio.Api.MarketData;

/// <summary>Stores securities, daily closes, corporate actions and exchange rates, and runs the daily refresh.</summary>
public sealed class MarketDataService(
    FolioDbContext db,
    IQuoteProvider quotes,
    IFallbackQuoteProvider fallback,
    IFxProvider fxProvider,
    MarketClock clock,
    ICurrentUser currentUser,
    IOptions<MarketDataOptions> options,
    ILogger<MarketDataService> logger)
{
    /// <summary>Extra days fetched before a requested date, so an as-of lookup always finds an earlier close.</summary>
    private const int PaddingDays = 10;

    /// <summary>A refresh re-reads this many recent days, picking up late corrections.</summary>
    private const int OverlapDays = 7;

    /// <summary>History for a security that is looked up but not yet traded.</summary>
    private const int DefaultHistoryDays = 30;

    public static string NormalizeSymbol(string symbol) => symbol.Trim().ToUpperInvariant();

    public Task<IReadOnlyList<SymbolMatch>> SearchAsync(string query, CancellationToken ct) => quotes.SearchAsync(query, ct);

    /// <summary>Finds a security by symbol, or creates it from the quote provider, with prices from <paramref name="historyFrom"/>.</summary>
    /// <exception cref="SymbolNotFoundException">The provider does not know the symbol.</exception>
    public async Task<Security> ResolveAsync(string symbol, DateOnly? historyFrom, CancellationToken ct)
    {
        symbol = NormalizeSymbol(symbol);
        var from = historyFrom ?? clock.Today.AddDays(-DefaultHistoryDays);
        var security = await db.Securities.SingleOrDefaultAsync(s => s.Symbol == symbol && s.OwnerId == null, ct);
        if (security is not null)
        {
            await EnsureHistoryAsync(security, from, ct);
            return security;
        }

        var fetchFrom = from.AddDays(-PaddingDays);
        var history = await quotes.GetHistoryAsync(symbol, fetchFrom, clock.Today, ct);
        if (!Currencies.IsSupported(history.Info.Currency))
            throw new MarketDataException($"{symbol} trades in {history.Info.Currency}, which Folio cannot convert.");

        // The provider may report a canonical symbol that is already stored under that name.
        var canonical = NormalizeSymbol(history.Info.Symbol);
        if (canonical != symbol && await db.Securities.SingleOrDefaultAsync(s => s.Symbol == canonical && s.OwnerId == null, ct) is { } known)
        {
            await EnsureHistoryAsync(known, from, ct);
            return known;
        }

        security = new Security
        {
            Id = Guid.CreateVersion7(),
            Symbol = canonical,
            Name = Truncate(history.Info.Name, 200),
            Currency = history.Info.Currency,
            Exchange = history.Info.Exchange is null ? null : Truncate(history.Info.Exchange, 40),
            AssetType = history.Info.AssetType,
            PriceSource = PriceSource.Yahoo,
            HistoryStart = fetchFrom,
            CreatedAt = clock.UtcNow,
        };
        db.Securities.Add(security);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            // Another request stored the same symbol a moment ago.
            db.Entry(security).State = EntityState.Detached;
            return await db.Securities.SingleAsync(s => s.Symbol == canonical && s.OwnerId == null, ct);
        }

        await StoreHistoryAsync(security, history, ct);
        await db.SaveChangesAsync(ct);
        return security;
    }

    /// <summary>Makes sure daily closes reach back to <paramref name="from"/>. Failures are recorded, not thrown.</summary>
    public async Task EnsureHistoryAsync(Security security, DateOnly from, CancellationToken ct)
    {
        if (security.PriceSource != PriceSource.Yahoo || security.HistoryStart <= from)
            return;

        var fetchFrom = from.AddDays(-PaddingDays);
        try
        {
            // Always read through today: the response must include every later split to restate old closes.
            var history = await quotes.GetHistoryAsync(security.Symbol, fetchFrom, clock.Today, ct);
            await StoreHistoryAsync(security, history, ct);
            security.HistoryStart = fetchFrom;
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            logger.LogWarning(ex, "Could not load history for {Symbol}", security.Symbol);
            security.LastRefreshError = Truncate(ex.Message, 500);
        }

        await db.SaveChangesAsync(ct);
    }

    /// <summary>Makes sure exchange rates for each currency reach back to <paramref name="from"/>.</summary>
    public async Task EnsureFxAsync(IEnumerable<string> currencies, DateOnly from, CancellationToken ct)
    {
        foreach (var currency in currencies.Where(c => c != Currencies.Cad).Distinct())
        {
            var earliest = await db.FxRates.Where(r => r.Currency == currency).MinAsync(r => (DateOnly?)r.Date, ct);
            if (earliest <= from)
                continue;

            var observations = await fxProvider.GetCadRatesAsync([currency], from.AddDays(-PaddingDays), earliest ?? clock.Today, ct);
            await StoreFxAsync(observations, ct);
        }
    }

    public async Task<Security> CreateManualAsync(string symbol, string name, string currency, AssetType assetType, CancellationToken ct)
    {
        symbol = NormalizeSymbol(symbol);
        // Taken when I already use the code, or it is a quoted symbol everyone shares.
        if (await db.Securities.AnyAsync(s => s.Symbol == symbol && (s.OwnerId == currentUser.Id || s.PriceSource == PriceSource.Yahoo), ct))
            throw new InvalidOperationException($"A security with the symbol {symbol} already exists.");

        var security = new Security
        {
            Id = Guid.CreateVersion7(),
            OwnerId = currentUser.Id ?? throw new InvalidOperationException("Sign in to add a security."),
            Symbol = symbol,
            Name = name.Trim(),
            Currency = currency,
            AssetType = assetType,
            PriceSource = PriceSource.Manual,
            CreatedAt = clock.UtcNow,
        };
        db.Securities.Add(security);
        await db.SaveChangesAsync(ct);
        return security;
    }

    public async Task SetManualPriceAsync(Security security, DateOnly date, decimal close, CancellationToken ct)
    {
        await UpsertBarsAsync(security.Id, [new PricePoint(date, close)], PriceSource.Manual, ct);
        security.LastRefreshAt = clock.UtcNow;
        await db.SaveChangesAsync(ct);
    }

    /// <summary>The close on or before <paramref name="date"/>, loading older history first when needed.</summary>
    public async Task<PriceBar?> PriceOnAsync(Security security, DateOnly date, CancellationToken ct)
    {
        await EnsureHistoryAsync(security, date, ct);
        return await db.PriceBars.AsNoTracking()
            .Where(b => b.SecurityId == security.Id && b.Date <= date)
            .OrderByDescending(b => b.Date)
            .FirstOrDefaultAsync(ct);
    }

    /// <summary>Updates exchange rates and the closes of every traded security; the run is logged in the database.</summary>
    public async Task<RefreshRun> RefreshAllAsync(string trigger, CancellationToken ct)
    {
        var run = new RefreshRun { StartedAt = clock.UtcNow, Trigger = trigger, Status = RefreshStatus.Running };
        db.RefreshRuns.Add(run);
        await db.SaveChangesAsync(ct);

        var log = new List<string>();
        try
        {
            var (fxStored, fxOk) = await RefreshFxAsync(log, ct);
            run.FxRatesStored = fxStored;

            var securities = await db.Securities
                .Where(s => s.PriceSource == PriceSource.Yahoo && db.Transactions.Any(t => t.SecurityId == s.Id))
                .OrderBy(s => s.Symbol)
                .ToListAsync(ct);

            var fallbackCalls = 0;
            foreach (var security in securities)
            {
                var updated = await RefreshSecurityAsync(security, log, ct);
                if (!updated && fallback.IsConfigured && fallbackCalls < options.Value.AlphaVantageMaxCallsPerRun)
                {
                    fallbackCalls++;
                    updated = await TryFallbackAsync(security, log, ct);
                }

                if (updated)
                    run.SecuritiesUpdated++;
                else
                    run.SecuritiesFailed++;
                await db.SaveChangesAsync(ct);
                await Task.Delay(options.Value.RequestDelayMilliseconds, ct);
            }

            // Without fresh exchange rates every foreign value is stale, so the run counts as failed and is retried.
            run.Status = !fxOk ? RefreshStatus.Failed
                : run.SecuritiesFailed == 0 ? RefreshStatus.Succeeded
                : run.SecuritiesUpdated > 0 ? RefreshStatus.PartiallySucceeded
                : RefreshStatus.Failed;
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            logger.LogError(ex, "Market data refresh failed");
            log.Add($"Refresh failed: {ex.Message}");
            run.Status = RefreshStatus.Failed;
        }
        finally
        {
            run.FinishedAt = clock.UtcNow;
            run.Status = run.Status == RefreshStatus.Running ? RefreshStatus.Failed : run.Status;
            run.Log = string.Join('\n', log);
            await db.SaveChangesAsync(CancellationToken.None);
        }

        logger.LogInformation("Market data refresh {Status}: {Updated} updated, {Failed} failed, {Fx} FX rates",
            run.Status, run.SecuritiesUpdated, run.SecuritiesFailed, run.FxRatesStored);
        return run;
    }

    private async Task<(int Stored, bool Ok)> RefreshFxAsync(List<string> log, CancellationToken ct)
    {
        var currencies = new HashSet<string>(Currencies.PortfolioCurrencies);
        currencies.UnionWith(await db.Securities.IgnoreQueryFilters().Select(s => s.Currency).Distinct().ToListAsync(ct));
        currencies.UnionWith(await db.Transactions.Select(t => t.Currency).Distinct().ToListAsync(ct));
        currencies.UnionWith(await db.CashBalances.Select(c => c.Currency).Distinct().ToListAsync(ct));
        currencies.UnionWith(await db.Portfolios.IgnoreQueryFilters().Select(p => p.BaseCurrency).Distinct().ToListAsync(ct));
        currencies.Remove(Currencies.Cad);

        var latest = await db.FxRates.GroupBy(r => r.Currency)
            .Select(g => new { Currency = g.Key, Date = g.Max(r => r.Date) })
            .ToDictionaryAsync(x => x.Currency, x => x.Date, ct);
        var firstTrade = await db.Transactions.MinAsync(t => (DateOnly?)t.Date, ct);
        var from = currencies
            .Select(c => latest.TryGetValue(c, out var d) ? d.AddDays(-OverlapDays) : (firstTrade ?? clock.Today.AddDays(-DefaultHistoryDays)).AddDays(-PaddingDays))
            .DefaultIfEmpty(clock.Today)
            .Min();

        try
        {
            var stored = await StoreFxAsync(await fxProvider.GetCadRatesAsync(currencies, from, clock.Today, ct), ct);
            log.Add($"Exchange rates: {stored} stored ({string.Join(", ", currencies.Order())}).");
            return (stored, true);
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            logger.LogWarning(ex, "Exchange rate refresh failed");
            log.Add($"Exchange rates failed: {ex.Message}");
            return (0, false);
        }
    }

    private async Task<bool> RefreshSecurityAsync(Security security, List<string> log, CancellationToken ct)
    {
        var lastBar = await db.PriceBars.Where(b => b.SecurityId == security.Id).MaxAsync(b => (DateOnly?)b.Date, ct);
        var from = lastBar?.AddDays(-OverlapDays) ?? security.HistoryStart ?? clock.Today.AddDays(-DefaultHistoryDays);
        try
        {
            var history = await quotes.GetHistoryAsync(security.Symbol, from, clock.Today, ct);
            await StoreHistoryAsync(security, history, ct);
            var last = history.Bars.Count > 0 ? history.Bars[^1] : (PricePoint?)null;
            log.Add(last is { } bar ? $"{security.Symbol}: {bar.Close} on {bar.Date:yyyy-MM-dd}." : $"{security.Symbol}: no new closes.");
            return true;
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            logger.LogWarning(ex, "Quote refresh failed for {Symbol}", security.Symbol);
            security.LastRefreshError = Truncate(ex.Message, 500);
            log.Add($"{security.Symbol}: {ex.Message}");
            return false;
        }
    }

    private async Task<bool> TryFallbackAsync(Security security, List<string> log, CancellationToken ct)
    {
        try
        {
            if (await fallback.GetLatestAsync(security.Symbol, security.Currency, ct) is not { } quote)
                return false;

            await UpsertBarsAsync(security.Id, [quote], PriceSource.AlphaVantage, ct);
            security.LastRefreshAt = clock.UtcNow;
            security.LastRefreshError = null;
            log.Add($"{security.Symbol}: {quote.Close} on {quote.Date:yyyy-MM-dd} from Alpha Vantage.");
            return true;
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            logger.LogWarning(ex, "Alpha Vantage fallback failed for {Symbol}", security.Symbol);
            return false;
        }
    }

    private async Task StoreHistoryAsync(Security security, PriceHistory history, CancellationToken ct)
    {
        await UpsertBarsAsync(security.Id, history.Bars, PriceSource.Yahoo, ct);

        var actions = history.Splits
            .Select(a => (a.Date, Kind: CorporateActionKind.Split, a.Numerator, a.Denominator, Amount: 0m))
            .Concat(history.Dividends.Select(d => (d.Date, Kind: CorporateActionKind.Dividend, Numerator: 0m, Denominator: 0m, d.Amount)))
            .DistinctBy(a => (a.Date, a.Kind))
            .ToList();
        if (actions.Count > 0)
        {
            await db.Database.ExecuteSqlRawAsync(
                """
                INSERT INTO corporate_actions (security_id, date, kind, numerator, denominator, amount)
                SELECT @security_id, t.date, t.kind, t.numerator, t.denominator, t.amount
                FROM unnest(@dates, @kinds, @numerators, @denominators, @amounts) AS t(date, kind, numerator, denominator, amount)
                ON CONFLICT (security_id, date, kind) DO UPDATE
                SET numerator = EXCLUDED.numerator, denominator = EXCLUDED.denominator, amount = EXCLUDED.amount
                """,
                [
                    new NpgsqlParameter("security_id", security.Id),
                    new NpgsqlParameter("dates", actions.Select(a => a.Date).ToArray()),
                    new NpgsqlParameter("kinds", actions.Select(a => a.Kind.ToString()).ToArray()),
                    new NpgsqlParameter("numerators", actions.Select(a => a.Numerator).ToArray()),
                    new NpgsqlParameter("denominators", actions.Select(a => a.Denominator).ToArray()),
                    new NpgsqlParameter("amounts", actions.Select(a => a.Amount).ToArray()),
                ],
                ct);
        }

        if (!string.IsNullOrWhiteSpace(history.Info.Name))
            security.Name = Truncate(history.Info.Name, 200);
        security.LastRefreshAt = clock.UtcNow;
        security.LastRefreshError = null;
    }

    /// <summary>
    /// Inserts or corrects daily closes in one statement. Upserting (rather than read-then-insert) keeps a refresh and a
    /// transaction that loads the same history at the same moment from colliding on the primary key.
    /// </summary>
    private async Task UpsertBarsAsync(Guid securityId, IReadOnlyList<PricePoint> bars, PriceSource source, CancellationToken ct)
    {
        if (bars.Count == 0)
            return;

        var unique = bars.DistinctBy(b => b.Date).ToList();
        await db.Database.ExecuteSqlRawAsync(
            """
            INSERT INTO price_bars (security_id, date, close, source)
            SELECT @security_id, t.date, t.close, @source
            FROM unnest(@dates, @closes) AS t(date, close)
            ON CONFLICT (security_id, date) DO UPDATE
            SET close = EXCLUDED.close, source = EXCLUDED.source
            WHERE price_bars.close IS DISTINCT FROM EXCLUDED.close OR price_bars.source IS DISTINCT FROM EXCLUDED.source
            """,
            [
                new NpgsqlParameter("security_id", securityId),
                new NpgsqlParameter("source", source.ToString()),
                new NpgsqlParameter("dates", unique.Select(b => b.Date).ToArray()),
                new NpgsqlParameter("closes", unique.Select(b => b.Close).ToArray()),
            ],
            ct);
    }

    /// <summary>Upserts exchange rates; returns how many were new or changed.</summary>
    private async Task<int> StoreFxAsync(IReadOnlyList<FxObservation> observations, CancellationToken ct)
    {
        var unique = observations.DistinctBy(o => (o.Currency, o.Date)).ToList();
        if (unique.Count == 0)
            return 0;

        return await db.Database.ExecuteSqlRawAsync(
            """
            INSERT INTO fx_rates (currency, date, cad_per_unit, source)
            SELECT t.currency, t.date, t.rate, t.source
            FROM unnest(@currencies, @dates, @rates, @sources) AS t(currency, date, rate, source)
            ON CONFLICT (currency, date) DO UPDATE
            SET cad_per_unit = EXCLUDED.cad_per_unit, source = EXCLUDED.source
            WHERE fx_rates.cad_per_unit IS DISTINCT FROM EXCLUDED.cad_per_unit
            """,
            [
                new NpgsqlParameter("currencies", unique.Select(o => o.Currency).ToArray()),
                new NpgsqlParameter("dates", unique.Select(o => o.Date).ToArray()),
                new NpgsqlParameter("rates", unique.Select(o => o.CadPerUnit).ToArray()),
                new NpgsqlParameter("sources", unique.Select(o => o.Source).ToArray()),
            ],
            ct);
    }

    private static string Truncate(string text, int length) => text.Length <= length ? text : text[..length];
}
