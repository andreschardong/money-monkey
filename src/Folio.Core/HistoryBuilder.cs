namespace Folio.Core;

public sealed record HistoryPoint(DateOnly Date, decimal Value, decimal NetContributions);

public sealed record LedgerInput(string BaseCurrency, IReadOnlyList<LedgerEntry> Entries, CashLedger Cash);

/// <summary>Daily value of one or more portfolios, replayed day by day and expressed in a display currency.</summary>
public static class HistoryBuilder
{
    public static IReadOnlyList<HistoryPoint> Build(
        IReadOnlyList<LedgerInput> portfolios,
        string displayCurrency,
        DateOnly from,
        DateOnly to,
        IPriceSource prices,
        IFxSource fx)
    {
        var replays = portfolios.Select(p => new Replay(p)).ToList();
        if (from > to || replays.All(r => r.IsEmpty))
            return [];

        var points = new List<HistoryPoint>();
        foreach (var replay in replays)
            replay.AdvanceTo(from.AddDays(-1), displayCurrency, fx);

        for (var day = from; day <= to; day = day.AddDays(1))
        {
            var value = 0m;
            var contributions = 0m;
            foreach (var replay in replays)
            {
                replay.AdvanceTo(day, displayCurrency, fx);
                contributions += replay.ContributionsInDisplay;
                if (replay.HasStartedBy(day))
                {
                    var rate = fx.GetRate(replay.Ledger.BaseCurrency, displayCurrency, day) ?? 1m;
                    value += PortfolioValuator.TotalValue(replay.Ledger, day, prices, fx, replay.Cash) * rate;
                }
            }

            // Weekends repeat Friday's prices; skipping them keeps the chart free of flat steps.
            var weekend = day.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday;
            if (!weekend || day == from || day == to)
                points.Add(new HistoryPoint(day, value, contributions));
        }

        return points;
    }

    private sealed class Replay(LedgerInput input)
    {
        private readonly LedgerEntry[] _entries = [.. LedgerOrder.Sort(input.Entries)];
        private int _next;
        private int _flowsConverted;

        public PortfolioLedger Ledger { get; } = new(input.BaseCurrency);
        public CashLedger Cash { get; } = input.Cash;
        public bool IsEmpty => _entries.Length == 0 && Cash.IsEmpty;

        /// <summary>A portfolio counts from its first transaction or first entered cash balance.</summary>
        public bool HasStartedBy(DateOnly day) => _next > 0 || Cash.FirstDate <= day;

        /// <summary>Contributions converted at each flow's own date, so old deposits keep their historical value.</summary>
        public decimal ContributionsInDisplay { get; private set; }

        public void AdvanceTo(DateOnly day, string displayCurrency, IFxSource fx)
        {
            while (_next < _entries.Length && _entries[_next].Date <= day)
                Ledger.Apply(_entries[_next++]);

            for (; _flowsConverted < Ledger.ExternalFlows.Count; _flowsConverted++)
            {
                var flow = Ledger.ExternalFlows[_flowsConverted];
                ContributionsInDisplay += flow.Amount * (fx.GetRate(Ledger.BaseCurrency, displayCurrency, flow.Date) ?? 1m);
            }
        }
    }
}
