using Folio.Api.Data;
using Folio.Api.Portfolios;
using Folio.Core;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;

namespace Folio.Api.Endpoints;

public static class TransactionEndpoints
{
    private const string ViewOnly = "This portfolio is shared with you to view only.";

    public static void MapTransactionEndpoints(this IEndpointRouteBuilder api)
    {
        var group = api.MapGroup("/portfolios/{portfolioId:guid}/transactions").WithTags("Transactions");
        group.MapGet("/", List);
        group.MapPost("/", Create);
        group.MapPut("/{transactionId:guid}", Update);
        group.MapDelete("/{transactionId:guid}", Delete);
    }

    private static async Task<Results<Ok<List<TransactionDto>>, NotFound>> List(
        Guid portfolioId, Guid? securityId, TransactionType? type, FolioDbContext db, CancellationToken ct)
    {
        if (!await db.Portfolios.AnyAsync(p => p.Id == portfolioId, ct))
            return TypedResults.NotFound();

        var query = db.Transactions.AsNoTracking().Include(t => t.Security).Where(t => t.PortfolioId == portfolioId);
        if (securityId is not null)
            query = query.Where(t => t.SecurityId == securityId);
        if (type is not null)
            query = query.Where(t => t.Type == type);

        var transactions = await query.OrderByDescending(t => t.Date).ThenByDescending(t => t.Sequence).ToListAsync(ct);
        return TypedResults.Ok(transactions.Select(PortfolioMapper.ToDto).ToList());
    }

    private static async Task<Results<Created<List<TransactionDto>>, NotFound, ProblemHttpResult>> Create(
        Guid portfolioId, TransactionRequest request, FolioDbContext db, TransactionWriter writer, PortfolioAccess access, CancellationToken ct)
    {
        var portfolio = await db.Portfolios.SingleOrDefaultAsync(p => p.Id == portfolioId, ct);
        if (portfolio is null)
            return TypedResults.NotFound();
        if (!await access.CanEditAsync(portfolio, ct))
            return Problems.Forbidden(ViewOnly);

        var result = await writer.CreateAsync(portfolio, request, ct);
        if (result.Error is not null)
            return Problems.BadRequest(result.Error);

        var created = result.Transactions.Select(PortfolioMapper.ToDto).ToList();
        return TypedResults.Created($"/api/portfolios/{portfolioId}/transactions/{created[^1].Id}", created);
    }

    private static async Task<Results<Ok<TransactionDto>, NotFound, ProblemHttpResult>> Update(
        Guid portfolioId, Guid transactionId, TransactionRequest request, FolioDbContext db, TransactionWriter writer, PortfolioAccess access, CancellationToken ct)
    {
        var portfolio = await db.Portfolios.SingleOrDefaultAsync(p => p.Id == portfolioId, ct);
        var transaction = await db.Transactions.Include(t => t.Security)
            .SingleOrDefaultAsync(t => t.Id == transactionId && t.PortfolioId == portfolioId, ct);
        if (portfolio is null || transaction is null)
            return TypedResults.NotFound();
        if (!await access.CanEditAsync(portfolio, ct))
            return Problems.Forbidden(ViewOnly);

        var result = await writer.UpdateAsync(portfolio, transaction, request, ct);
        return result.Error is null
            ? TypedResults.Ok(PortfolioMapper.ToDto(result.Transactions[0]))
            : Problems.BadRequest(result.Error);
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> Delete(
        Guid portfolioId, Guid transactionId, FolioDbContext db, TransactionWriter writer, PortfolioAccess access, CancellationToken ct)
    {
        var portfolio = await db.Portfolios.SingleOrDefaultAsync(p => p.Id == portfolioId, ct);
        var transaction = await db.Transactions.SingleOrDefaultAsync(t => t.Id == transactionId && t.PortfolioId == portfolioId, ct);
        if (portfolio is null || transaction is null)
            return TypedResults.NotFound();
        if (!await access.CanEditAsync(portfolio, ct))
            return Problems.Forbidden(ViewOnly);

        var error = await writer.DeleteAsync(portfolio, transaction, ct);
        return error is null ? TypedResults.NoContent() : Problems.BadRequest(error);
    }
}
