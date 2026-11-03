using System.Net;
using Folio.Api.MarketData;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Folio.Api.Tests;

public class AlphaVantageClientTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static (AlphaVantageClient Client, ListLogger<AlphaVantageClient> Log, StubHttpHandler Handler) Create(
        string? body, string? apiKey = "secret key", HttpStatusCode status = HttpStatusCode.OK)
    {
        var handler = StubHttpHandler.Json(body ?? "{}", status);
        var log = new ListLogger<AlphaVantageClient>();
        var options = Options.Create(new MarketDataOptions { AlphaVantageApiKey = apiKey });
        return (new AlphaVantageClient(handler.CreateClient(), options, log), log, handler);
    }

    private static string Quote(string price = "187.50", string day = "2026-10-08") =>
        $$$"""{"Global Quote":{"01. symbol":"X","05. price":"{{{price}}}","07. latest trading day":"{{{day}}}"}}""";

    [Theory]
    [InlineData(null, false)]
    [InlineData("", false)]
    [InlineData("   ", false)]
    [InlineData("abc", true)]
    public void WhenKeyIsChecked_ShouldBeConfiguredOnlyWithANonBlankKey(string? key, bool expected) =>
        Create(null, key).Client.IsConfigured.ShouldBe(expected);

    [Fact]
    public async Task WhenNoKeyIsConfigured_ShouldReturnNullWithoutCallingOut()
    {
        var (client, _, handler) = Create(Quote(), apiKey: null);

        (await client.GetLatestAsync("AAPL", "USD", Ct)).ShouldBeNull();
        handler.Requests.ShouldBeEmpty();
    }

    [Fact]
    public async Task WhenExchangeIsNotSupported_ShouldReturnNullWithoutCallingOut()
    {
        var (client, _, handler) = Create(Quote());

        (await client.GetLatestAsync("AIR.PA", "EUR", Ct)).ShouldBeNull();
        handler.Requests.ShouldBeEmpty();
    }

    [Fact]
    public async Task WhenQuoteIsReturned_ShouldMapSymbolAndParsePriceAndDate()
    {
        var (client, _, handler) = Create(Quote("187.50", "2026-10-08"));

        var quote = await client.GetLatestAsync("SHOP.TO", "CAD", Ct);

        quote.ShouldNotBeNull();
        quote.Value.Close.ShouldBe(187.50m);
        quote.Value.Date.ShouldBe(new DateOnly(2026, 10, 8));
        var url = handler.Requests.ShouldHaveSingleItem().AbsoluteUri;
        url.ShouldContain("function=GLOBAL_QUOTE");
        url.ShouldContain("symbol=SHOP.TRT");
        url.ShouldContain("apikey=secret%20key");
    }

    [Fact]
    public async Task WhenLondonQuoteIsInPounds_ShouldConvertPenceToPounds()
    {
        var (client, _, _) = Create(Quote("118.35"));

        (await client.GetLatestAsync("VOD.L", "GBP", Ct))!.Value.Close.ShouldBe(1.1835m);
    }

    [Fact]
    public async Task WhenLondonQuoteIsInAnotherCurrency_ShouldKeepThePrice()
    {
        var (client, _, _) = Create(Quote("118.35"));

        (await client.GetLatestAsync("VUSA.L", "USD", Ct))!.Value.Close.ShouldBe(118.35m);
    }

    [Theory]
    [InlineData("""{"Note":"Thank you for using Alpha Vantage! Rate limit reached."}""", "Rate limit reached")]
    [InlineData("""{"Information":"Premium endpoint."}""", "Premium endpoint.")]
    [InlineData("{}", "no quote returned")]
    [InlineData("""{"Global Quote":{}}""", "no quote returned")]
    [InlineData("""{"Global Quote":"nope"}""", "no quote returned")]
    [InlineData("""{"Global Quote":{"05. price":"10"}}""", "no quote returned")]
    [InlineData("""{"Global Quote":{"05. price":"abc","07. latest trading day":"2026-10-08"}}""", "no quote returned")]
    [InlineData("""{"Global Quote":{"05. price":"10","07. latest trading day":"08/10/2026"}}""", "no quote returned")]
    [InlineData("""{"Global Quote":{"05. price":"0","07. latest trading day":"2026-10-08"}}""", "no quote returned")]
    public async Task WhenAnswerHasNoUsableQuote_ShouldWarnAndReturnNull(string body, string expectedNote)
    {
        var (client, log, _) = Create(body);

        (await client.GetLatestAsync("AAPL", "USD", Ct)).ShouldBeNull();

        var warning = log.Entries.ShouldHaveSingleItem();
        warning.Level.ShouldBe(LogLevel.Warning);
        warning.Message.ShouldStartWith("Alpha Vantage had no quote for AAPL: ");
        warning.Message.ShouldContain(expectedNote);
    }

    [Fact]
    public async Task WhenProviderFails_ShouldLetTheHttpErrorPropagate()
    {
        var (client, _, _) = Create("{}", status: HttpStatusCode.InternalServerError);

        await Should.ThrowAsync<HttpRequestException>(() => client.GetLatestAsync("AAPL", "USD", Ct));
    }
}
