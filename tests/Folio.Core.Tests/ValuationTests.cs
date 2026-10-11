using Folio.Core;
using static Folio.Core.Tests.LedgerBuilder;

namespace Folio.Core.Tests;

public class ValuationTests
{
    private static readonly Guid Shop = Guid.NewGuid();
    private static readonly Guid Aapl = Guid.NewGuid();

    private static FxTable Rates(decimal usdCad = 1.40m, decimal eurCad = 1.60m)
    {
        var fx = new FxTable();
        fx.Add("USD", D("2020-01-01"), usdCad);
        fx.Add("EUR", D("2020-01-01"), eurCad);
        return fx;
    }

    [Fact]
    public void Values_holdings_and_entered_cash_in_the_base_currency()
    {
        var b = new LedgerBuilder();
        b.Deposit("2025-01-02", 10_000m);
        b.Buy("2025-01-03", Aapl, 10, 200m, currency: "USD", fx: 1.35m);
        b.Buy("2025-01-03", Shop, 20, 100m);
        var cash = Cash(("CAD", "2025-01-03", 1_000m), ("USD", "2025-01-03", 3_000m));

        var prices = new PriceTable();
        prices.Add(Aapl, D("2025-01-09"), 240m);
        prices.Add(Aapl, D("2025-01-10"), 250m);
        prices.Add(Shop, D("2025-01-10"), 110m);

        var v = PortfolioValuator.Value(b.Replay(), D("2025-01-10"), prices, Rates(), cash);

        var aapl = v.Holdings.Single(h => h.Position.SecurityId == Aapl);
        Assert.Equal(2_500m, aapl.MarketValueLocal);
        Assert.Equal(3_500m, aapl.MarketValueBase);
        Assert.Equal(800m, aapl.UnrealizedBase);           // 3,500 - 2,700 booked at 1.35
        Assert.Equal(140m, aapl.DayChangeBase);            // 10 x (250 - 240) x 1.40
        Assert.Equal(250m / 240m - 1m, aapl.DayChangePercent!.Value, 20);

        var shop = v.Holdings.Single(h => h.Position.SecurityId == Shop);
        Assert.Equal(0m, shop.DayChangeBase);               // no earlier close to compare with
        Assert.Null(shop.DayChangePercent);

        Assert.Equal(1_000m + 3_000m * 1.40m, v.CashValue);
        Assert.Equal("CAD", v.Cash[0].Currency);
        Assert.Equal(D("2025-01-03"), v.Cash[1].AsOf);
        Assert.Equal(3_500m + 2_200m + 5_200m, v.TotalValue);
        Assert.Equal(10_000m, v.NetContributions);
        Assert.Equal(900m, v.TotalReturn);
        Assert.Equal(0.09m, v.TotalReturnPercent);
        Assert.Equal(D("2025-01-10"), v.PricesAsOf);
    }

    [Fact]
    public void Cash_uses_the_latest_balance_entered_on_or_before_the_date()
    {
        var ledger = new LedgerBuilder().Replay();
        var cash = Cash(("CAD", "2025-01-01", 100m), ("CAD", "2025-01-10", 150m));

        Assert.Equal(100m, PortfolioValuator.Value(ledger, D("2025-01-05"), new PriceTable(), Rates(), cash).CashValue);
        Assert.Equal(150m, PortfolioValuator.Value(ledger, D("2025-01-10"), new PriceTable(), Rates(), cash).CashValue);
        Assert.Empty(PortfolioValuator.Value(ledger, D("2024-12-31"), new PriceTable(), Rates(), cash).Cash);
    }

    [Fact]
    public void Total_return_waits_for_a_recorded_deposit()
    {
        var b = new LedgerBuilder();
        b.Buy("2025-01-03", Shop, 10, 50m);
        var prices = new PriceTable();
        prices.Add(Shop, D("2025-01-10"), 55m);

        var v = PortfolioValuator.Value(b.Replay(), D("2025-01-10"), prices, Rates(), Cash(("CAD", "2025-01-03", 500m)));

        Assert.Equal(1_050m, v.TotalValue);
        Assert.Equal(50m, v.UnrealizedGain);
        Assert.Null(v.TotalReturn);
        Assert.Null(v.TotalReturnPercent);
    }

    [Fact]
    public void A_holding_without_any_price_is_carried_at_cost()
    {
        var b = new LedgerBuilder();
        b.Buy("2025-01-03", Shop, 10, 50m, fee: 5m);

        var v = PortfolioValuator.Value(b.Replay(), D("2025-01-10"), new PriceTable(), Rates(), CashLedger.Empty);
        var holding = Assert.Single(v.Holdings);

        Assert.True(holding.PriceMissing);
        Assert.Equal(505m, holding.MarketValueBase);
        Assert.Equal(0m, holding.UnrealizedBase);
    }

