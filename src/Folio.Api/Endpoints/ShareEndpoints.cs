using Folio.Api.Auth;
using Folio.Api.Data;
using Folio.Api.Portfolios;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Folio.Api.Endpoints;

/// <summary>Sharing a portfolio with another Folio account, to view or to edit. Only the owner manages shares.</summary>
public static class ShareEndpoints
{
    public static void MapShareEndpoints(this IEndpointRouteBuilder api)
    {
        var group = api.MapGroup("/portfolios/{id:guid}/shares").WithTags("Sharing");
        group.MapGet("/", List);
        group.MapPut("/", Share);
        group.MapDelete("/", Unshare);
    }

    private static async Task<Results<Ok<List<ShareDto>>, NotFound, ProblemHttpResult>> List(
        Guid id, FolioDbContext db, PortfolioAccess access, CancellationToken ct)
    {
        var portfolio = await db.Portfolios.AsNoTracking().SingleOrDefaultAsync(p => p.Id == id, ct);
        if (portfolio is null)
            return TypedResults.NotFound();
        if (!access.IsOwner(portfolio))
            return Problems.Forbidden("Only the portfolio's owner can see who it is shared with.");

        return TypedResults.Ok(await SharesAsync(db, id, ct));
    }

    private static async Task<Results<Ok<List<ShareDto>>, NotFound, ProblemHttpResult>> Share(
        Guid id, ShareRequest request, FolioDbContext db, PortfolioAccess access, UserManager<AppUser> users,
        ICurrentUser me, TimeProvider time, CancellationToken ct)
    {
        var portfolio = await db.Portfolios.AsNoTracking().SingleOrDefaultAsync(p => p.Id == id, ct);
        if (portfolio is null)
            return TypedResults.NotFound();
        if (!access.IsOwner(portfolio))
            return Problems.Forbidden("Only the portfolio's owner can share it.");

        var email = request.Email?.Trim() ?? string.Empty;
        var user = email.Length == 0 ? null : await users.FindByEmailAsync(email);
        if (user is null || !user.EmailConfirmed)
            return Problems.BadRequest("No active Folio account uses that email. They need to sign up and activate their account first.");
        if (user.Id == me.Id)
            return Problems.BadRequest("That's your own account.");

        var share = await db.PortfolioShares.SingleOrDefaultAsync(s => s.PortfolioId == id && s.UserId == user.Id, ct);
        if (share is null)
        {
            share = new PortfolioShare { PortfolioId = id, UserId = user.Id, CreatedAt = time.GetUtcNow() };
            db.PortfolioShares.Add(share);
        }

        share.CanEdit = request.CanEdit;
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(await SharesAsync(db, id, ct));
    }

    private static async Task<Results<Ok<List<ShareDto>>, NotFound, ProblemHttpResult>> Unshare(
        Guid id, string email, FolioDbContext db, PortfolioAccess access, UserManager<AppUser> users, CancellationToken ct)
    {
        var portfolio = await db.Portfolios.AsNoTracking().SingleOrDefaultAsync(p => p.Id == id, ct);
        if (portfolio is null)
            return TypedResults.NotFound();
        if (!access.IsOwner(portfolio))
            return Problems.Forbidden("Only the portfolio's owner can change sharing.");

        var user = await users.FindByEmailAsync(email.Trim());
        if (user is not null)
            await db.PortfolioShares.Where(s => s.PortfolioId == id && s.UserId == user.Id).ExecuteDeleteAsync(ct);
        return TypedResults.Ok(await SharesAsync(db, id, ct));
    }

    private static Task<List<ShareDto>> SharesAsync(FolioDbContext db, Guid id, CancellationToken ct) =>
        db.PortfolioShares.AsNoTracking()
            .Where(s => s.PortfolioId == id)
            .Join(db.Users, s => s.UserId, u => u.Id, (s, u) => new { Share = s, User = u })
            .OrderBy(x => x.User.Email)
            .Select(x => new ShareDto(x.User.Email!, x.Share.CanEdit, x.Share.CreatedAt))
            .ToListAsync(ct);
}
