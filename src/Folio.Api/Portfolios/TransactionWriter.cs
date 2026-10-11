using Folio.Api.Data;
using Folio.Api.Endpoints;
using Folio.Api.MarketData;
using Folio.Core;
using Microsoft.EntityFrameworkCore;

namespace Folio.Api.Portfolios;

public sealed record WriteResult(IReadOnlyList<Transaction> Transactions, string? Error)
{
    public static WriteResult Fail(string error) => new([], error);
}

/// <summary>
/// Turns requests into transactions and saves them only when the whole ledger still replays cleanly,
/// so a back-dated sell or a deleted buy can never leave holdings negative.
/// </summary>
public sealed class TransactionWriter(FolioDbContext db, MarketDataService market, PortfolioCalculator calculator, MarketClock clock)
{
    private static readonly DateOnly EarliestDate = new(1970, 1, 1);

    public async Task<WriteResult> CreateAsync(Portfolio portfolio, TransactionRequest request, CancellationToken ct)
    {
        var (transaction, error) = await BuildAsync(portfolio, request, ct);
        if (transaction is null)
            return WriteResult.Fail(error!);

        var sequence = await db.Transactions.Where(t => t.PortfolioId == portfolio.Id).MaxAsync(t => (long?)t.Sequence, ct) ?? 0;
        transaction.Sequence = sequence + 1;

        var entries = await LoadEntriesAsync(portfolio.Id, ct);
        entries.Add(transaction.ToLedgerEntry());
        if (Validate(portfolio, entries, transaction.Id) is { } problem)
            return WriteResult.Fail(problem);

        db.Transactions.Add(transaction);
        await db.SaveChangesAsync(ct);
        return new WriteResult([transaction], null);
    }

    public async Task<WriteResult> UpdateAsync(Portfolio portfolio, Transaction existing, TransactionRequest request, CancellationToken ct)
    {
        var (built, error) = await BuildAsync(portfolio, request, ct);
        if (built is null)
            return WriteResult.Fail(error!);

        existing.Type = built.Type;
        existing.Date = built.Date;
        existing.SecurityId = built.SecurityId;
        existing.Security = built.Security;
        existing.Currency = built.Currency;
        existing.Quantity = built.Quantity;
        existing.Price = built.Price;
        existing.Amount = built.Amount;
        existing.Fee = built.Fee;
        existing.FxRate = built.FxRate;
        existing.SplitFrom = built.SplitFrom;
        existing.SplitTo = built.SplitTo;
        existing.Note = built.Note;
        existing.UpdatedAt = clock.UtcNow;

        var entries = await LoadEntriesAsync(portfolio.Id, ct);
        entries.RemoveAll(e => e.Id == existing.Id);
        entries.Add(existing.ToLedgerEntry());
        if (Validate(portfolio, entries, existing.Id) is { } problem)
            return WriteResult.Fail(problem);

        await db.SaveChangesAsync(ct);
        return new WriteResult([existing], null);
    }

    public async Task<string?> DeleteAsync(Portfolio portfolio, Transaction existing, CancellationToken ct)
    {
        var entries = await LoadEntriesAsync(portfolio.Id, ct);
        entries.RemoveAll(e => e.Id == existing.Id);
        if (Validate(portfolio, entries, null) is { } problem)
            return problem;

        db.Transactions.Remove(existing);
        await db.SaveChangesAsync(ct);
        return null;
    }

    private async Task<List<LedgerEntry>> LoadEntriesAsync(Guid portfolioId, CancellationToken ct) =>
        (await db.Transactions.AsNoTracking().Where(t => t.PortfolioId == portfolioId).ToListAsync(ct))
            .Select(t => t.ToLedgerEntry())
            .ToList();

    private static string? Validate(Portfolio portfolio, List<LedgerEntry> entries, Guid? changedId)
    {
        try
        {
            PortfolioLedger.Replay(portfolio.BaseCurrency, entries);
            return null;
        }
        catch (LedgerException ex) when (ex.EntryId != changedId && entries.FirstOrDefault(e => e.Id == ex.EntryId) is { } other)
        {
            return $"This would break the {Describe(other.Type)} on {other.Date:yyyy-MM-dd}: {ex.Message}";
        }
        catch (LedgerException ex)
        {
            return ex.Message;
        }
    }

