using Folio.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Folio.Api.Portfolios;

/// <summary>Portfolio queries shared by the views that add every portfolio together.</summary>
public static class PortfolioQueries
{
    /// <summary>
    /// The portfolios the overview and All assets count, in creation order. Real-estate portfolios are left out when
    /// <paramref name="excludeRealEstate"/> is true, so net worth can be read as investments only.
    /// </summary>
    public static async Task<List<Portfolio>> IncludedAsync(this IQueryable<Portfolio> portfolios, bool? excludeRealEstate, CancellationToken ct)
    {
        if (excludeRealEstate == true)
            portfolios = portfolios.Where(p => p.Kind != PortfolioKind.RealEstate);
        return await portfolios.AsNoTracking().OrderBy(p => p.CreatedAt).ToListAsync(ct);
    }
}
