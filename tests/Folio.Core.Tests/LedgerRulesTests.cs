namespace Folio.Core.Tests;

public class LedgerRulesTests
{
    private static readonly Guid Shop = Guid.NewGuid();
    private static readonly DateOnly Day = LedgerBuilder.D("2025-01-03");

    private static LedgerEntry Entry(TransactionType type, Guid? security = null, decimal quantity = 0, decimal price = 0,
        decimal amount = 0, decimal fee = 0, string currency = "CAD", decimal fx = 1m) =>
        new()
        {
            Type = type, Date = Day, SecurityId = security, Currency = currency,
            Quantity = quantity, Price = price, Amount = amount, Fee = fee, FxRate = fx,
        };

    private static LedgerException Rejected(LedgerEntry entry, string baseCurrency = "CAD") =>
        Should.Throw<LedgerException>(() => new PortfolioLedger(baseCurrency).Apply(entry));

    [Fact]
    public void WhenBaseCurrencyIsUnsupported_ShouldRejectTheLedger()
    {
        var ex = Should.Throw<ArgumentException>(() => new PortfolioLedger("XXX"));
        ex.ParamName.ShouldBe("baseCurrency");
        ex.Message.ShouldContain("Unsupported currency 'XXX'");
    }

    [Fact]
    public void WhenInterestIsReceivedInForeignCurrency_ShouldAddItInBaseCurrency()
    {
        var ledger = new PortfolioLedger("CAD");
        ledger.Apply(Entry(TransactionType.Interest, amount: 10m, currency: "USD", fx: 1.4m));

        ledger.Interest.ShouldBe(14m);
        ledger.NetContributions.ShouldBe(0m);
        ledger.FirstDate.ShouldBe(Day);
        ledger.LastDate.ShouldBe(Day);
    }

    [Fact]
    public void WhenAccountFeeIsCharged_ShouldAddItToFees()
    {
        var ledger = new PortfolioLedger("CAD");
        ledger.Apply(Entry(TransactionType.Fee, amount: 9.5m));

        ledger.Fees.ShouldBe(9.5m);
    }

    [Theory]
    [InlineData(TransactionType.Interest)]
    [InlineData(TransactionType.Fee)]
    [InlineData(TransactionType.Deposit)]
    [InlineData(TransactionType.Withdrawal)]
    public void WhenAmountIsNotPositive_ShouldReject(TransactionType type) =>
        Rejected(Entry(type, amount: 0m)).Message.ShouldBe("Amount must be greater than zero.");

    [Fact]
    public void WhenTypeIsUnknown_ShouldReject() =>
        Rejected(Entry((TransactionType)99, amount: 1m)).Message.ShouldBe("Unknown transaction type '99'.");

    [Fact]
    public void WhenCurrencyIsUnsupported_ShouldReject() =>
        Rejected(Entry(TransactionType.Deposit, amount: 1m, currency: "XXX")).Message.ShouldBe("Unsupported currency 'XXX'.");

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void WhenExchangeRateIsNotPositive_ShouldReject(int rate) =>
        Rejected(Entry(TransactionType.Deposit, amount: 1m, currency: "USD", fx: rate))
            .Message.ShouldBe("The exchange rate must be greater than zero.");

    [Fact]
    public void WhenSecurityTypeHasNoSecurity_ShouldReject() =>
        Rejected(Entry(TransactionType.Buy, quantity: 1, price: 1)).Message.ShouldBe("A Buy needs a security.");

    [Fact]
    public void WhenCashTypeHasNoSecurity_ShouldBeAccepted()
    {
        var ledger = new PortfolioLedger("CAD");
        ledger.Apply(Entry(TransactionType.Deposit, amount: 5m));

        ledger.NetContributions.ShouldBe(5m);
    }

    [Fact]
    public void WhenFeeIsNegative_ShouldReject() =>
        Rejected(Entry(TransactionType.Deposit, amount: 1m, fee: -1m)).Message.ShouldBe("Fees cannot be negative.");

    [Theory]
    [InlineData(TransactionType.Buy)]
    [InlineData(TransactionType.TransferIn)]
    public void WhenPurchasePriceIsNegative_ShouldReject(TransactionType type) =>
        Rejected(Entry(type, Shop, quantity: 1, price: -1m)).Message.ShouldBe("The price cannot be negative.");

    [Fact]
    public void WhenSalePriceIsNegative_ShouldReject()
    {
        var ledger = new PortfolioLedger("CAD");
        ledger.Apply(Entry(TransactionType.Buy, Shop, quantity: 2, price: 10m));

        var ex = Should.Throw<LedgerException>(() => ledger.Apply(Entry(TransactionType.Sell, Shop, quantity: 1, price: -1m)));
        ex.Message.ShouldBe("The price cannot be negative.");
    }

    [Fact]
    public void WhenTaxWithheldExceedsDividend_ShouldReject() =>
        Rejected(Entry(TransactionType.Dividend, Shop, amount: 1m, fee: 2m))
            .Message.ShouldBe("The tax withheld cannot exceed the dividend.");

    [Fact]
    public void WhenDividendArrivesForUnknownSecurity_ShouldCreateAPlaceholderPosition()
    {
        var ledger = new PortfolioLedger("CAD");
        ledger.Apply(Entry(TransactionType.Dividend, Shop, amount: 10m, fee: 1m, currency: "USD", fx: 1.5m));

        var position = ledger.Positions[Shop];
        position.Currency.ShouldBe("USD");
        position.Quantity.ShouldBe(0m);
        position.DividendsBase.ShouldBe(13.5m);
        ledger.OpenPositions.ShouldBeEmpty();
    }

