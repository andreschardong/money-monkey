using Folio.Api.Auth;
using Folio.Api.Data;
using Folio.Api.MarketData;
using Folio.Api.Portfolios;
using Folio.Core;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using static Folio.Api.Portfolios.PortfolioMapper;

namespace Folio.Api.Endpoints;

public static class PortfolioEndpoints
{
    public static void MapPortfolioEndpoints(this IEndpointRouteBuilder api)
    {
        var group = api.MapGroup("/portfolios").WithTags("Portfolios");
        group.MapGet("/", List);
        group.MapPost("/", Create);
        group.MapGet("/{id:guid}", Get);
        group.MapPut("/{id:guid}", Update);
        group.MapDelete("/{id:guid}", Delete);
        group.MapGet("/{id:guid}/history", History);
        group.MapGet("/{id:guid}/realized", Realized);
        group.MapGet("/{id:guid}/holdings/{securityId:guid}", Holding);
        group.MapGet("/{id:guid}/suggestions", Suggestions);
        group.MapPost("/{id:guid}/suggestions/dismiss", Dismiss);
        group.MapGet("/{id:guid}/cash", CashEntries);
        group.MapPut("/{id:guid}/cash", SetCash);
        group.MapDelete("/{id:guid}/cash/{currency}/{date}", DeleteCash);
    }

    private static async Task<List<PortfolioSummaryDto>> List(FolioDbContext db, PortfolioCalculator calculator, CancellationToken ct)
    {
        var summaries = new List<PortfolioSummaryDto>();
        foreach (var portfolio in await db.Portfolios.AsNoTracking().OrderBy(p => p.CreatedAt).ToListAsync(ct))
            summaries.Add(ToSummary(await calculator.SnapshotAsync(portfolio, ct)));
        return summaries;
    }

