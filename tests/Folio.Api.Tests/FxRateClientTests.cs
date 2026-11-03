using System.Net;
using System.Text;
using Folio.Api.MarketData;
using Microsoft.Extensions.Logging;

namespace Folio.Api.Tests;

public class FxRateClientTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static HttpResponseMessage Json(string body) =>
        new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    private static (FxRateClient Client, StubHttpHandler Handler, ListLogger<FxRateClient> Log) Create(
        Func<HttpRequestMessage, HttpResponseMessage>? boc = null, Func<HttpRequestMessage, HttpResponseMessage>? ecb = null)
    {
        var handler = new StubHttpHandler(request => request.RequestUri!.Host.Contains("bankofcanada", StringComparison.Ordinal)
            ? (boc ?? (_ => Json("""{"observations":[]}""")))(request)
            : (ecb ?? (_ => Json("""{"rates":{}}""")))(request));
        var log = new ListLogger<FxRateClient>();
        return (new FxRateClient(handler.CreateClient(), log), handler, log);
    }

    private static readonly DateOnly Recent = new(2026, 10, 1);

    [Theory]
    [InlineData("CAD")]
    public async Task WhenOnlyCadIsWanted_ShouldReturnNothingWithoutCallingOut(string currency)
    {
        var (client, handler, _) = Create();

        (await client.GetCadRatesAsync([currency], Recent, Recent.AddDays(5), Ct)).ShouldBeEmpty();
        handler.Requests.ShouldBeEmpty();
    }

    [Fact]
    public async Task WhenNothingIsWanted_ShouldReturnNothing()
    {
        var (client, handler, _) = Create();

        (await client.GetCadRatesAsync([], Recent, Recent.AddDays(5), Ct)).ShouldBeEmpty();
        handler.Requests.ShouldBeEmpty();
    }

    [Fact]
    public async Task WhenRangeEndsBeforeItStarts_ShouldReturnNothing()
    {
        var (client, handler, _) = Create();

        (await client.GetCadRatesAsync(["USD"], Recent.AddDays(5), Recent, Ct)).ShouldBeEmpty();
        handler.Requests.ShouldBeEmpty();
    }

    [Fact]
    public async Task WhenCurrenciesAreRecentAndSupportedByTheBank_ShouldReadThemFromTheBankOfCanada()
    {
        var (client, handler, _) = Create(boc: _ => Json("""
            {"observations":[
              {"d":"2026-10-01","FXUSDCAD":{"v":"1.3800"},"FXEURCAD":{"v":"1.6100"}},
              {"d":"2026-10-02","FXUSDCAD":{"v":"0"},"FXEURCAD":{"v":"abc"}},
              {"d":"2026-10-05","FXUSDCAD":{}}
            ]}
            """));

        var rates = await client.GetCadRatesAsync(["USD", "CAD", "EUR", "USD"], Recent, Recent.AddDays(10), Ct);

        rates.ShouldBe(
        [
            new FxObservation("USD", Recent, 1.38m, "BankOfCanada"),
            new FxObservation("EUR", Recent, 1.61m, "BankOfCanada"),
        ]);
        handler.Requests.ShouldHaveSingleItem().AbsoluteUri
            .ShouldBe("https://www.bankofcanada.ca/valet/observations/FXUSDCAD,FXEURCAD/json?start_date=2026-10-01&end_date=2026-10-11");
    }

    [Fact]
    public async Task WhenCurrencyIsNotPublishedByTheBank_ShouldReadItFromTheEcbAsTheInverse()
    {
        var (client, handler, _) = Create(ecb: _ => Json("""{"rates":{"2026-10-01":{"DKK":4},"2026-10-02":{"DKK":0}}}"""));

        var rates = await client.GetCadRatesAsync(["DKK"], Recent, Recent.AddDays(3), Ct);

        rates.ShouldBe([new FxObservation("DKK", Recent, 0.25m, "ECB")]);
        handler.Requests.ShouldHaveSingleItem().AbsoluteUri
            .ShouldBe("https://api.frankfurter.dev/v1/2026-10-01..2026-10-04?base=CAD&symbols=DKK");
    }

    [Fact]
    public async Task WhenEcbAnswersWithoutRates_ShouldReturnNothing()
    {
        var (client, _, _) = Create(ecb: _ => Json("{}"));

        (await client.GetCadRatesAsync(["DKK"], Recent, Recent.AddDays(3), Ct)).ShouldBeEmpty();
    }

    [Fact]
    public async Task WhenRangeStartsBeforeTheBanksArchive_ShouldTakeTheEarlyDaysFromTheEcbAndTheRestFromTheBank()
    {
        var (client, handler, _) = Create(
            boc: _ => Json("""{"observations":[{"d":"2017-01-03","FXUSDCAD":{"v":"1.3400"}}]}"""),
            ecb: _ => Json("""{"rates":{"2016-12-30":{"USD":0.5}}}"""));

        var rates = await client.GetCadRatesAsync(["USD"], new DateOnly(2016, 12, 28), new DateOnly(2017, 1, 5), Ct);

        rates.ShouldBe(
        [
            new FxObservation("USD", new DateOnly(2017, 1, 3), 1.34m, "BankOfCanada"),
            new FxObservation("USD", new DateOnly(2016, 12, 30), 2m, "ECB"),
        ]);
        var urls = handler.Requests.Select(u => u.AbsoluteUri).ToList();
        urls.ShouldContain("https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?start_date=2017-01-03&end_date=2017-01-05");
        urls.ShouldContain("https://api.frankfurter.dev/v1/2016-12-28..2017-01-02?base=CAD&symbols=USD");
    }

    [Fact]
    public async Task WhenWholeRangeIsBeforeTheBanksArchive_ShouldUseOnlyTheEcb()
    {
        var (client, handler, _) = Create(ecb: _ => Json("""{"rates":{"2016-06-01":{"USD":0.8}}}"""));

        var rates = await client.GetCadRatesAsync(["USD"], new DateOnly(2016, 6, 1), new DateOnly(2016, 6, 2), Ct);

        rates.ShouldBe([new FxObservation("USD", new DateOnly(2016, 6, 1), 1.25m, "ECB")]);
        handler.Requests.Select(u => u.Host).ShouldBe(["api.frankfurter.dev"]);
    }

    [Fact]
    public async Task WhenBankAndEcbOnlyCurrenciesAreMixed_ShouldSplitThemBetweenTheSources()
    {
        var (client, handler, _) = Create(
            boc: _ => Json("""{"observations":[{"d":"2026-10-01","FXUSDCAD":{"v":"1.4"}}]}"""),
            ecb: _ => Json("""{"rates":{"2026-10-01":{"DKK":5}}}"""));

        var rates = await client.GetCadRatesAsync(["USD", "DKK"], Recent, Recent, Ct);

        rates.Select(r => (r.Currency, r.Source)).ShouldBe([("USD", "BankOfCanada"), ("DKK", "ECB")], ignoreOrder: true);
        handler.Requests.Count.ShouldBe(2);
    }

    public static TheoryData<Func<HttpRequestMessage, HttpResponseMessage>> BankFailures => new()
    {
        _ => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable),
        _ => Json("not json"),
        _ => Json("""{"observations":{}}"""),
        _ => throw new TaskCanceledException("timed out"),
    };

    [Theory]
    [MemberData(nameof(BankFailures))]
    public async Task WhenBankOfCanadaFails_ShouldFallBackToTheEcbAndSayWhy(Func<HttpRequestMessage, HttpResponseMessage> failure)
    {
        var (client, handler, log) = Create(boc: failure, ecb: _ => Json("""{"rates":{"2026-10-01":{"USD":0.5}}}"""));

        var rates = await client.GetCadRatesAsync(["USD"], Recent, Recent.AddDays(1), Ct);

        rates.ShouldBe([new FxObservation("USD", Recent, 2m, "ECB")]);
        handler.Requests.Select(u => u.Host).ShouldBe(["www.bankofcanada.ca", "api.frankfurter.dev"]);
        var entry = log.Entries.ShouldHaveSingleItem();
        entry.Level.ShouldBe(LogLevel.Warning);
        entry.Message.ShouldBe("Bank of Canada rates unavailable; falling back to ECB rates.");
    }

    [Fact]
    public async Task WhenTheCallerCancels_ShouldNotFallBackToTheEcb()
    {
        using var cts = new CancellationTokenSource();
        var (client, handler, log) = Create(boc: _ =>
        {
            cts.Cancel();
            throw new TaskCanceledException();
        });

        await Should.ThrowAsync<TaskCanceledException>(() => client.GetCadRatesAsync(["USD"], Recent, Recent.AddDays(1), cts.Token));

        handler.Requests.Select(u => u.Host).ShouldBe(["www.bankofcanada.ca"]);
        log.Entries.ShouldBeEmpty();
    }

    [Fact]
    public async Task WhenBankAnswerIsMalformedInAWayWeDoNotExpect_ShouldNotHideIt()
    {
        var (client, _, _) = Create(boc: _ => Json("""{"observations":[{"FXUSDCAD":{"v":"1.4"}}]}"""));

        await Should.ThrowAsync<KeyNotFoundException>(() => client.GetCadRatesAsync(["USD"], Recent, Recent.AddDays(1), Ct));
    }
}
