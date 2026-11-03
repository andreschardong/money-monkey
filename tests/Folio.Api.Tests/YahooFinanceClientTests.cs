using System.Globalization;
using System.Net;
using Folio.Api.Data;
using Folio.Api.MarketData;
using static Folio.Api.MarketData.YahooFinanceClient;

namespace Folio.Api.Tests;

public class YahooFinanceClientTests
{
    private static readonly DateOnly From = new(2026, 1, 1);
    private static readonly DateOnly To = new(2026, 12, 31);

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static long Unix(string date, int hour = 14) =>
        new DateTimeOffset(DateTime.Parse(date, CultureInfo.InvariantCulture).AddHours(hour), TimeSpan.Zero).ToUnixTimeSeconds();

    private static ChartResult Result(string currency = "USD", double?[]? closes = null, string[]? days = null, Action<ChartMeta>? meta = null)
    {
        days ??= ["2026-10-07", "2026-10-08"];
        var chartMeta = new ChartMeta { Currency = currency, Symbol = "AAPL", ExchangeName = "NMS", InstrumentType = "EQUITY", LongName = "Apple Inc." };
        meta?.Invoke(chartMeta);
        return new ChartResult
        {
            Meta = chartMeta,
            Timestamp = [.. days.Select(d => Unix(d))],
            Indicators = new ChartIndicators { Quote = [new QuoteIndicator { Close = [.. closes ?? [100d, 101d]] }] },
        };
    }

    [Fact]
    public async Task WhenSearching_ShouldKeepHoldableQuotesAndMapTheirDetails()
    {
        var handler = StubHttpHandler.Json("""
            {"quotes":[
              {"symbol":"shop.to","longName":"Shopify &amp; Co.","exchange":"TOR","exchDisp":"Toronto","quoteType":"EQUITY"},
              {"symbol":"VFV.TO","shortName":"Vanguard S&P 500","exchange":"TOR","quoteType":"ETF"},
              {"symbol":"NOLONG","exchange":"XYZ","exchDisp":"Somewhere","quoteType":"MUTUALFUND"},
              {"symbol":"BTC-USD","longName":"Bitcoin USD","exchange":"CCC","quoteType":"CRYPTOCURRENCY"},
              {"symbol":"  ","longName":"Blank","quoteType":"EQUITY"},
              {"symbol":"^GSPC","longName":"S&P 500","exchange":"SNP","quoteType":"INDEX"},
              {"longName":"No symbol","quoteType":"EQUITY"}
            ]}
            """);
        var client = new YahooFinanceClient(handler.CreateClient());

        var matches = await client.SearchAsync("sho p", Ct);

        matches.ShouldBe(
        [
            new SymbolMatch("SHOP.TO", "Shopify & Co.", "TSX", AssetType.Stock),
            new SymbolMatch("VFV.TO", "Vanguard S&P 500", "TSX", AssetType.Etf),
            new SymbolMatch("NOLONG", "NOLONG", "Somewhere", AssetType.Fund),
            new SymbolMatch("BTC-USD", "Bitcoin USD", "Crypto", AssetType.Crypto),
        ]);
        handler.Requests.ShouldHaveSingleItem().AbsoluteUri.ShouldStartWith($"{SearchHost}/v1/finance/search?q=sho%20p&");
    }

    [Fact]
    public async Task WhenSearchBodyHasNoQuotes_ShouldReturnNothing()
    {
        var client = new YahooFinanceClient(StubHttpHandler.Json("null").CreateClient());

        (await client.SearchAsync("x", Ct)).ShouldBeEmpty();
    }

    [Fact]
    public async Task WhenSearchFails_ShouldReportTheHttpStatus()
    {
        var client = new YahooFinanceClient(StubHttpHandler.Status(HttpStatusCode.TooManyRequests).CreateClient());

        var ex = await Should.ThrowAsync<MarketDataException>(() => client.SearchAsync("x", Ct));

        ex.Message.ShouldBe("Yahoo Finance search returned HTTP 429.");
    }