    [Fact]
    public void WhenPlaceholderPositionIsLaterBoughtInAnotherCurrency_ShouldAdoptTheTradingCurrency()
    {
        var ledger = new PortfolioLedger("CAD");
        ledger.Apply(Entry(TransactionType.Dividend, Shop, amount: 10m, currency: "USD", fx: 1.5m));
        ledger.Apply(Entry(TransactionType.Buy, Shop, quantity: 1, price: 20m, currency: "CAD"));

        ledger.Positions[Shop].Currency.ShouldBe("CAD");
        ledger.Positions[Shop].Quantity.ShouldBe(1m);
    }

    [Fact]
    public void WhenPositionWasSoldOutAndIsBoughtInAnotherCurrency_ShouldReject()
    {
        var ledger = new PortfolioLedger("CAD");
        ledger.Apply(Entry(TransactionType.Buy, Shop, quantity: 1, price: 10m, currency: "USD", fx: 1.4m));
        ledger.Apply(Entry(TransactionType.Sell, Shop, quantity: 1, price: 12m, currency: "USD", fx: 1.4m));

        var ex = Should.Throw<LedgerException>(() =>
            ledger.Apply(Entry(TransactionType.Buy, Shop, quantity: 1, price: 10m, currency: "CAD")));
        ex.Message.ShouldBe("This security trades in USD, not CAD.");
    }

    [Fact]
    public void WhenSplitRoundsTheQuantityToZero_ShouldStillRememberTheCostCurrency()
    {
        var ledger = new PortfolioLedger("CAD");
        ledger.Apply(Entry(TransactionType.Buy, Shop, quantity: 0.00000001m, price: 10m, currency: "USD", fx: 1.4m));
        ledger.Apply(new LedgerEntry
        {
            Type = TransactionType.Split, Date = Day, SecurityId = Shop, Currency = "USD", FxRate = 1.4m, SplitFrom = 2, SplitTo = 1,
        });

        ledger.Positions[Shop].Quantity.ShouldBe(0m);
        var ex = Should.Throw<LedgerException>(() =>
            ledger.Apply(Entry(TransactionType.Buy, Shop, quantity: 1, price: 10m, currency: "CAD")));
        ex.Message.ShouldBe("This security trades in USD, not CAD.");
    }

    [Fact]
    public void WhenPositionIsOpen_ShouldReportAverageCostsPerShare()
    {
        var ledger = new PortfolioLedger("CAD");
        ledger.Apply(Entry(TransactionType.Buy, Shop, quantity: 4, price: 10m, fee: 2m, currency: "USD", fx: 1.5m));

        var position = ledger.Positions[Shop];
        position.AverageCostLocal.ShouldBe(10.5m);
        position.AverageCostBase.ShouldBe(15.75m);
    }

    [Fact]
    public void WhenPositionIsClosed_ShouldReportZeroAverageCosts()
    {
        var ledger = new PortfolioLedger("CAD");
        ledger.Apply(Entry(TransactionType.Buy, Shop, quantity: 4, price: 10m));
        ledger.Apply(Entry(TransactionType.Sell, Shop, quantity: 4, price: 11m));

        var position = ledger.Positions[Shop];
        position.AverageCostLocal.ShouldBe(0m);
        position.AverageCostBase.ShouldBe(0m);
        position.ClosedOn.ShouldBe(Day);
    }

    [Theory]
    [InlineData(TransactionType.Buy, true)]
    [InlineData(TransactionType.Sell, true)]
    [InlineData(TransactionType.Split, true)]
    [InlineData(TransactionType.Dividend, true)]
    [InlineData(TransactionType.TransferIn, true)]
    [InlineData(TransactionType.Deposit, false)]
    [InlineData(TransactionType.Withdrawal, false)]
    [InlineData(TransactionType.Interest, false)]
    [InlineData(TransactionType.Fee, false)]
    public void WhenTypeIsChecked_ShouldRequireASecurityOnlyForSecurityTypes(TransactionType type, bool expected) =>
        type.RequiresSecurity().ShouldBe(expected);

    [Theory]
    [InlineData(TransactionType.Buy, true)]
    [InlineData(TransactionType.Sell, true)]
    [InlineData(TransactionType.TransferIn, true)]
    [InlineData(TransactionType.Split, false)]
    [InlineData(TransactionType.Dividend, false)]
    [InlineData(TransactionType.Deposit, false)]
    public void WhenTypeIsChecked_ShouldCallOnlyBuySellAndTransferTrades(TransactionType type, bool expected) =>
        type.IsTrade().ShouldBe(expected);

    [Theory]
    [InlineData(TransactionType.Buy, 205)]
    [InlineData(TransactionType.TransferIn, 200)]
    [InlineData(TransactionType.Sell, 195)]
    [InlineData(TransactionType.Dividend, 45)]
    [InlineData(TransactionType.Split, 0)]
    [InlineData(TransactionType.Deposit, 50)]
    [InlineData(TransactionType.Withdrawal, 50)]
    [InlineData(TransactionType.Interest, 50)]
    [InlineData(TransactionType.Fee, 50)]
    [InlineData((TransactionType)99, 50)]
    public void WhenEntryHasQuantityPriceAmountAndFee_ShouldTotalByType(TransactionType type, int expected)
    {
        var entry = Entry(type, Shop, quantity: 2, price: 100m, amount: 50m, fee: 5m);

        entry.Total.ShouldBe(expected);
    }
}
