using Folio.Core;

namespace Folio.Core.Tests;

/// <summary>Terse factories for ledger entries; sequence numbers follow call order.</summary>
internal sealed class LedgerBuilder
{
    private long _sequence;

    public List<LedgerEntry> Entries { get; } = [];

    public static DateOnly D(string iso) => DateOnly.Parse(iso, System.Globalization.CultureInfo.InvariantCulture);

    public LedgerEntry Add(LedgerEntry entry)
    {
        entry = entry with { Sequence = ++_sequence };
        Entries.Add(entry);
        return entry;
    }

    public LedgerEntry Deposit(string date, decimal amount, string currency = "CAD", decimal fx = 1m) =>
        Add(new LedgerEntry { Type = TransactionType.Deposit, Date = D(date), Currency = currency, Amount = amount, FxRate = fx });

    public LedgerEntry Withdraw(string date, decimal amount, string currency = "CAD", decimal fx = 1m) =>
        Add(new LedgerEntry { Type = TransactionType.Withdrawal, Date = D(date), Currency = currency, Amount = amount, FxRate = fx });

    public LedgerEntry Buy(string date, Guid security, decimal quantity, decimal price, decimal fee = 0m, string currency = "CAD", decimal fx = 1m) =>
        Add(new LedgerEntry
        {
            Type = TransactionType.Buy, Date = D(date), SecurityId = security, Currency = currency,
            Quantity = quantity, Price = price, Fee = fee, FxRate = fx,
        });

    public LedgerEntry Sell(string date, Guid security, decimal quantity, decimal price, decimal fee = 0m, string currency = "CAD", decimal fx = 1m) =>
        Add(new LedgerEntry
        {
            Type = TransactionType.Sell, Date = D(date), SecurityId = security, Currency = currency,
            Quantity = quantity, Price = price, Fee = fee, FxRate = fx,
        });

    public LedgerEntry TransferIn(string date, Guid security, decimal quantity, decimal price, string currency = "CAD", decimal fx = 1m) =>
        Add(new LedgerEntry
        {
            Type = TransactionType.TransferIn, Date = D(date), SecurityId = security, Currency = currency,
            Quantity = quantity, Price = price, FxRate = fx,
        });

    public LedgerEntry Split(string date, Guid security, decimal from, decimal to, string currency = "CAD") =>
        Add(new LedgerEntry
        {
            Type = TransactionType.Split, Date = D(date), SecurityId = security, Currency = currency,
            SplitFrom = from, SplitTo = to,
        });

    public LedgerEntry Dividend(string date, Guid security, decimal amount, decimal withheld = 0m, string currency = "CAD", decimal fx = 1m) =>
        Add(new LedgerEntry
        {
            Type = TransactionType.Dividend, Date = D(date), SecurityId = security, Currency = currency,
            Amount = amount, Fee = withheld, FxRate = fx,
        });

    public PortfolioLedger Replay(string baseCurrency = "CAD") => PortfolioLedger.Replay(baseCurrency, Entries);

    /// <summary>Cash balances entered on given dates: ("CAD", "2025-01-02", 1000m), ...</summary>
    public static CashLedger Cash(params (string Currency, string Date, decimal Balance)[] balances)
    {
        var cash = new CashLedger();
        foreach (var (currency, date, balance) in balances)
            cash.Set(currency, D(date), balance);
        return cash;
    }
}
