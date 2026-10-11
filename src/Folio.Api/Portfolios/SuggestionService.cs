using Folio.Api.Data;
using Folio.Api.Endpoints;
using Folio.Api.MarketData;
using Folio.Core;
using Microsoft.EntityFrameworkCore;

namespace Folio.Api.Portfolios;

/// <summary>
/// Compares the splits and dividends reported by the quote provider with what the portfolio has recorded,
/// and suggests the missing ones. Dividends are only suggested for the last few months.
/// </summary>
public sealed class SuggestionService(FolioDbContext db, MarketClock clock)
{
    private const int DividendLookbackDays = 90;
    private const int SplitMatchDays = 5;

    public async Task<List<SuggestionDto>> GetAsync(Portfolio portfolio, CancellationToken ct)
    {
        var transactions = await db.Transactions.AsNoTracking()
            .Include(t => t.Security)
            .Where(t => t.PortfolioId == portfolio.Id)
            .ToListAsync(ct);
        var securities = transactions
            .Where(t => t.Type.IsTrade() && t.Security is not null)
            .Select(t => t.Security!)
            .DistinctBy(s => s.Id)
            .ToDictionary(s => s.Id);
        if (securities.Count == 0)
            return [];

        var entries = LedgerOrder.Sort(transactions.Select(t => t.ToLedgerEntry())).ToList();
        var ids = securities.Keys.ToList();
        var firstDate = entries[0].Date;
        var actions = await db.CorporateActions.AsNoTracking()
            .Where(a => ids.Contains(a.SecurityId) && a.Date > firstDate)
            .OrderBy(a => a.Date)
            .ToListAsync(ct);
        var dismissed = (await db.DismissedSuggestions.AsNoTracking().Where(d => d.PortfolioId == portfolio.Id).ToListAsync(ct))
            .Select(d => (d.SecurityId, d.Date, d.Kind))
            .ToHashSet();

        var dividendCutoff = clock.Today.AddDays(-DividendLookbackDays);
        var matchedDividends = new HashSet<Guid>();
        var suggestions = new List<SuggestionDto>();
        foreach (var action in actions)
        {
            if (action.Kind == CorporateActionKind.Dividend && action.Date < dividendCutoff)
                continue;
            if (dismissed.Contains((action.SecurityId, action.Date, action.Kind)))
                continue;

            var held = SharesHeldBefore(entries, action.SecurityId, action.Date);
            if (held <= 0)
                continue;

            var security = securities[action.SecurityId];
            if (action.Kind == CorporateActionKind.Split)
            {
                var recorded = entries.Any(e => e.Type == TransactionType.Split && e.SecurityId == action.SecurityId
                                                && Math.Abs(e.Date.DayNumber - action.Date.DayNumber) <= SplitMatchDays);
                if (!recorded)
                {
                    suggestions.Add(new SuggestionDto(CorporateActionKind.Split, security.Id, security.Symbol, security.Name, action.Date,
                        security.Currency, action.Denominator, action.Numerator, null, held, null));
                }

                continue;
            }

            // Dividends are usually recorded on the payment date, a few weeks after the ex-date.
            var payment = entries.FirstOrDefault(e => e.Type == TransactionType.Dividend && e.SecurityId == action.SecurityId
                                                      && !matchedDividends.Contains(e.Id)
                                                      && e.Date >= action.Date.AddDays(-7) && e.Date <= action.Date.AddDays(60));
            if (payment is not null)
            {
                matchedDividends.Add(payment.Id);
                continue;
            }

            suggestions.Add(new SuggestionDto(CorporateActionKind.Dividend, security.Id, security.Symbol, security.Name, action.Date,
                security.Currency, null, null, action.Amount, held, decimal.Round(held * action.Amount, 2)));
        }

        return suggestions.OrderByDescending(s => s.Date).ToList();
    }

    public async Task DismissAsync(Portfolio portfolio, DismissSuggestionRequest request, CancellationToken ct)
    {
        var exists = await db.DismissedSuggestions.AnyAsync(d => d.PortfolioId == portfolio.Id && d.SecurityId == request.SecurityId
                                                                 && d.Date == request.Date && d.Kind == request.Kind, ct);
        if (exists)
            return;

        db.DismissedSuggestions.Add(new DismissedSuggestion
        {
            PortfolioId = portfolio.Id,
            SecurityId = request.SecurityId,
            Date = request.Date,
            Kind = request.Kind,
            DismissedAt = clock.UtcNow,
        });
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Shares held at the close before <paramref name="date"/> (the ex-date of a split or dividend).</summary>
    internal static decimal SharesHeldBefore(IEnumerable<LedgerEntry> sorted, Guid securityId, DateOnly date)
    {
        var shares = 0m;
        foreach (var e in sorted)
        {
            if (e.Date >= date)
                break;
            if (e.SecurityId != securityId)
                continue;
            shares = e.Type switch
            {
                TransactionType.Buy or TransactionType.TransferIn => shares + e.Quantity,
                TransactionType.Sell => shares - e.Quantity,
                TransactionType.Split => shares * e.SplitTo / e.SplitFrom,
                _ => shares,
            };
        }

        return shares;
    }
}