    private static async Task<Results<Created<PortfolioSummaryDto>, ProblemHttpResult>> Create(
        CreatePortfolioRequest request, FolioDbContext db, PortfolioCalculator calculator, TimeProvider time, ICurrentUser user, CancellationToken ct)
    {
        if (ValidatePortfolio(request.Name, request.BaseCurrency, request.Description) is { } problem)
            return problem;
        var country = Countries.Normalize(request.Country);
        if (!Countries.IsCode(country))
            return Problems.BadRequest(Countries.Invalid);
        if (!Enum.IsDefined(request.Kind))
            return Problems.BadRequest("The account type must be Investment or RealEstate.");

        var now = time.GetUtcNow();
        var portfolio = new Portfolio
        {
            Id = Guid.CreateVersion7(),
            OwnerId = user.Id,
            Name = request.Name.Trim(),
            BaseCurrency = Currencies.Normalize(request.BaseCurrency),
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            Country = country,
            Kind = request.Kind,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Portfolios.Add(portfolio);
        await db.SaveChangesAsync(ct);
        return TypedResults.Created($"/api/portfolios/{portfolio.Id}", ToSummary(await calculator.SnapshotAsync(portfolio, ct)));
    }

    private static async Task<Results<Ok<PortfolioDetailDto>, NotFound>> Get(Guid id, FolioDbContext db, PortfolioCalculator calculator, CancellationToken ct)
    {
        var portfolio = await db.Portfolios.AsNoTracking().SingleOrDefaultAsync(p => p.Id == id, ct);
        return portfolio is null ? TypedResults.NotFound() : TypedResults.Ok(ToDetail(await calculator.SnapshotAsync(portfolio, ct)));
    }

    private static async Task<Results<Ok<PortfolioSummaryDto>, NotFound, ProblemHttpResult>> Update(
        Guid id, UpdatePortfolioRequest request, FolioDbContext db, PortfolioCalculator calculator, PortfolioAccess access, TimeProvider time, CancellationToken ct)
    {
        var portfolio = await db.Portfolios.SingleOrDefaultAsync(p => p.Id == id, ct);
        if (portfolio is null)
            return TypedResults.NotFound();
        if (!access.IsOwner(portfolio))
            return Problems.Forbidden("Only the portfolio's owner can rename it.");
        if (ValidatePortfolio(request.Name, request.BaseCurrency, request.Description) is { } problem)
            return problem;

        var country = Countries.Normalize(request.Country);
        if (!Countries.IsCode(country))
            return Problems.BadRequest(Countries.Invalid);
        if (!Enum.IsDefined(request.Kind))
            return Problems.BadRequest("The account type must be Investment or RealEstate.");

        var currency = Currencies.Normalize(request.BaseCurrency);
        if (currency != portfolio.BaseCurrency && await db.Transactions.AnyAsync(t => t.PortfolioId == id, ct))
            return Problems.BadRequest("The currency cannot change once transactions are recorded, because each one stores its exchange rate to it.");

        portfolio.Name = request.Name.Trim();
        portfolio.BaseCurrency = currency;
        portfolio.Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim();
        portfolio.Country = country;
        portfolio.Kind = request.Kind;
        portfolio.UpdatedAt = time.GetUtcNow();
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(ToSummary(await calculator.SnapshotAsync(portfolio, ct)));
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> Delete(Guid id, FolioDbContext db, PortfolioAccess access, CancellationToken ct)
    {
        var portfolio = await db.Portfolios.AsNoTracking().SingleOrDefaultAsync(p => p.Id == id, ct);
        if (portfolio is null)
            return TypedResults.NotFound();
        if (!access.IsOwner(portfolio))
            return Problems.Forbidden("Only the portfolio's owner can delete it.");

        await db.Portfolios.Where(p => p.Id == id).ExecuteDeleteAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<Ok<HistoryDto>, NotFound>> History(
        Guid id, string? range, FolioDbContext db, PortfolioCalculator calculator, CancellationToken ct)
    {
        var portfolio = await db.Portfolios.AsNoTracking().SingleOrDefaultAsync(p => p.Id == id, ct);
        if (portfolio is null)
            return TypedResults.NotFound();

        var transactions = await calculator.LoadTransactionsAsync(id, ct);
        var cash = await calculator.LoadCashAsync(id, ct);
        var history = await HistoryQuery.BuildAsync([(portfolio.BaseCurrency, transactions, cash)], portfolio.BaseCurrency, range, calculator, ct);
        return TypedResults.Ok(history);
    }

    private static async Task<Results<Ok<RealizedReportDto>, NotFound>> Realized(Guid id, FolioDbContext db, PortfolioCalculator calculator, CancellationToken ct)
    {
        var portfolio = await db.Portfolios.AsNoTracking().SingleOrDefaultAsync(p => p.Id == id, ct);
        if (portfolio is null)
            return TypedResults.NotFound();

        var snapshot = await calculator.SnapshotAsync(portfolio, ct);
        var sales = snapshot.Ledger.RealizedGains
            .OrderByDescending(g => g.Date)
            .Select(g =>
            {
                var security = snapshot.Securities[g.SecurityId];
                return new RealizedGainDto(g.EntryId, g.Date, g.SecurityId, security.Symbol, security.Name, g.Quantity, g.Currency,
                    Money(g.ProceedsLocal), Money(g.CostLocal), Money(g.GainLocal), Money(g.ProceedsBase), Money(g.CostBase), Money(g.GainBase));
            })
            .ToList();

        var income = snapshot.Transactions
            .Where(t => t.Type is TransactionType.Dividend or TransactionType.Interest)
            .GroupBy(t => t.Date.Year)
            .ToDictionary(g => g.Key, g => (
                Dividends: g.Where(t => t.Type == TransactionType.Dividend).Sum(t => (t.Amount - t.Fee) * t.FxRate),
                Interest: g.Where(t => t.Type == TransactionType.Interest).Sum(t => t.Amount * t.FxRate),
                Withheld: g.Where(t => t.Type == TransactionType.Dividend).Sum(t => t.Fee * t.FxRate)));
        var years = sales.Select(s => s.Date.Year).Concat(income.Keys).Distinct().OrderDescending()
            .Select(year =>
            {
                var inYear = sales.Where(s => s.Date.Year == year).ToList();
                var (dividends, interest, withheld) = income.GetValueOrDefault(year);
                return new IncomeYearDto(year, inYear.Sum(s => s.Proceeds), inYear.Sum(s => s.CostBasis), inYear.Sum(s => s.Gain),
                    Money(dividends), Money(interest), Money(withheld));
            })
            .ToList();

        return TypedResults.Ok(new RealizedReportDto(portfolio.BaseCurrency, years, sales));
    }

    private static async Task<Results<Ok<HoldingDetailDto>, NotFound>> Holding(
        Guid id, Guid securityId, FolioDbContext db, PortfolioCalculator calculator, CancellationToken ct)
    {
        var portfolio = await db.Portfolios.AsNoTracking().SingleOrDefaultAsync(p => p.Id == id, ct);
        if (portfolio is null)
            return TypedResults.NotFound();

        var snapshot = await calculator.SnapshotAsync(portfolio, ct);
        if (!snapshot.Securities.TryGetValue(securityId, out var security))
            return TypedResults.NotFound();

        var quotes = await SecurityEndpoints.LatestQuotesAsync(db, [securityId], ct);
        var v = snapshot.Valuation;
        var holding = v.Holdings.FirstOrDefault(h => h.Position.SecurityId == securityId);
        var position = snapshot.Ledger.Positions.GetValueOrDefault(securityId);
        var transactions = snapshot.Transactions
            .Where(t => t.SecurityId == securityId)
            .OrderByDescending(t => t.Date)
            .ThenByDescending(t => t.Sequence)
            .Select(ToDto)
            .ToList();

        return TypedResults.Ok(new HoldingDetailDto(
            portfolio.BaseCurrency,
            ToDto(security, quotes.GetValueOrDefault(securityId), inUse: true, calculator.Today),
            holding is null ? null : ToHolding(holding, security, v.TotalValue > 0 ? v.TotalValue : v.HoldingsValue),
            Money(position?.RealizedBase ?? 0m),
            Money(position?.DividendsBase ?? 0m),
            transactions));
    }

    private static async Task<Results<Ok<List<SuggestionDto>>, NotFound>> Suggestions(
        Guid id, FolioDbContext db, SuggestionService suggestions, CancellationToken ct)
    {
        var portfolio = await db.Portfolios.AsNoTracking().SingleOrDefaultAsync(p => p.Id == id, ct);
        return portfolio is null ? TypedResults.NotFound() : TypedResults.Ok(await suggestions.GetAsync(portfolio, ct));
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> Dismiss(
        Guid id, DismissSuggestionRequest request, FolioDbContext db, SuggestionService suggestions, PortfolioAccess access, CancellationToken ct)
    {
        var portfolio = await db.Portfolios.AsNoTracking().SingleOrDefaultAsync(p => p.Id == id, ct);
        if (portfolio is null || !await db.Securities.AnyAsync(s => s.Id == request.SecurityId, ct))
            return TypedResults.NotFound();
        if (!await access.CanEditAsync(portfolio, ct))
            return Problems.Forbidden("This portfolio is shared with you to view only.");

        await suggestions.DismissAsync(portfolio, request, ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<Ok<List<CashEntryDto>>, NotFound>> CashEntries(Guid id, FolioDbContext db, CancellationToken ct)
    {
        if (!await db.Portfolios.AnyAsync(p => p.Id == id, ct))
            return TypedResults.NotFound();

        var entries = await db.CashBalances.AsNoTracking()
            .Where(c => c.PortfolioId == id)
            .OrderByDescending(c => c.Date)
            .ThenBy(c => c.Currency)
            .Select(c => new CashEntryDto(c.Currency, c.Date, c.Balance, c.Note))
            .ToListAsync(ct);
        return TypedResults.Ok(entries);
    }

    /// <summary>Records the cash held in a currency on a date (today by default); the same date is overwritten.</summary>
    private static async Task<Results<Ok<CashEntryDto>, NotFound, ProblemHttpResult>> SetCash(
        Guid id, SetCashRequest request, FolioDbContext db, MarketClock clock, PortfolioAccess access, TimeProvider time, CancellationToken ct)
    {
        var portfolio = await db.Portfolios.AsNoTracking().SingleOrDefaultAsync(p => p.Id == id, ct);
        if (portfolio is null)
            return TypedResults.NotFound();
        if (!await access.CanEditAsync(portfolio, ct))
            return Problems.Forbidden("This portfolio is shared with you to view only.");

        var currency = Currencies.Normalize(request.Currency);
        if (!Currencies.IsSupported(currency))
            return Problems.BadRequest($"Unsupported currency {currency}.");
        var date = request.Date ?? clock.Today;
        if (date > clock.Today)
            return Problems.BadRequest("The date cannot be in the future.");
        if (date < new DateOnly(1970, 1, 1))
            return Problems.BadRequest("The date is too far in the past.");
        if (Math.Abs(request.Balance) > 1_000_000_000_000m)
            return Problems.BadRequest("That balance is out of range.");
        var note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim();
        if (note?.Length > 200)
            return Problems.BadRequest("The note is limited to 200 characters.");

        var entry = await db.CashBalances.SingleOrDefaultAsync(c => c.PortfolioId == id && c.Currency == currency && c.Date == date, ct);
        if (entry is null)
        {
            entry = new CashBalance { PortfolioId = id, Currency = currency, Date = date };
            db.CashBalances.Add(entry);
        }

        entry.Balance = request.Balance;
        entry.Note = note;
        entry.UpdatedAt = time.GetUtcNow();
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(new CashEntryDto(entry.Currency, entry.Date, entry.Balance, entry.Note));
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> DeleteCash(
        Guid id, string currency, DateOnly date, FolioDbContext db, PortfolioAccess access, CancellationToken ct)
    {
        var portfolio = await db.Portfolios.AsNoTracking().SingleOrDefaultAsync(p => p.Id == id, ct);
        if (portfolio is null)
            return TypedResults.NotFound();
        if (!await access.CanEditAsync(portfolio, ct))
            return Problems.Forbidden("This portfolio is shared with you to view only.");

        var code = Currencies.Normalize(currency);
        var deleted = await db.CashBalances.Where(c => c.PortfolioId == id && c.Currency == code && c.Date == date).ExecuteDeleteAsync(ct);
        return deleted == 0 ? TypedResults.NotFound() : TypedResults.NoContent();
    }

    private static ProblemHttpResult? ValidatePortfolio(string? name, string? currency, string? description)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Trim().Length > 100)
            return Problems.BadRequest("Give the portfolio a name of up to 100 characters.");
        if (!Currencies.IsPortfolioCurrency(Currencies.Normalize(currency)))
            return Problems.BadRequest("The portfolio currency must be CAD, USD or EUR.");
        if (description?.Length > 500)
            return Problems.BadRequest("The description is limited to 500 characters.");
        return null;
    }
}