    private async Task<(Transaction? Transaction, string? Error)> BuildAsync(Portfolio portfolio, TransactionRequest request, CancellationToken ct)
    {
        var type = request.Type;
        if (!Enum.IsDefined(type))
            return (null, "Unknown transaction type.");
        if (request.Date > clock.Today)
            return (null, "The date cannot be in the future.");
        if (request.Date < EarliestDate)
            return (null, "The date is too far in the past.");
        var note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim();
        if (note?.Length > 500)
            return (null, "The note is limited to 500 characters.");

        Security? security = null;
        if (type.RequiresSecurity())
        {
            try
            {
                if (request.SecurityId is { } id)
                {
                    security = await db.Securities.SingleOrDefaultAsync(s => s.Id == id, ct);
                    if (security is null)
                        return (null, "That security no longer exists.");
                    await market.EnsureHistoryAsync(security, request.Date, ct);
                }
                else if (!string.IsNullOrWhiteSpace(request.Symbol))
                {
                    security = await market.ResolveAsync(request.Symbol, request.Date, ct);
                }
                else
                {
                    return (null, "Choose a stock or fund.");
                }
            }
            catch (SymbolNotFoundException ex)
            {
                return (null, ex.Message);
            }
            catch (Exception ex) when (!ct.IsCancellationRequested && MarketDataErrors.IsTransient(ex))
            {
                return (null, $"Could not look up {request.Symbol} right now ({ex.Message}). Try again, or add it with a manual price.");
            }
        }

        var now = clock.UtcNow;
        var transaction = new Transaction
        {
            Id = Guid.CreateVersion7(),
            PortfolioId = portfolio.Id,
            Type = type,
            Date = request.Date,
            SecurityId = security?.Id,
            Security = security,
            Currency = security?.Currency ?? portfolio.BaseCurrency,
            Note = note,
            CreatedAt = now,
            UpdatedAt = now,
        };

        var error = type switch
        {
            TransactionType.Buy or TransactionType.Sell or TransactionType.TransferIn => FillTrade(transaction, request),
            TransactionType.Split => FillSplit(transaction, request),
            TransactionType.Dividend => FillDividend(transaction, request, security!),
            _ => FillCash(transaction, request, portfolio),
        };
        if (error is not null)
            return (null, error);

        if (type is TransactionType.Split || transaction.Currency == portfolio.BaseCurrency)
            transaction.FxRate = 1m;
        else if (request.FxRate is > 0)
            transaction.FxRate = request.FxRate.Value;
        else if (await LookupRateAsync(transaction.Currency, portfolio.BaseCurrency, request.Date, ct) is { } rate)
            transaction.FxRate = rate;
        else
            return (null, $"No {transaction.Currency} to {portfolio.BaseCurrency} exchange rate is available for {request.Date:yyyy-MM-dd}. Enter the rate you received.");

        return (transaction, null);
    }

    private static string? FillTrade(Transaction t, TransactionRequest r)
    {
        if (r.Quantity is not > 0)
            return "Enter the number of shares.";
        if (r.Price is not >= 0)
            return "Enter the price per share.";
        if (r.Fee is < 0)
            return "The commission cannot be negative.";

        t.Quantity = r.Quantity.Value;
        t.Price = r.Price.Value;
        t.Fee = t.Type == TransactionType.TransferIn ? 0m : r.Fee ?? 0m;
        return null;
    }

    private static string? FillSplit(Transaction t, TransactionRequest r)
    {
        if (r.SplitFrom is not > 0 || r.SplitTo is not > 0)
            return "Enter the split ratio, e.g. 1 share becomes 4.";
        if (r.SplitFrom == r.SplitTo)
            return "A split must change the number of shares.";

        t.SplitFrom = r.SplitFrom.Value;
        t.SplitTo = r.SplitTo.Value;
        return null;
    }

    private static string? FillDividend(Transaction t, TransactionRequest r, Security security)
    {
        if (r.Amount is not > 0)
            return "Enter the dividend amount.";
        if (r.Fee is < 0 || r.Fee > r.Amount)
            return "The tax withheld must be between zero and the dividend amount.";

        var currency = string.IsNullOrWhiteSpace(r.Currency) ? security.Currency : Currencies.Normalize(r.Currency);
        if (!Currencies.IsSupported(currency))
            return $"Unsupported currency {currency}.";

        t.Currency = currency;
        t.Amount = r.Amount.Value;
        t.Fee = r.Fee ?? 0m;
        return null;
    }

    private static string? FillCash(Transaction t, TransactionRequest r, Portfolio portfolio)
    {
        var currency = string.IsNullOrWhiteSpace(r.Currency) ? portfolio.BaseCurrency : Currencies.Normalize(r.Currency);
        if (!Currencies.IsSupported(currency))
            return $"Unsupported currency {currency}.";
        if (r.Amount is not > 0)
            return "Enter an amount greater than zero.";

        t.Currency = currency;
        t.Amount = r.Amount.Value;
        return null;
    }

    private async Task<decimal?> LookupRateAsync(string from, string to, DateOnly date, CancellationToken ct)
    {
        try
        {
            await market.EnsureFxAsync([from, to], date, ct);
        }
        catch (Exception ex) when (!ct.IsCancellationRequested && MarketDataErrors.IsTransient(ex))
        {
            // Offline: fall through to whatever rates are already stored.
        }

        var table = await calculator.LoadFxAsync(date, date, ct);
        return table.GetRate(from, to, date) is { } rate ? decimal.Round(rate, 8) : null;
    }

    private static string Describe(TransactionType type) => type switch
    {
        TransactionType.TransferIn => "transfer in",
        _ => type.ToString().ToLowerInvariant(),
    };
}
