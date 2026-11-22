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

    /// <summary>Access for each portfolio, keyed by id: one query for the shares, one for the other owners' emails.</summary>
    public async Task<IReadOnlyDictionary<Guid, AccessInfo>> DescribeAsync(IReadOnlyCollection<Portfolio> portfolios, CancellationToken ct)
    {
        var ids = portfolios.Select(p => p.Id).ToList();
        var shares = (await db.PortfolioShares.AsNoTracking().Where(s => ids.Contains(s.PortfolioId)).ToListAsync(ct))
            .ToLookup(s => s.PortfolioId);
        var otherOwners = portfolios.Where(p => !IsOwner(p)).Select(p => p.OwnerId).OfType<string>().Distinct().ToList();
        // A lookup rather than a dictionary: an owner it doesn't hold (or a null one) gives no email instead of throwing.
        var ownerEmails = (otherOwners.Count == 0
                ? []
                : await db.Users.Where(u => otherOwners.Contains(u.Id)).Select(u => new OwnerEmail(u.Id, u.Email)).ToListAsync(ct))
            .ToLookup(u => (string?)u.Id, u => u.Email);

        return portfolios.ToDictionary(p => p.Id, p =>
        {
            var count = shares[p.Id].Count();
            if (IsOwner(p))
                return new AccessInfo(AccessInfo.Owner, null, count);

            var canEdit = shares[p.Id].Any(s => s.UserId == user.Id && s.CanEdit);
            return new AccessInfo(canEdit ? AccessInfo.Edit : AccessInfo.View, ownerEmails[p.OwnerId].FirstOrDefault(), count);
        });
    }

    private sealed record OwnerEmail(string Id, string? Email);
}
