using Folio.Core;

namespace Folio.Core.Tests;

public class PortfolioLedgerTests
{
    private static readonly Guid Shop = Guid.NewGuid();
    private static readonly Guid Aapl = Guid.NewGuid();

    [Fact]
    public void Average_cost_includes_commissions_and_a_partial_sale_realizes_against_it()
    {
        var b = new LedgerBuilder();
        b.Deposit("2025-01-02", 10_000m);
        b.Buy("2025-01-03", Shop, 100, 50m, fee: 10m);
        b.Buy("2025-02-03", Shop, 50, 60m, fee: 10m);
        b.Sell("2025-03-03", Shop, 60, 70m, fee: 10m);

        var ledger = b.Replay();
        var position = ledger.Positions[Shop];

        // ACB 8,020 for 150 shares; 60 sold carry 8,020 x 60/150 = 3,208 of it against 4,190 of proceeds.
        Assert.Equal(90m, position.Quantity);
        Assert.Equal(4_812m, position.CostLocal);
        Assert.Equal(53.466666666666666666666666667m, position.AverageCostLocal, 20);
        Assert.Equal(982m, ledger.RealizedGain);
        Assert.Equal(30m, ledger.Fees);
        Assert.Equal(10_000m, ledger.NetContributions);
    }

    [Fact]
    public void Trades_dividends_and_fees_never_change_net_deposits()
    {
        var b = new LedgerBuilder();
        b.Deposit("2025-01-02", 1_000m);
        b.Buy("2025-01-03", Shop, 10, 50m, fee: 5m);
        b.Dividend("2025-02-01", Shop, 12m);
        b.Add(new LedgerEntry { Type = TransactionType.Fee, Date = LedgerBuilder.D("2025-02-02"), Currency = "CAD", Amount = 9.95m });
        b.Sell("2025-03-01", Shop, 10, 60m, fee: 5m);
        b.Withdraw("2025-03-02", 200m);

        var ledger = b.Replay();
        Assert.Equal(800m, ledger.NetContributions);
        Assert.Equal(2, ledger.ExternalFlows.Count);
        Assert.Equal(12m, ledger.Dividends);
        Assert.Equal(19.95m, ledger.Fees);
    }

    [Fact]
    public void Selling_everything_clears_the_cost_and_a_new_buy_reopens_the_position()
    {
        var b = new LedgerBuilder();
        b.Buy("2025-01-03", Shop, 3, 10m);
        b.Sell("2025-01-04", Shop, 3, 11m);
        var ledger = b.Replay();

        var position = ledger.Positions[Shop];
        Assert.Equal(0m, position.Quantity);
        Assert.Equal(0m, position.CostLocal);
        Assert.Equal(0m, position.CostBase);
        Assert.Equal(LedgerBuilder.D("2025-01-04"), position.ClosedOn);
        Assert.Empty(ledger.OpenPositions);

        b.Buy("2025-02-01", Shop, 1, 12m);
        position = b.Replay().Positions[Shop];
        Assert.Equal(LedgerBuilder.D("2025-02-01"), position.OpenedOn);
        Assert.Null(position.ClosedOn);
        Assert.Equal(12m, position.CostLocal);
    }

    [Fact]
    public void Selling_more_than_is_held_is_rejected_with_the_offending_entry()
    {
        var b = new LedgerBuilder();
        b.Buy("2025-01-03", Shop, 10, 10m);
        var bad = b.Sell("2025-01-04", Shop, 11, 10m);

        var ex = Assert.Throws<LedgerException>(() => b.Replay());
        Assert.Equal(bad.Id, ex.EntryId);
        Assert.Contains("only 10 held", ex.Message);
    }

    [Fact]
    public void A_split_changes_the_share_count_but_not_the_cost()
    {
        var b = new LedgerBuilder();
        b.Buy("2024-06-03", Aapl, 10, 1_200m);
        b.Split("2024-06-10", Aapl, 1, 10);
        b.Sell("2024-07-01", Aapl, 50, 130m);

        var ledger = b.Replay();
        var position = ledger.Positions[Aapl];

        Assert.Equal(50m, position.Quantity);
        Assert.Equal(6_000m, position.CostLocal);
        Assert.Equal(120m, position.AverageCostLocal);
        Assert.Equal(500m, ledger.RealizedGain);
    }

    [Fact]
    public void A_reverse_split_keeps_fractional_shares()
    {
        var b = new LedgerBuilder();
        b.Buy("2024-01-02", Shop, 10, 3m);
        b.Split("2024-02-01", Shop, 3, 1);

        var position = b.Replay().Positions[Shop];
        Assert.Equal(3.33333333m, position.Quantity);
        Assert.Equal(30m, position.CostLocal);
    }

    [Fact]
    public void A_split_applies_before_other_transactions_on_its_ex_date()
    {
        var b = new LedgerBuilder();
        b.Buy("2024-06-03", Aapl, 10, 1_200m);
        b.Buy("2024-06-10", Aapl, 5, 121m);   // recorded first, but bought at the post-split price
        b.Split("2024-06-10", Aapl, 1, 10);

        Assert.Equal(105m, b.Replay().Positions[Aapl].Quantity);
    }