    [Fact]
    public void Day_change_restates_the_previous_close_across_a_split()
    {
        var b = new LedgerBuilder();
        b.Buy("2024-06-03", Aapl, 10, 1_200m, currency: "USD", fx: 1.37m);
        b.Split("2024-06-10", Aapl, 1, 10, currency: "USD");

        var prices = new PriceTable();
        prices.Add(Aapl, D("2024-06-07"), 1_208.88m);   // raw, pre-split close
        prices.Add(Aapl, D("2024-06-10"), 121.79m);

        var v = PortfolioValuator.Value(b.Replay(), D("2024-06-10"), prices, Rates(usdCad: 1m), CashLedger.Empty);
        var holding = Assert.Single(v.Holdings);

        Assert.Equal(120.888m, holding.PreviousClose);
        Assert.Equal(100m * (121.79m - 120.888m), holding.DayChangeBase);
    }

    [Fact]
    public void Stale_prices_show_no_day_change()
    {
        var b = new LedgerBuilder();
        b.Buy("2025-01-03", Shop, 10, 50m);
        var prices = new PriceTable();
        prices.Add(Shop, D("2025-01-06"), 50m);
        prices.Add(Shop, D("2025-01-07"), 55m);

        var v = PortfolioValuator.Value(b.Replay(), D("2025-03-01"), prices, Rates(), CashLedger.Empty);
        Assert.Equal(0m, v.DayChange);
        Assert.Null(Assert.Single(v.Holdings).DayChangePercent);
    }

    [Fact]
    public void A_split_recorded_before_its_close_is_loaded_restates_the_last_close()
    {
        var b = new LedgerBuilder();
        b.Buy("2026-10-05", Shop, 100, 100m);
        b.Split("2026-10-09", Shop, 1, 2);

        var prices = new PriceTable();
        prices.Add(Shop, D("2026-10-07"), 98m);
        prices.Add(Shop, D("2026-10-08"), 100m);   // the ex-date close is not in yet

        var ledger = b.Replay();
        var v = PortfolioValuator.Value(ledger, D("2026-10-09"), prices, Rates(), CashLedger.Empty);
        var holding = Assert.Single(v.Holdings);

        Assert.Equal(200m, holding.Position.Quantity);
        Assert.Equal(50m, holding.Price!.Value.Close);
        Assert.Equal(10_000m, holding.MarketValueBase);
        Assert.Equal(49m, holding.PreviousClose);
        Assert.Equal(200m, holding.DayChangeBase);          // the same as 100 x (100 - 98)
        Assert.Equal(v.TotalValue, PortfolioValuator.TotalValue(ledger, D("2026-10-09"), prices, Rates(), CashLedger.Empty));
    }

    [Fact]
    public void Annualized_return_appears_after_a_year_of_history()
    {
        var b = new LedgerBuilder();
        b.Deposit("2024-01-01", 1_000m);
        var ledger = b.Replay();

        var young = PortfolioValuator.Value(ledger, D("2024-06-30"), new PriceTable(), Rates(), Cash(("CAD", "2024-01-01", 1_000m)));
        Assert.Null(young.AnnualizedReturn);

        var cash = Cash(("CAD", "2024-01-01", 1_000m), ("CAD", "2024-12-31", 1_100m));
        var v = PortfolioValuator.Value(ledger, D("2024-12-31"), new PriceTable(), Rates(), cash);
        Assert.Equal(0.1, v.AnnualizedReturn!.Value, 6);   // 1,000 grew to 1,100 over exactly 365 days
    }

    [Fact]
    public void Fx_table_crosses_through_cad()
    {
        var fx = Rates(usdCad: 1.40m, eurCad: 1.60m);
        Assert.Equal(1m, fx.GetRate("USD", "USD", D("2025-01-01")));
        Assert.Equal(1.40m, fx.GetRate("USD", "CAD", D("2025-01-01")));
        Assert.Equal(1m / 1.40m, fx.GetRate("CAD", "USD", D("2025-01-01")));
        Assert.Equal(1.40m / 1.60m, fx.GetRate("USD", "EUR", D("2025-01-01")));
        Assert.Null(fx.GetRate("USD", "GBP", D("2025-01-01")));
    }

    [Fact]
    public void Fx_table_uses_the_latest_rate_on_or_before_the_date()
    {
        var fx = new FxTable();
        fx.Add("USD", D("2025-01-02"), 1.40m);
        fx.Add("USD", D("2025-01-03"), 1.42m);

        Assert.Equal(1.40m, fx.GetRate("USD", "CAD", D("2024-12-25")));   // before the first rate
        Assert.Equal(1.40m, fx.GetRate("USD", "CAD", D("2025-01-02")));
        Assert.Equal(1.42m, fx.GetRate("USD", "CAD", D("2025-01-05")));
        Assert.Equal(D("2025-01-03"), fx.LatestDate);
    }
}
