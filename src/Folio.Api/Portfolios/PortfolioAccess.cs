using Folio.Api.Auth;
using Folio.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Folio.Api.Portfolios;

/// <summary>What the signed-in account may do with a portfolio: everything as its owner, or what a share allows.</summary>
public sealed record AccessInfo(string Access, string? OwnerEmail, int SharedWith)
{
    public const string Owner = "Owner";
    public const string Edit = "Edit";
    public const string View = "View";
}

public sealed class PortfolioAccess(FolioDbContext db, ICurrentUser user)
{
    public bool IsOwner(Portfolio portfolio) => portfolio.OwnerId == user.Id;

    /// <summary>Owners and accounts the portfolio is shared with "can edit" may change it.</summary>
    public async Task<bool> CanEditAsync(Portfolio portfolio, CancellationToken ct) =>
        IsOwner(portfolio) || await db.PortfolioShares.AnyAsync(s => s.PortfolioId == portfolio.Id && s.UserId == user.Id && s.CanEdit, ct);

    public async Task<AccessInfo> DescribeAsync(Portfolio portfolio, CancellationToken ct)
    {
        var shares = await db.PortfolioShares.AsNoTracking().Where(s => s.PortfolioId == portfolio.Id).ToListAsync(ct);
        if (IsOwner(portfolio))
            return new AccessInfo(AccessInfo.Owner, null, shares.Count);

        var ownerEmail = await db.Users.Where(u => u.Id == portfolio.OwnerId).Select(u => u.Email).FirstOrDefaultAsync(ct);
        var canEdit = shares.Any(s => s.UserId == user.Id && s.CanEdit);
        return new AccessInfo(canEdit ? AccessInfo.Edit : AccessInfo.View, ownerEmail, shares.Count);
    }
}