    [Fact]
    public void A_split_with_no_shares_held_is_rejected()
    {
        var b = new LedgerBuilder();
        b.Split("2024-06-10", Aapl, 1, 10);
        Assert.Throws<LedgerException>(() => b.Replay());
    }

    [Fact]
    public void Foreign_trades_track_cost_in_both_currencies_at_their_own_exchange_rates()
    {
        var b = new LedgerBuilder();
        b.Buy("2025-01-03", Aapl, 10, 200m, fee: 1m, currency: "USD", fx: 1.40m);
        b.Sell("2025-06-02", Aapl, 10, 250m, fee: 1m, currency: "USD", fx: 1.45m);

        var ledger = b.Replay();
        var gain = Assert.Single(ledger.RealizedGains);

        Assert.Equal(498m, gain.GainLocal);                // 2,499 - 2,001 USD
        Assert.Equal(822.15m, gain.GainBase);              // 2,499 x 1.45 - 2,001 x 1.40 CAD
        Assert.Equal(2.85m, ledger.Fees);                  // 1.40 + 1.45
    }

    [Fact]
    public void Dividends_count_the_net_amount_and_record_the_tax_withheld()
    {
        var b = new LedgerBuilder();
        b.Buy("2025-01-03", Aapl, 100, 200m, currency: "USD", fx: 1.4m);
        b.Dividend("2025-02-14", Aapl, 25m, withheld: 3.75m, currency: "USD", fx: 1.4m);

        var ledger = b.Replay();
        Assert.Equal(29.75m, ledger.Dividends);
        Assert.Equal(5.25m, ledger.TaxWithheld);
        Assert.Equal(29.75m, ledger.Positions[Aapl].DividendsBase);
    }

    [Fact]
    public void A_dividend_after_the_position_is_sold_is_still_accepted()
    {
        var b = new LedgerBuilder();
        b.Buy("2025-01-03", Shop, 10, 10m);
        b.Sell("2025-02-01", Shop, 10, 12m);
        b.Dividend("2025-02-15", Shop, 4m);

        var ledger = b.Replay();
        Assert.Equal(4m, ledger.Dividends);
        Assert.Empty(ledger.OpenPositions);
    }

    [Fact]
    public void A_transfer_in_adds_shares_and_counts_its_book_value_as_a_contribution()
    {
        var b = new LedgerBuilder();
        b.TransferIn("2020-03-02", Aapl, 20, 75m, currency: "USD", fx: 1.35m);

        var ledger = b.Replay();
        Assert.Equal(20m, ledger.Positions[Aapl].Quantity);
        Assert.Equal(2_025m, ledger.Positions[Aapl].CostBase);
        Assert.Equal(2_025m, ledger.NetContributions);
    }

    [Fact]
    public void Withdrawals_reduce_contributions()
    {
        var b = new LedgerBuilder();
        b.Deposit("2025-01-02", 1_000m);
        b.Withdraw("2025-01-05", 1_500m);

        var ledger = b.Replay();
        Assert.Equal(-500m, ledger.NetContributions);
        Assert.Equal(2, ledger.ExternalFlows.Count);
    }

    [Fact]
    public void A_security_cannot_change_currency()
    {
        var b = new LedgerBuilder();
        b.Buy("2025-01-03", Aapl, 1, 200m, currency: "USD", fx: 1.4m);
        b.Buy("2025-01-04", Aapl, 1, 280m, currency: "CAD");

        var ex = Assert.Throws<LedgerException>(() => b.Replay());
        Assert.Contains("trades in USD", ex.Message);
    }

    [Fact]
    public void Base_currency_entries_must_use_a_rate_of_one()
    {
        var b = new LedgerBuilder();
        b.Deposit("2025-01-02", 100m, "CAD", fx: 0.7m);
        Assert.Throws<LedgerException>(() => b.Replay());
    }

    [Fact]
    public void Entries_must_arrive_in_date_order_when_applied_one_by_one()
    {
        var ledger = new PortfolioLedger("CAD");
        ledger.Apply(new LedgerEntry { Type = TransactionType.Deposit, Date = LedgerBuilder.D("2025-02-01"), Currency = "CAD", Amount = 1 });
        Assert.Throws<LedgerException>(() =>
            ledger.Apply(new LedgerEntry { Type = TransactionType.Deposit, Date = LedgerBuilder.D("2025-01-01"), Currency = "CAD", Amount = 1 }));
    }

    [Fact]
    public void Totals_describe_the_money_each_transaction_involved()
    {
        var b = new LedgerBuilder();
        Assert.Equal(205m, b.Buy("2025-01-03", Shop, 2, 100m, fee: 5m).Total);
        Assert.Equal(115m, b.Sell("2025-01-04", Shop, 1, 120m, fee: 5m).Total);
        Assert.Equal(2m, b.Dividend("2025-01-05", Shop, 3m, withheld: 1m).Total);
        Assert.Equal(0m, b.Split("2025-01-06", Shop, 1, 2).Total);
        Assert.Equal(50m, b.Withdraw("2025-01-07", 50m).Total);
        Assert.Equal(150m, b.TransferIn("2025-01-08", Aapl, 3, 50m).Total);
    }
}
