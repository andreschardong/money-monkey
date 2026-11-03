using static Folio.Core.Tests.LedgerBuilder;

namespace Folio.Core.Tests;

public class EngineEdgeCaseTests
{
    private static readonly Guid Shop = Guid.NewGuid();
    private static readonly Guid Aapl = Guid.NewGuid();

    [Fact]
    public void WhenRangeEndsBeforeItStarts_ShouldBuildNoHistory()
    {
        var b = new LedgerBuilder();
        b.Deposit("2025-01-02", 1_000m);

        var points = HistoryBuilder.Build([new LedgerInput("CAD", b.Entries, CashLedger.Empty)], "CAD",
            D("2025-01-06"), D("2025-01-02"), new PriceTable(), new FxTable());

        points.ShouldBeEmpty();
    }

    [Fact]
    public void WhenPortfolioStartsInsideTheRange_ShouldValueEarlierDaysAtZero()
    {
        var b = new LedgerBuilder();
        b.Deposit("2025-01-08", 1_000m);   // Wednesday

        var points = HistoryBuilder.Build([new LedgerInput("CAD", b.Entries, CashLedger.Empty)], "CAD",
            D("2025-01-06"), D("2025-01-08"), new PriceTable(), new FxTable());

        points.Select(p => p.Date).ShouldBe([D("2025-01-06"), D("2025-01-07"), D("2025-01-08")]);
        points.Select(p => p.Value).ShouldBe([0m, 0m, 0m]);
        points.Select(p => p.NetContributions).ShouldBe([0m, 0m, 1_000m]);
    }

    [Fact]
    public void WhenCashIsEnteredAfterTheRangeStarts_ShouldStartValuingFromThatDate()
    {
        var cash = Cash(("CAD", "2025-01-07", 500m));

        var points = HistoryBuilder.Build([new LedgerInput("CAD", [], cash)], "CAD",
            D("2025-01-06"), D("2025-01-08"), new PriceTable(), new FxTable());

        points.Select(p => p.Value).ShouldBe([0m, 500m, 500m]);
    }

    [Fact]
    public void WhenHistoryIsSplitAcrossAWeekend_ShouldKeepTheFirstAndLastDaysEvenIfTheyAreWeekendDays()
    {
        var b = new LedgerBuilder();
        b.Deposit("2025-01-02", 100m);

        var points = HistoryBuilder.Build([new LedgerInput("CAD", b.Entries, CashLedger.Empty)], "CAD",
            D("2025-01-04"), D("2025-01-05"), new PriceTable(), new FxTable());

        points.Select(p => p.Date).ShouldBe([D("2025-01-04"), D("2025-01-05")]);
    }

    [Fact]
    public void WhenCurrencyHasNoRate_ShouldReturnNoRate()
    {
        var fx = new FxTable();
        fx.Add("USD", D("2025-01-01"), 1.4m);

        fx.GetRate("XXX", "CAD", D("2025-01-02")).ShouldBeNull();
        fx.GetRate("CAD", "XXX", D("2025-01-02")).ShouldBeNull();
        fx.GetRate("XXX", "YYY", D("2025-01-02")).ShouldBeNull();
        fx.GetRate("USD", "XXX", D("2025-01-02")).ShouldBeNull();
        fx.GetRate("CAD", "USD", D("2025-01-02")).ShouldBe(1m / 1.4m);
        fx.GetRate("USD", "USD", D("2025-01-02")).ShouldBe(1m);
    }

    [Fact]
    public void WhenFxTableHasRates_ShouldReportTheLatestDateAndNoneWhenEmpty()
    {
        var fx = new FxTable();
        fx.LatestDate.ShouldBeNull();

        fx.Add("USD", D("2025-01-01"), 1.4m);
        fx.Add("EUR", D("2025-01-09"), 1.5m);

        fx.LatestDate.ShouldBe(D("2025-01-09"));
    }

    [Fact]
    public void WhenPriceTableHasNoSeriesForTheSecurity_ShouldFindNoPrice()
    {
        var prices = new PriceTable();
        prices.Add(Shop, D("2025-01-03"), 10m);

        prices.GetPrice(Aapl, D("2025-01-03")).ShouldBeNull();
        prices.GetPrice(Shop, D("2025-01-02")).ShouldBeNull();
        prices.GetPriceBefore(Shop, D("2025-01-03")).ShouldBeNull();
        prices.GetPriceBefore(Shop, D("2025-01-04"))!.Value.Close.ShouldBe(10m);
    }

