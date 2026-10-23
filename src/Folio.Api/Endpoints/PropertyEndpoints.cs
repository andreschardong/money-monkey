using Folio.Api.Auth;
using Folio.Api.Data;
using Folio.Api.MarketData;
using Folio.Api.Portfolios;
using Folio.Core;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;

namespace Folio.Api.Endpoints;

/// <summary>
/// A property is a manually priced holding of one unit. Adding one creates the security, its values and the purchase
/// in one database transaction, so a refused purchase never leaves a stray security holding the name.
/// </summary>
public static class PropertyEndpoints
{
    public static void MapPropertyEndpoints(this IEndpointRouteBuilder api)
    {
        api.MapPost("/portfolios/{portfolioId:guid}/properties", Add).WithTags("Transactions");
    }

    private static async Task<Results<Created<TransactionDto>, NotFound, ProblemHttpResult>> Add(
        Guid portfolioId, PropertyRequest request, FolioDbContext db, MarketDataService market, TransactionWriter writer,
        PortfolioAccess access, MarketClock clock, ICurrentUser user, CancellationToken ct)
    {
        var portfolio = await db.Portfolios.SingleOrDefaultAsync(p => p.Id == portfolioId, ct);
        if (portfolio is null)
            return TypedResults.NotFound();
        if (!await access.CanEditAsync(portfolio, ct))
            return Problems.Forbidden("This portfolio is shared with you to view only.");
        if (portfolio.Kind != PortfolioKind.RealEstate)
            return Problems.BadRequest("Properties go in a real-estate portfolio. Change the account type under Edit portfolio first.");

        var name = request.Name?.Trim() ?? string.Empty;
        var description = string.IsNullOrWhiteSpace(request.Description) ? name : request.Description.Trim();
        if (name.Length is 0 or > 32)
            return Problems.BadRequest("Enter a short name of up to 32 characters.");
        if (description.Length > 200)
            return Problems.BadRequest("The address or description is limited to 200 characters.");
        if (request.PurchaseDate > clock.Today)
            return Problems.BadRequest("The purchase date cannot be in the future.");
        if (request.PurchasePrice <= 0)
            return Problems.BadRequest("The purchase price must be greater than zero.");
        if (request.ClosingCosts is < 0)
            return Problems.BadRequest("Closing costs cannot be negative.");
        if (request.CurrentValue is <= 0)
            return Problems.BadRequest("The value today must be greater than zero.");
        var code = MarketDataService.NormalizeSymbol(name);
        if (await db.Securities.AnyAsync(s => s.Symbol == code && (s.OwnerId == user.Id || s.PriceSource == PriceSource.Yahoo), ct))
            return Problems.Conflict($"You already have a holding called {code}. Choose another name.");

        // The property is priced in the portfolio's currency, so the purchase never needs an exchange rate.
        await using var scope = await db.Database.BeginTransactionAsync(ct);
        var security = await market.CreateManualAsync(name, description, portfolio.BaseCurrency, AssetType.RealEstate, ct);
        await market.SetManualPriceAsync(security, request.PurchaseDate, request.PurchasePrice, ct);
        if (request.CurrentValue is { } value)
            await market.SetManualPriceAsync(security, clock.Today, value, ct);

        var result = await writer.CreateAsync(portfolio, new TransactionRequest(
            TransactionType.Buy, request.PurchaseDate, security.Id, Quantity: 1m, Price: request.PurchasePrice, Fee: request.ClosingCosts), ct);
        if (result.Error is not null)
            return Problems.BadRequest(result.Error);
        await scope.CommitAsync(ct);

        var buy = PortfolioMapper.ToDto(result.Transactions[0]);
        return TypedResults.Created($"/api/portfolios/{portfolioId}/transactions/{buy.Id}", buy);
    }
}
