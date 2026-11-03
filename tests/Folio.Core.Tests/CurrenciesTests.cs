namespace Folio.Core.Tests;

public class CurrenciesTests
{
    [Theory]
    [InlineData(" usd ", "USD")]
    [InlineData("cad", "CAD")]
    [InlineData("", "")]
    [InlineData(null, "")]
    public void WhenCodeIsMessy_ShouldNormalizeToUpperCaseWithoutPadding(string? input, string expected) =>
        Currencies.Normalize(input).ShouldBe(expected);

    [Theory]
    [InlineData("CAD", true)]
    [InlineData("TRY", true)]
    [InlineData("usd", false)]
    [InlineData("XXX", false)]
    [InlineData(null, false)]
    public void WhenCodeIsChecked_ShouldBeSupportedOnlyIfListedExactly(string? code, bool expected) =>
        Currencies.IsSupported(code).ShouldBe(expected);

    [Theory]
    [InlineData("CAD", true)]
    [InlineData("USD", true)]
    [InlineData("EUR", true)]
    [InlineData("GBP", false)]
    [InlineData(null, false)]
    public void WhenCodeIsChecked_ShouldBePortfolioCurrencyOnlyForCadUsdEur(string? code, bool expected) =>
        Currencies.IsPortfolioCurrency(code).ShouldBe(expected);
}
