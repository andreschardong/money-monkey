namespace Folio.Core;

/// <summary>
/// One recorded transaction, as the ledger engine sees it. Which fields matter depends on <see cref="Type"/>:
/// <list type="bullet">
/// <item>Buy / Sell / TransferIn: <see cref="Quantity"/>, <see cref="Price"/> and <see cref="Fee"/> (commission), in the security's currency.</item>
/// <item>Split: <see cref="SplitFrom"/> old shares become <see cref="SplitTo"/> new shares.</item>
/// <item>Dividend: <see cref="Amount"/> is the gross payment and <see cref="Fee"/> the tax withheld.</item>
/// <item>Deposit / Withdrawal / Interest / Fee: <see cref="Amount"/> in <see cref="Currency"/>.</item>
/// </list>
/// Transactions never change cash balances; those are entered directly (see <see cref="CashLedger"/>).
/// </summary>
public sealed record LedgerEntry
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public required TransactionType Type { get; init; }
    public required DateOnly Date { get; init; }

    /// <summary>Entry order, used to break ties between transactions on the same day.</summary>
    public long Sequence { get; init; }

    public Guid? SecurityId { get; init; }

    /// <summary>Currency of the amounts in this entry.</summary>
    public required string Currency { get; init; }

    public decimal Quantity { get; init; }
    public decimal Price { get; init; }
    public decimal Amount { get; init; }
    public decimal Fee { get; init; }

    /// <summary>Units of the portfolio's base currency per unit of <see cref="Currency"/> on <see cref="Date"/>.</summary>
    public decimal FxRate { get; init; } = 1m;

    public decimal SplitFrom { get; init; }
    public decimal SplitTo { get; init; }

    /// <summary>The money involved, in <see cref="Currency"/>: cost of a buy, proceeds of a sale, net dividend, or the amount.</summary>
    public decimal Total => Type switch
    {
        TransactionType.Buy => Quantity * Price + Fee,
        TransactionType.TransferIn => Quantity * Price,
        TransactionType.Sell => Quantity * Price - Fee,
        TransactionType.Dividend => Amount - Fee,
        TransactionType.Split => 0m,
        _ => Amount,
    };
}

/// <summary>Same-day order: splits apply at the start of the day (the ex-date), then entries in the order they were recorded.</summary>
public static class LedgerOrder
{
    public static IOrderedEnumerable<LedgerEntry> Sort(IEnumerable<LedgerEntry> entries) =>
        entries
            .OrderBy(e => e.Date)
            .ThenBy(e => e.Type == TransactionType.Split ? 0 : 1)
            .ThenBy(e => e.Sequence);
}

public sealed class LedgerException(Guid entryId, string message) : Exception(message)
{
    public Guid EntryId { get; } = entryId;
}
