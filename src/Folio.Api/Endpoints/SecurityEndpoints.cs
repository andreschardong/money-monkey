using Folio.Api.Auth;
using Folio.Api.Data;
using Folio.Api.MarketData;
using Folio.Api.Portfolios;
using Folio.Core;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;

namespace Folio.Api.Endpoints;

public static class SecurityEndpoints
{
    public static void MapSecurityEndpoints(this IEndpointRouteBuilder api)
    {
        var group = api.MapGroup("/securities").WithTags("Securities");
        group.MapGet("/", List);
        group.MapGet("/search", Search);
        group.MapPost("/", Resolve);
        group.MapPost("/manual", CreateManual);
        group.MapGet("/{id:guid}", Get);
        group.MapGet("/{id:guid}/prices", Prices);
        group.MapPost("/{id:guid}/prices", SetPrice);
        group.MapGet("/{id:guid}/price-on", PriceOn);
        group.MapGet("/{id:guid}/actions", Actions);
    }

    /// <summary>Splits and dividends the quote provider reported, for the history loaded so far.</summary>
    private static async Task<Results<Ok<List<CorporateActionDto>>, NotFound>> Actions(Guid id, FolioDbContext db, CancellationToken ct)
    {
        if (!await db.Securities.AnyAsync(s => s.Id == id, ct))
            return TypedResults.NotFound();

        var actions = await db.CorporateActions.AsNoTracking()
            .Where(a => a.SecurityId == id)
            .OrderByDescending(a => a.Date)
            .Select(a => new CorporateActionDto(a.Date, a.Kind, a.Numerator, a.Denominator, a.Amount))
            .ToListAsync(ct);
        return TypedResults.Ok(actions);
    }

    private static async Task<List<SecurityDto>> List(FolioDbContext db, MarketClock clock, CancellationToken ct)
    {
        var mine = db.Transactions.Where(t => t.SecurityId != null && db.Portfolios.Any(p => p.Id == t.PortfolioId));
        var inUse = (await mine.Select(t => t.SecurityId!.Value).Distinct().ToListAsync(ct)).ToHashSet();
        // My manual securities, plus the shared quoted ones I trade or nobody trades yet.
        var securities = await db.Securities.AsNoTracking()
            .Where(s => s.OwnerId != null || inUse.Contains(s.Id) || !db.Transactions.Any(t => t.SecurityId == s.Id))
            .OrderBy(s => s.Symbol)
            .ToListAsync(ct);
        var quotes = await LatestQuotesAsync(db, securities.Select(s => s.Id).ToList(), ct);
        return securities.Select(s => PortfolioMapper.ToDto(s, quotes.GetValueOrDefault(s.Id), inUse.Contains(s.Id), clock.Today)).ToList();
    }

    private static async Task<Results<Ok<List<SymbolMatchDto>>, ProblemHttpResult>> Search(
        string? q, FolioDbContext db, MarketDataService market, CancellationToken ct)
    {
        var query = q?.Trim() ?? string.Empty;
        if (query.Length == 0)
            return TypedResults.Ok(new List<SymbolMatchDto>());

        // Manually priced securities only exist here, so they are matched locally first.
        var pattern = $"%{query.Replace("%", "").Replace("_", "")}%";
        var local = await db.Securities.AsNoTracking()
            .Where(s => s.PriceSource == PriceSource.Manual && (EF.Functions.ILike(s.Symbol, pattern) || EF.Functions.ILike(s.Name, pattern)))
            .Take(5)
            .ToListAsync(ct);
        var results = local.Select(s => new SymbolMatchDto(s.Symbol, s.Name, "Manual price", s.AssetType, s.Id)).ToList();

        IReadOnlyList<SymbolMatch> matches;
        try
        {
            matches = await market.SearchAsync(query, ct);
        }
        catch (Exception ex) when (MarketDataErrors.IsTransient(ex))
        {
            return results.Count > 0 ? TypedResults.Ok(results) : Problems.Unavailable("Symbol search is unavailable right now. Check your internet connection.");
        }

        var symbols = matches.Select(m => m.Symbol).ToList();
        // My manual security may share a code with a quoted one; the quoted (shared) row is the one a search means.
        var known = (await db.Securities.AsNoTracking().Where(s => symbols.Contains(s.Symbol)).ToListAsync(ct))
            .GroupBy(s => s.Symbol)
            .ToDictionary(g => g.Key, g => (g.FirstOrDefault(s => s.OwnerId == null) ?? g.First()).Id);
        results.AddRange(matches.Select(m => new SymbolMatchDto(m.Symbol, m.Name, m.Exchange, m.AssetType, known.TryGetValue(m.Symbol, out var id) ? id : null)));
        return TypedResults.Ok(results);
    }

