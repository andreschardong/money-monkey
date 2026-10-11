namespace Folio.Core;

/// <summary>A cash balance as entered for a portfolio: what the account held in a currency, and when that was true.</summary>
public readonly record struct CashPosition(string Currency, decimal Balance, DateOnly AsOf);

/// <summary>
/// Cash balances entered by the user, per currency and date. Trades never change them: the balance on any day is
/// the latest one entered on or before that day, exactly as it appears on a statement.
/// </summary>
public sealed class CashLedger
{
    private readonly Dictionary<string, SortedList<DateOnly, decimal>> _series = new(StringComparer.Ordinal);

    public static CashLedger Empty { get; } = new();

    public bool IsEmpty => _series.Count == 0;

    public IEnumerable<string> Currencies => _series.Keys;

    /// <summary>The earliest date any balance was entered for.</summary>
    public DateOnly? FirstDate => _series.Values.Where(s => s.Count > 0).Select(s => (DateOnly?)s.Keys[0]).Min();

    public void Set(string currency, DateOnly date, decimal balance)
    {
        if (!_series.TryGetValue(currency, out var series))
            _series[currency] = series = [];
        series[date] = balance;
    }

    /// <summary>Each currency's latest balance entered on or before <paramref name="date"/>.</summary>
    public IReadOnlyList<CashPosition> BalancesOn(DateOnly date)
    {
        var result = new List<CashPosition>();
        foreach (var (currency, series) in _series)
        {
            var index = PriceTable.LastIndexAtOrBefore(series.Keys, date);
            if (index >= 0)
                result.Add(new CashPosition(currency, series.Values[index], series.Keys[index]));
        }

        return result;
    }
}