    [Fact]
    public void WhenHoldingCostNothing_ShouldHaveNoUnrealizedPercent()
    {
        var b = new LedgerBuilder();
        b.TransferIn("2025-01-03", Shop, 10, 0m);
        var prices = new PriceTable();
        prices.Add(Shop, D("2025-01-03"), 5m);

        var valuation = PortfolioValuator.Value(b.Replay(), D("2025-01-03"), prices, new FxTable(), CashLedger.Empty);

        var holding = valuation.Holdings.ShouldHaveSingleItem();
        holding.UnrealizedBase.ShouldBe(50m);
        holding.UnrealizedPercent.ShouldBeNull();
        valuation.UnrealizedPercent.ShouldBeNull();
    }

    [Fact]
    public void WhenAHoldingCostSomething_ShouldReportItsUnrealizedPercent()
    {
        var b = new LedgerBuilder();
        b.Buy("2025-01-02", Shop, 10, 50m);
        var prices = new PriceTable();
        prices.Add(Shop, D("2025-01-03"), 60m);

        var valuation = PortfolioValuator.Value(b.Replay(), D("2025-01-03"), prices, new FxTable(), CashLedger.Empty);

        valuation.Holdings.ShouldHaveSingleItem().UnrealizedPercent.ShouldBe(0.2m);
        valuation.UnrealizedPercent.ShouldBe(0.2m);
    }

    [Fact]
    public void WhenTheGivenSessionIsTooOldForTheCloses_ShouldShowNoDayChangeButKeepThePreviousClose()
    {
        var b = new LedgerBuilder();
        b.Buy("2026-10-01", Shop, 10, 90m);
        var prices = new PriceTable();
        prices.Add(Shop, D("2026-10-07"), 100m);
        prices.Add(Shop, D("2026-10-08"), 110m);

        var valuation = PortfolioValuator.Value(b.Replay(), D("2026-10-09"), prices, new FxTable(), CashLedger.Empty, D("2026-09-01"));

        valuation.DayChangeDate.ShouldBeNull();
        valuation.DayChange.ShouldBe(0m);
        var holding = valuation.Holdings.ShouldHaveSingleItem();
        holding.PreviousClose.ShouldBe(100m);
        holding.DayChangePercent.ShouldBe(0.1m);
    }

    [Fact]
    public void WhenOnlyOneCloseExists_ShouldShowNoDayChange()
    {
        var b = new LedgerBuilder();
        b.Buy("2025-01-02", Shop, 10, 5m);
        var prices = new PriceTable();
        prices.Add(Shop, D("2025-01-03"), 6m);

        var valuation = PortfolioValuator.Value(b.Replay(), D("2025-01-03"), prices, new FxTable(), CashLedger.Empty);

        var holding = valuation.Holdings.ShouldHaveSingleItem();
        holding.PreviousClose.ShouldBeNull();
        holding.DayChangePercent.ShouldBeNull();
        valuation.DayChange.ShouldBe(0m);
        valuation.DayChangePercent.ShouldBe(0m);
    }

    [Fact]
    public void WhenTotalValueIsRequested_ShouldSkipClosedPositionsAndCarryUnpricedOnesAtCost()
    {
        var b = new LedgerBuilder();
        b.Buy("2025-01-02", Shop, 10, 5m);
        b.Sell("2025-01-03", Shop, 10, 6m);
        b.Buy("2025-01-03", Aapl, 2, 100m, fee: 4m);
        var ledger = b.Replay();
        var cash = Cash(("CAD", "2025-01-03", 300m));

        var total = PortfolioValuator.TotalValue(ledger, D("2025-01-03"), new PriceTable(), new FxTable(), cash);

        total.ShouldBe(204m + 300m);
    }

    [Fact]
    public void WhenValuationHasNoHoldings_ShouldHaveNoPriceDate()
    {
        var valuation = PortfolioValuator.Value(new PortfolioLedger("CAD"), D("2025-01-03"), new PriceTable(), new FxTable(), CashLedger.Empty);

        valuation.PricesAsOf.ShouldBeNull();
        valuation.DayChangeDate.ShouldBeNull();
        valuation.TotalValue.ShouldBe(0m);
        valuation.TotalReturn.ShouldBeNull();
        valuation.AnnualizedReturn.ShouldBeNull();
    }

    [Fact]
    public void WhenLedgerIsReplayed_ShouldOrderSplitsBeforeOtherEntriesOnTheSameDay()
    {
        var b = new LedgerBuilder();
        b.Buy("2025-01-02", Shop, 10, 10m);
        var buy = b.Buy("2025-01-03", Shop, 1, 10m);
        var split = b.Split("2025-01-03", Shop, 1, 2);

        LedgerOrder.Sort(b.Entries).Select(e => e.Id).ShouldBe([b.Entries[0].Id, split.Id, buy.Id]);
    }
}