    private static async Task<Results<Ok<SecurityDto>, ProblemHttpResult>> Resolve(
        ResolveSecurityRequest request, FolioDbContext db, MarketDataService market, MarketClock clock, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Symbol))
            return Problems.BadRequest("Enter a symbol.");

        var security = await market.ResolveAsync(request.Symbol, request.HistoryFrom, ct);
        return TypedResults.Ok(await ToDtoAsync(db, clock, security, ct));
    }

    private static async Task<Results<Ok<SecurityDto>, ProblemHttpResult>> CreateManual(
        ManualSecurityRequest request, FolioDbContext db, MarketDataService market, MarketClock clock, ICurrentUser user, CancellationToken ct)
    {
        var symbol = request.Symbol?.Trim() ?? string.Empty;
        var currency = Currencies.Normalize(request.Currency);
        if (symbol.Length is 0 or > 32)
            return Problems.BadRequest("Enter a short symbol of up to 32 characters.");
        if (string.IsNullOrWhiteSpace(request.Name) || request.Name.Length > 200)
            return Problems.BadRequest("Enter a name of up to 200 characters.");
        if (!Currencies.IsSupported(currency))
            return Problems.BadRequest($"Unsupported currency {currency}.");
        if (request.Price is <= 0)
            return Problems.BadRequest("The price must be greater than zero.");
        var code = MarketDataService.NormalizeSymbol(symbol);
        if (await db.Securities.AnyAsync(s => s.Symbol == code && (s.OwnerId == user.Id || s.PriceSource == PriceSource.Yahoo), ct))
            return Problems.Conflict($"A security with the symbol {code} already exists.");

        var security = await market.CreateManualAsync(symbol, request.Name, currency, request.AssetType, ct);
        if (request.Price is { } price)
            await market.SetManualPriceAsync(security, request.Date ?? clock.Today, price, ct);
        return TypedResults.Ok(await ToDtoAsync(db, clock, security, ct));
    }

    private static async Task<Results<Ok<SecurityDto>, NotFound>> Get(Guid id, FolioDbContext db, MarketClock clock, CancellationToken ct)
    {
        var security = await db.Securities.AsNoTracking().SingleOrDefaultAsync(s => s.Id == id, ct);
        return security is null ? TypedResults.NotFound() : TypedResults.Ok(await ToDtoAsync(db, clock, security, ct));
    }

    private static async Task<Results<Ok<List<PricePointDto>>, NotFound>> Prices(
        Guid id, string? range, FolioDbContext db, MarketDataService market, MarketClock clock, CancellationToken ct)
    {
        var security = await db.Securities.SingleOrDefaultAsync(s => s.Id == id, ct);
        if (security is null)
            return TypedResults.NotFound();

        var today = clock.Today;
        var from = range?.ToUpperInvariant() switch
        {
            "1M" => today.AddMonths(-1),
            "3M" => today.AddMonths(-3),
            "6M" => today.AddMonths(-6),
            "YTD" => new DateOnly(today.Year, 1, 1),
            "3Y" => today.AddYears(-3),
            "5Y" => today.AddYears(-5),
            "ALL" => await db.Transactions
                .Where(t => t.SecurityId == id && db.Portfolios.Any(p => p.Id == t.PortfolioId))
                .MinAsync(t => (DateOnly?)t.Date, ct) ?? today.AddYears(-1),
            _ => today.AddYears(-1),
        };

        await market.EnsureHistoryAsync(security, from, ct);
        var points = await db.PriceBars.AsNoTracking()
            .Where(b => b.SecurityId == id && b.Date >= from)
            .OrderBy(b => b.Date)
            .Select(b => new PricePointDto(b.Date, b.Close))
            .ToListAsync(ct);
        return TypedResults.Ok(points);
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> SetPrice(
        Guid id, ManualPriceRequest request, FolioDbContext db, MarketDataService market, MarketClock clock, ICurrentUser me, CancellationToken ct)
    {
        var security = await db.Securities.SingleOrDefaultAsync(s => s.Id == id, ct);
        if (security is null)
            return TypedResults.NotFound();
        if (security.OwnerId is not null && security.OwnerId != me.Id)
            return Problems.Forbidden($"Only the account that created {security.Symbol} can set its price.");
        if (security.PriceSource != PriceSource.Manual)
            return Problems.BadRequest($"{security.Symbol} is priced automatically; manual prices are for securities without quotes.");
        if (request.Close <= 0)
            return Problems.BadRequest("The price must be greater than zero.");
        if (request.Date > clock.Today)
            return Problems.BadRequest("The date cannot be in the future.");

        await market.SetManualPriceAsync(security, request.Date, request.Close, ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<Ok<PriceOnDto>, NotFound>> PriceOn(
        Guid id, DateOnly date, FolioDbContext db, MarketDataService market, CancellationToken ct)
    {
        var security = await db.Securities.SingleOrDefaultAsync(s => s.Id == id, ct);
        if (security is null)
            return TypedResults.NotFound();

        var bar = await market.PriceOnAsync(security, date, ct);
        return TypedResults.Ok(new PriceOnDto(id, date, bar?.Date, bar?.Close));
    }

    private static async Task<SecurityDto> ToDtoAsync(FolioDbContext db, MarketClock clock, Security security, CancellationToken ct)
    {
        var quotes = await LatestQuotesAsync(db, [security.Id], ct);
        var inUse = await db.Transactions.AnyAsync(t => t.SecurityId == security.Id && db.Portfolios.Any(p => p.Id == t.PortfolioId), ct);
        return PortfolioMapper.ToDto(security, quotes.GetValueOrDefault(security.Id), inUse, clock.Today);
    }

    /// <summary>
    /// The latest close per security and the one before it. The earlier close is restated across any split between
    /// the two, so an ex-date doesn't read as a 50 % fall.
    /// </summary>
    internal static async Task<Dictionary<Guid, LatestQuote>> LatestQuotesAsync(FolioDbContext db, List<Guid> ids, CancellationToken ct)
    {
        if (ids.Count == 0)
            return [];

        var bars = await db.PriceBars.AsNoTracking()
            .Where(b => ids.Contains(b.SecurityId))
            .GroupBy(b => b.SecurityId)
            .Select(g => g.OrderByDescending(b => b.Date).Take(2).ToList())
            .ToListAsync(ct);
        var withTwo = bars.Where(b => b.Count == 2).ToList();
        var earliest = withTwo.Count > 0 ? withTwo.Min(b => b[1].Date) : DateOnly.MaxValue;
        var splits = await db.CorporateActions.AsNoTracking()
            .Where(a => ids.Contains(a.SecurityId) && a.Kind == CorporateActionKind.Split && a.Date > earliest)
            .ToListAsync(ct);

        return bars.Where(b => b.Count > 0).ToDictionary(b => b[0].SecurityId, b =>
        {
            var last = b[0];
            var previous = b.Count > 1 ? b[1] : null;
            var factor = previous is null ? 1m : splits
                .Where(a => a.SecurityId == last.SecurityId && a.Date > previous.Date && a.Date <= last.Date && a.Denominator > 0)
                .Aggregate(1m, (f, a) => f * a.Numerator / a.Denominator);
            return new LatestQuote(last, previous, factor);
        });
    }
}

/// <summary>The latest close, the one before it, and how many shares one share of the earlier day had become.</summary>
public sealed record LatestQuote(PriceBar Last, PriceBar? Previous, decimal SplitFactor);
