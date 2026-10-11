namespace Folio.Core;

public enum TransactionType
{
    Buy,
    Sell,
    Split,

    /// <summary>Money put into the account; counts toward net deposits. Cash balances are entered separately.</summary>
    Deposit,

    /// <summary>Money taken out of the account; counts against net deposits.</summary>
    Withdrawal,
    Dividend,
    Interest,
    Fee,

    /// <summary>Shares that arrive from elsewhere at their book value, e.g. an opening position.</summary>
    TransferIn,
}

public static class TransactionTypes
{
    public static bool RequiresSecurity(this TransactionType type) => type is
        TransactionType.Buy or TransactionType.Sell or TransactionType.Split or
        TransactionType.Dividend or TransactionType.TransferIn;

    public static bool IsTrade(this TransactionType type) => type is
        TransactionType.Buy or TransactionType.Sell or TransactionType.TransferIn;
}