    [Fact]
    public async Task WhenHistoryIsRequested_ShouldAskForTheDaysInclusiveAndParseTheAnswer()
    {
        var handler = StubHttpHandler.Json($$$"""
            {"chart":{"result":[{
              "meta":{"currency":"USD","symbol":"AAPL","exchangeName":"NMS","instrumentType":"EQUITY","longName":"Apple Inc.","gmtoffset":0},
              "timestamp":[{{{Unix("2026-10-07")}}},{{{Unix("2026-10-08")}}}],
              "indicators":{"quote":[{"close":[100.0,101.5]}]}
            }]}}
            """);
        var client = new YahooFinanceClient(handler.CreateClient());

        var history = await client.GetHistoryAsync("aa pl", new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 9), Ct);

        history.Bars.Select(b => (b.Date, b.Close)).ShouldBe([(new DateOnly(2026, 10, 7), 100m), (new DateOnly(2026, 10, 8), 101.5m)]);
        var url = handler.Requests.ShouldHaveSingleItem().AbsoluteUri;
        url.ShouldContain("/v8/finance/chart/aa%20pl?");
        url.ShouldContain($"period1={Unix("2026-10-01", 0)}");
        url.ShouldContain($"period2={Unix("2026-10-10", 0)}");
    }

    [Theory]
    [InlineData(HttpStatusCode.NotFound)]
    [InlineData(HttpStatusCode.UnprocessableEntity)]
    public async Task WhenYahooDoesNotKnowTheSymbol_ShouldThrowSymbolNotFound(HttpStatusCode status)
    {
        var client = new YahooFinanceClient(StubHttpHandler.Status(status).CreateClient());

        var ex = await Should.ThrowAsync<SymbolNotFoundException>(() => client.GetHistoryAsync("ZZZ", From, To, Ct));

        ex.Symbol.ShouldBe("ZZZ");
    }

    [Fact]
    public async Task WhenYahooFails_ShouldThrowMarketDataExceptionWithTheStatus()
    {
        var client = new YahooFinanceClient(StubHttpHandler.Status(HttpStatusCode.InternalServerError).CreateClient());

        var ex = await Should.ThrowAsync<MarketDataException>(() => client.GetHistoryAsync("AAPL", From, To, Ct));

        ex.ShouldNotBeOfType<SymbolNotFoundException>();
        ex.Message.ShouldBe("Yahoo Finance returned HTTP 500 for AAPL.");
    }

    [Theory]
    [InlineData("null")]
    [InlineData("""{"chart":null}""")]
    [InlineData("""{"chart":{"result":null}}""")]
    [InlineData("""{"chart":{"result":[]}}""")]
    [InlineData("""{"chart":{"result":[{"timestamp":[1]}]}}""")]
    public async Task WhenAnswerHasNoMetadata_ShouldThrowSymbolNotFound(string body)
    {
        var client = new YahooFinanceClient(StubHttpHandler.Json(body).CreateClient());

        await Should.ThrowAsync<SymbolNotFoundException>(() => client.GetHistoryAsync("AAPL", From, To, Ct));
    }

    [Fact]
    public void WhenCurrencyIsMissing_ShouldThrowMarketDataException()
    {
        var ex = Should.Throw<MarketDataException>(() => Parse("AAPL", Result(currency: ""), From, To));

        ex.Message.ShouldBe("Yahoo Finance did not report a currency for AAPL.");
    }

    [Fact]
    public void WhenClosesAreMissingNonPositiveOrOutOfRange_ShouldSkipThem()
    {
        var result = Result(closes: [null, 0d, 105d, 106d], days: ["2026-10-05", "2026-10-06", "2026-10-07", "2027-02-01"]);

        var history = Parse("AAPL", result, From, To);

        history.Bars.ShouldHaveSingleItem().ShouldBe(new Folio.Core.PricePoint(new DateOnly(2026, 10, 7), 105m));
    }

    [Fact]
    public void WhenThereAreMoreTimestampsThanCloses_ShouldIgnoreTheSurplus()
    {
        var result = Result(closes: [100d], days: ["2026-10-07", "2026-10-08", "2026-10-09"]);

        Parse("AAPL", result, From, To).Bars.Count.ShouldBe(1);
    }

    [Fact]
    public void WhenAnswerHasNoSeries_ShouldReturnNoBars()
    {
        var result = new ChartResult { Meta = new ChartMeta { Currency = "CAD" } };

        var history = Parse("shop.to", result, From, To);

        history.Bars.ShouldBeEmpty();
        history.Splits.ShouldBeEmpty();
        history.Dividends.ShouldBeEmpty();
        history.Info.Symbol.ShouldBe("SHOP.TO");
        history.Info.Name.ShouldBe("SHOP.TO");
        history.Info.Exchange.ShouldBeNull();
        history.Info.AssetType.ShouldBe(AssetType.Other);
    }

    [Fact]
    public void WhenAnswerHasNoQuoteListOrNoCloses_ShouldReturnNoBars()
    {
        var noList = new ChartResult { Meta = new ChartMeta { Currency = "CAD" }, Timestamp = [Unix("2026-10-07")], Indicators = new ChartIndicators { Quote = null } };
        var noCloses = new ChartResult
        {
            Meta = new ChartMeta { Currency = "CAD" }, Timestamp = [Unix("2026-10-07")],
            Indicators = new ChartIndicators { Quote = [new QuoteIndicator { Close = null }] },
        };

        Parse("X", noList, From, To).Bars.ShouldBeEmpty();
        Parse("X", noCloses, From, To).Bars.ShouldBeEmpty();
    }

    [Fact]
    public void WhenAClosePredatesTheRequestedRange_ShouldLeaveItOut()
    {
        var result = Result(closes: [99d, 100d], days: ["2025-12-31", "2026-10-07"]);

        Parse("AAPL", result, From, To).Bars.ShouldHaveSingleItem().Close.ShouldBe(100m);
    }

    [Fact]
    public void WhenAnswerHasAnEmptyQuoteList_ShouldReturnNoBars()
    {
        var result = new ChartResult
        {
            Meta = new ChartMeta { Currency = "CAD" },
            Timestamp = [Unix("2026-10-07")],
            Indicators = new ChartIndicators { Quote = [] },
        };

        Parse("X", result, From, To).Bars.ShouldBeEmpty();
    }

    [Fact]
    public void WhenLiveQuoteIsNewerThanTheLastBar_ShouldAddTodayFromIt()
    {
        var result = Result(meta: m => { m.RegularMarketPrice = 103.5; m.RegularMarketTime = Unix("2026-10-09"); });

        Parse("AAPL", result, From, To).Bars.Select(b => (b.Date.Day, b.Close)).ShouldBe([(7, 100m), (8, 101m), (9, 103.5m)]);
    }

    [Fact]
    public void WhenLiveQuoteIsOnTheLastBarsDay_ShouldReplaceThatClose()
    {
        var result = Result(meta: m => { m.RegularMarketPrice = 102.25; m.RegularMarketTime = Unix("2026-10-08", 20); });

        Parse("AAPL", result, From, To).Bars.Select(b => b.Close).ShouldBe([100m, 102.25m]);
    }

    [Fact]
    public void WhenLiveQuoteIsOlderThanTheLastBar_ShouldIgnoreIt()
    {
        var result = Result(meta: m => { m.RegularMarketPrice = 90; m.RegularMarketTime = Unix("2026-10-06"); });

        Parse("AAPL", result, From, To).Bars.Select(b => b.Close).ShouldBe([100m, 101m]);
    }

    [Fact]
    public void WhenThereAreNoBarsYet_ShouldTakeTheLiveQuoteAsTheOnlyBar()
    {
        var result = new ChartResult
        {
            Meta = new ChartMeta { Currency = "USD", RegularMarketPrice = 50, RegularMarketTime = Unix("2026-10-08") },
        };

        Parse("AAPL", result, From, To).Bars.ShouldHaveSingleItem().Close.ShouldBe(50m);
    }

    [Fact]
    public void WhenLiveQuoteIsNotPositiveOrOutsideTheRange_ShouldIgnoreIt()
    {
        Parse("AAPL", Result(meta: m => { m.RegularMarketPrice = 0; m.RegularMarketTime = Unix("2026-10-09"); }), From, To)
            .Bars.Count.ShouldBe(2);
        Parse("AAPL", Result(meta: m => { m.RegularMarketPrice = 120; m.RegularMarketTime = Unix("2027-03-09"); }), From, To)
            .Bars.Count.ShouldBe(2);
        Parse("AAPL", Result(meta: m => m.RegularMarketPrice = 120), From, To).Bars.Count.ShouldBe(2);
    }

    [Fact]
    public void WhenDividendsShareADay_ShouldSumThemAndSkipInvalidOnes()
    {
        var result = Result();
        result.Events = new ChartEvents
        {
            Dividends = new()
            {
                ["a"] = new YahooDividend { Date = Unix("2026-10-08"), Amount = 0.25 },
                ["b"] = new YahooDividend { Date = Unix("2026-10-08"), Amount = 0.5 },
                ["c"] = new YahooDividend { Date = Unix("2026-10-01"), Amount = 0.1 },
                ["d"] = new YahooDividend { Date = Unix("2026-10-02"), Amount = 0 },
            },
        };

        Parse("AAPL", result, From, To).Dividends.Select(d => (d.Date.Day, d.Amount)).ShouldBe([(1, 0.1m), (8, 0.75m)]);
    }

    [Fact]
    public void WhenSplitsAreInvalid_ShouldSkipThemAndOrderTheRest()
    {
        var result = Result();
        result.Events = new ChartEvents
        {
            Splits = new()
            {
                ["late"] = new YahooSplit { Date = Unix("2026-10-08"), Numerator = 3, Denominator = 1 },
                ["early"] = new YahooSplit { Date = Unix("2026-10-01"), Numerator = 2, Denominator = 1 },
                ["zero"] = new YahooSplit { Date = Unix("2026-10-03"), Numerator = 0, Denominator = 1 },
                ["none"] = new YahooSplit { Date = Unix("2026-10-04"), Numerator = 1, Denominator = 0 },
            },
        };

        Parse("AAPL", result, From, To).Splits.Select(s => (s.Date.Day, s.Numerator, s.Denominator)).ShouldBe([(1, 2m, 1m), (8, 3m, 1m)]);
    }

    [Fact]
    public void WhenSymbolInMetadataDiffers_ShouldUseTheProvidersSymbolAndShortName()
    {
        var result = Result(meta: m => { m.Symbol = "brk-b"; m.LongName = null; m.ShortName = "Berkshire &amp; Hathaway "; });

        var info = Parse("BRK.B", result, From, To).Info;

        info.Symbol.ShouldBe("BRK-B");
        info.Name.ShouldBe("Berkshire & Hathaway");
    }

    [Fact]
    public void WhenMetadataHasNoSymbol_ShouldUseTheRequestedOne()
    {
        var result = Result(meta: m => { m.Symbol = null; m.LongName = null; m.ShortName = null; });

        var info = Parse("aapl", result, From, To).Info;

        info.Symbol.ShouldBe("AAPL");
        info.Name.ShouldBe("AAPL");
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData("", null)]
    [InlineData("GBp", "GBP")]
    [InlineData("GBX", "GBP")]
    [InlineData("ZAc", "ZAR")]
    [InlineData("ZAC", "ZAR")]
    [InlineData("ILA", "ILS")]
    [InlineData("usd", "USD")]
    public void WhenCurrencyIsNormalized_ShouldMapMinorUnitsToTheirMajorCurrency(string? raw, string? expected) =>
        NormalizeCurrency(raw)?.Currency.ShouldBe(expected);

    [Theory]
    [InlineData("GBp", 100)]
    [InlineData("ZAC", 100)]
    [InlineData("ILA", 100)]
    [InlineData("USD", 1)]
    public void WhenCurrencyIsNormalized_ShouldDivideMinorUnitsByOneHundred(string raw, int divisor) =>
        NormalizeCurrency(raw)!.Value.Divisor.ShouldBe(divisor);

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void WhenCurrencyIsEmpty_ShouldNormalizeToNothing(string? raw) => NormalizeCurrency(raw).ShouldBeNull();

    [Theory]
    [InlineData(0d)]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(double.NegativeInfinity)]
    public void WhenPriceIsNotAUsableNumber_ShouldRoundToZero(double raw) => RoundPrice(raw).ShouldBe(0m);

    [Fact]
    public void WhenPriceIsHuge_ShouldNotRoundAwayTheWholePart() => RoundPrice(123456789.0).ShouldBe(123456789m);
}
