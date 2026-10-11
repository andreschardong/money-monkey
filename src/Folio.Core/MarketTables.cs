namespace Folio.Core;

public readonly record struct PricePoint(DateOnly Date, decimal Close);

public interface IPriceSource
{
    /// <summary>The latest close on or before <paramref name="date"/>, or null when there is none.</summary>
    PricePoint? GetPrice(Guid securityId, DateOnly date);

    /// <summary>The latest close strictly before <paramref name="date"/>.</summary>
    PricePoint? GetPriceBefore(Guid securityId, DateOnly date);
}

public interface IFxSource
{
    /// <summary>Units of <paramref name="to"/> per unit of <paramref name="from"/> on (or just before) <paramref name="date"/>.</summary>
    decimal? GetRate(string from, string to, DateOnly date);
}

/// <summary>Daily closes per security, held in memory for fast as-of lookups.</summary>
public sealed class PriceTable : IPriceSource
{
    private readonly Dictionary<Guid, SortedList<DateOnly, decimal>> _series = [];

    public void Add(Guid securityId, DateOnly date, decimal close)
    {
        if (!_series.TryGetValue(securityId, out var series))
            _series[securityId] = series = [];
        series[date] = close;
    }

    public PricePoint? GetPrice(Guid securityId, DateOnly date) => Find(securityId, date, inclusive: true);

    public PricePoint? GetPriceBefore(Guid securityId, DateOnly date) => Find(securityId, date, inclusive: false);

    private PricePoint? Find(Guid securityId, DateOnly date, bool inclusive)
    {
        if (!_series.TryGetValue(securityId, out var series) || series.Count == 0)
            return null;

        var index = LastIndexAtOrBefore(series.Keys, inclusive ? date : date.AddDays(-1));
        return index < 0 ? null : new PricePoint(series.Keys[index], series.Values[index]);
    }

    internal static int LastIndexAtOrBefore(IList<DateOnly> keys, DateOnly date)
    {
        int lo = 0, hi = keys.Count - 1, found = -1;
        while (lo <= hi)
        {
            var mid = (lo + hi) >>> 1;
            if (keys[mid] <= date)
            {
                found = mid;
                lo = mid + 1;
            }
            else
            {
                hi = mid - 1;
            }
        }

        return found;
    }
}

/// <summary>Daily exchange rates stored as CAD per unit of each currency; any pair is a cross through CAD.</summary>
public sealed class FxTable : IFxSource
{
    private readonly Dictionary<string, SortedList<DateOnly, decimal>> _toCad = new(StringComparer.Ordinal);

    public void Add(string currency, DateOnly date, decimal cadPerUnit)
    {
        if (!_toCad.TryGetValue(currency, out var series))
            _toCad[currency] = series = [];
        series[date] = cadPerUnit;
    }

    public decimal? GetRate(string from, string to, DateOnly date)
    {
        if (from == to)
            return 1m;
        var fromCad = CadPerUnit(from, date);
        var toCad = CadPerUnit(to, date);
        return fromCad is null || toCad is null ? null : fromCad / toCad;
    }

    /// <summary>The date of the newest rate across all currencies.</summary>
    public DateOnly? LatestDate => _toCad.Values.Where(s => s.Count > 0).Select(s => (DateOnly?)s.Keys[^1]).Max();

    private decimal? CadPerUnit(string currency, DateOnly date)
    {
        if (currency == Currencies.Cad)
            return 1m;
        if (!_toCad.TryGetValue(currency, out var series) || series.Count == 0)
            return null;

        // Before the first published rate, the earliest one is the best estimate available.
        var index = PriceTable.LastIndexAtOrBefore(series.Keys, date);
        return series.Values[index < 0 ? 0 : index];
    }
}
