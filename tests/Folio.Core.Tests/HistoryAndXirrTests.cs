using Folio.Core;
using static Folio.Core.Tests.LedgerBuilder;

namespace Folio.Core.Tests;

public class HistoryAndXirrTests
{
    private static readonly Guid Shop = Guid.NewGuid();

    [Fact]
    public void History_replays_day_by_day_and_skips_weekends()
    {
        var b = new LedgerBuilder();
        b.Deposit("2025-01-02", 1_000m);              // Thursday
        b.Buy("2025-01-03", Shop, 10, 50m);           // Friday
        var cash = Cash(("CAD", "2025-01-02", 1_000m), ("CAD", "2025-01-03", 500m));

        var prices = new PriceTable();
        prices.Add(Shop, D("2025-01-03"), 50m);
        prices.Add(Shop, D("2025-01-06"), 60m);       // Monday

        var points = HistoryBuilder.Build([new LedgerInput("CAD", b.Entries, cash)], "CAD",
            D("2025-01-02"), D("2025-01-06"), prices, new FxTable());

        Assert.Equal([D("2025-01-02"), D("2025-01-03"), D("2025-01-06")], points.Select(p => p.Date));
        Assert.Equal([1_000m, 1_000m, 1_100m], points.Select(p => p.Value));
        Assert.All(points, p => Assert.Equal(1_000m, p.NetContributions));
    }

    [Fact]
    public void History_converts_each_portfolio_and_keeps_contributions_at_their_own_dates()
    {
        var cad = new LedgerBuilder();
        cad.Deposit("2025-01-02", 1_400m);
        var usd = new LedgerBuilder();
        usd.Deposit("2025-01-02", 1_000m, "USD");

        var fx = new FxTable();
        fx.Add("USD", D("2025-01-02"), 1.40m);
        fx.Add("USD", D("2025-01-03"), 1.50m);

        var points = HistoryBuilder.Build(
            [
                new LedgerInput("CAD", cad.Entries, Cash(("CAD", "2025-01-02", 1_400m))),
                new LedgerInput("USD", usd.Entries, Cash(("USD", "2025-01-02", 1_000m))),
            ],
            "CAD", D("2025-01-02"), D("2025-01-03"), new PriceTable(), fx);

        Assert.Equal(2_800m, points[0].Value);
        Assert.Equal(2_900m, points[1].Value);              // the USD cash is now worth more
        Assert.Equal(2_800m, points[1].NetContributions);   // the deposit stays at the day-one rate
    }

    [Fact]
    public void History_starts_with_the_first_cash_balance_even_without_transactions()
    {
        var points = HistoryBuilder.Build([new LedgerInput("CAD", [], Cash(("CAD", "2025-01-02", 1_000m)))], "CAD",
            D("2025-01-01"), D("2025-01-03"), new PriceTable(), new FxTable());

        Assert.Equal([0m, 1_000m, 1_000m], points.Select(p => p.Value));
        Assert.All(points, p => Assert.Equal(0m, p.NetContributions));
    }

    [Fact]
    public void History_is_empty_without_transactions_or_cash()
    {
        var points = HistoryBuilder.Build([new LedgerInput("CAD", [], CashLedger.Empty)], "CAD",
            D("2025-01-01"), D("2025-02-01"), new PriceTable(), new FxTable());
        Assert.Empty(points);
    }

    [Fact]
    public void Xirr_matches_the_excel_reference_example()
    {
        var flows = new List<(DateOnly, double)>
        {
            (D("2008-01-01"), -10_000),
            (D("2008-03-01"), 2_750),
            (D("2008-10-30"), 4_250),
            (D("2009-02-15"), 3_250),
            (D("2009-04-01"), 2_750),
        };

        Assert.Equal(0.373362535, Xirr.Calculate(flows)!.Value, 6);
    }

    [Fact]
    public void Xirr_handles_losses_and_needs_both_signs()
    {
        Assert.Equal(-0.5, Xirr.Calculate([(D("2023-01-01"), -1_000), (D("2024-01-01"), 500)])!.Value, 6);
        Assert.Null(Xirr.Calculate([(D("2023-01-01"), -1_000), (D("2024-01-01"), -500)]));
        Assert.Null(Xirr.Calculate([(D("2023-01-01"), -1_000)]));
    }
}
