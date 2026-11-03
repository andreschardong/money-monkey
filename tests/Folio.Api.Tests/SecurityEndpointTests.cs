using System.Net;
using Folio.Api.Data;
using Folio.Api.Endpoints;
using Folio.Api.MarketData;
using Folio.Core;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Folio.Api.Tests;

[Collection(FolioApiCollection.Name)]
public class SecurityEndpointTests(FolioApiFactory factory)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static DateOnly Today => ApiClient.Today;

    private static ManualSecurityRequest Manual(string symbol = "GIC-1", string name = "A GIC", string currency = "CAD", decimal? price = 1m, DateOnly? date = null) =>
        new(symbol, name, currency, AssetType.Other, price, date);

    private static Task<HttpResponseMessage> CreateManual(HttpClient client, ManualSecurityRequest request) => client.PostJsonAsync("/api/securities/manual", request);

    [Fact]
    public async Task WhenASecurityIsUnusedOrTradedByMe_ShouldBeListedBySymbolButNotWhenOnlySomeoneElseTradesIt()
    {
        var (me, _) = await factory.NewAccountAsync();
        var (other, _) = await factory.NewAccountAsync();
        var unused = await factory.SeedSecurityAsync(symbol: $"A{Guid.NewGuid():N}"[..10]);
        var traded = await factory.SeedSecurityAsync(symbol: $"B{Guid.NewGuid():N}"[..10]);
        var otherPortfolio = await other.CreatePortfolioAsync("Theirs");
        await other.AddAsync(otherPortfolio, new TransactionRequest(TransactionType.Buy, new DateOnly(2026, 2, 2), SecurityId: traded.Id, Quantity: 1, Price: 1m));

        var mine = await me.GetJsonAsync<List<SecurityDto>>("/api/securities");
        mine.Select(s => s.Id).ShouldContain(unused.Id);
        mine.Select(s => s.Id).ShouldNotContain(traded.Id);

        var myPortfolio = await me.CreatePortfolioAsync("Mine");
        await me.AddAsync(myPortfolio, new TransactionRequest(TransactionType.Buy, new DateOnly(2026, 2, 2), SecurityId: traded.Id, Quantity: 1, Price: 1m));
        var afterBuying = await me.GetJsonAsync<List<SecurityDto>>("/api/securities");
        afterBuying.Single(s => s.Id == traded.Id).InUse.ShouldBeTrue();
        afterBuying.Single(s => s.Id == unused.Id).InUse.ShouldBeFalse();
        afterBuying.FindIndex(s => s.Id == unused.Id).ShouldBeLessThan(afterBuying.FindIndex(s => s.Id == traded.Id));
    }

    [Fact]
    public async Task WhenManualSecuritiesBelongToAnotherAccount_ShouldNotShowThemInTheList()
    {
        var (owner, _) = await factory.NewAccountAsync();
        var (stranger, _) = await factory.NewAccountAsync();
        var gic = await (await CreateManual(owner, Manual($"GIC-{Guid.NewGuid():N}"[..12]))).ReadAsync<SecurityDto>();

        (await owner.GetJsonAsync<List<SecurityDto>>("/api/securities")).Select(s => s.Id).ShouldContain(gic.Id);
        (await stranger.GetJsonAsync<List<SecurityDto>>("/api/securities")).Select(s => s.Id).ShouldNotContain(gic.Id);
        (await stranger.GetResponseAsync($"/api/securities/{gic.Id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await stranger.GetResponseAsync($"/api/securities/{gic.Id}/prices")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await stranger.GetResponseAsync($"/api/securities/{gic.Id}/actions")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await stranger.GetResponseAsync($"/api/securities/{gic.Id}/price-on?date=2026-10-01")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await stranger.PostJsonAsync($"/api/securities/{gic.Id}/prices", new ManualPriceRequest(Today, 2m))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task WhenTheSearchTextIsBlank_ShouldReturnNothingWithoutCallingTheProvider(string? q)
    {
        var (client, _) = await factory.NewAccountAsync();
        factory.Quotes.SearchFailure = new InvalidOperationException("must not be called");
        try
        {
            var url = q is null ? "/api/securities/search" : $"/api/securities/search?q={Uri.EscapeDataString(q)}";

            (await client.GetJsonAsync<List<SymbolMatchDto>>(url)).ShouldBeEmpty();
        }
        finally
        {
            factory.Quotes.SearchFailure = null;
        }
    }

    [Fact]
    public async Task WhenSearching_ShouldListMyManualMatchesFirstAndMarkKnownQuotedSymbols()
    {
        var (client, _) = await factory.NewAccountAsync();
        var apple = await client.ResolveAsync("AAPL");
        var manual = await (await CreateManual(client, Manual("MYAPPLE-NOTE", "Apple orchard share"))).ReadAsync<SecurityDto>();

        var results = await client.GetJsonAsync<List<SymbolMatchDto>>("/api/securities/search?q=apple");

        results.First().ShouldBe(new SymbolMatchDto("MYAPPLE-NOTE", "Apple orchard share", "Manual price", AssetType.Other, manual.Id));
        results.Single(r => r.Symbol == "AAPL").ShouldBe(new SymbolMatchDto("AAPL", "Apple Inc.", "NASDAQ", AssetType.Stock, apple.Id));
    }

    [Fact]
    public async Task WhenAQuotedMatchHasNoStoredSecurity_ShouldCarryNoId()
    {
        var (client, _) = await factory.NewAccountAsync();

        var results = await client.GetJsonAsync<List<SymbolMatchDto>>("/api/securities/search?q=Alias%20Destination");

        results.ShouldHaveSingleItem().SecurityId.ShouldBeNull();
    }

    [Fact]
    public async Task WhenMyManualSecuritySharesACodeWithAQuotedOne_ShouldPointTheSearchAtTheQuotedOne()
    {
        var (client, email) = await factory.NewAccountAsync();
        var apple = await client.ResolveAsync("AAPL");
        var me = await factory.WithDbAsync(db => db.Users.Where(u => u.Email == email).Select(u => u.Id).SingleAsync(Ct));
        await factory.SeedSecurityAsync(ownerId: me, symbol: "AAPL");

        var results = await client.GetJsonAsync<List<SymbolMatchDto>>("/api/securities/search?q=AAPL");

        results.Where(r => r.Exchange == "NASDAQ").ShouldHaveSingleItem().SecurityId.ShouldBe(apple.Id);
    }

    [Fact]
    public async Task WhenOnlyMyManualSecurityHasThatCode_ShouldPointTheSearchAtIt()
    {
        var (client, email) = await factory.NewAccountAsync();
        var me = await factory.WithDbAsync(db => db.Users.Where(u => u.Email == email).Select(u => u.Id).SingleAsync(Ct));
        var mine = await factory.SeedSecurityAsync(ownerId: me, symbol: "ODDCUR");

        var results = await client.GetJsonAsync<List<SymbolMatchDto>>("/api/securities/search?q=oddcur");

        results.Single(r => r.Exchange == "NYSE").SecurityId.ShouldBe(mine.Id);
    }

    [Fact]
    public async Task WhenTheSearchProviderIsDown_ShouldStillShowMyManualMatchesOrReportTheOutage()
    {
        var (client, _) = await factory.NewAccountAsync();
        await CreateManual(client, Manual("OUTAGE-GIC", "Outage note")).ReadAsync<SecurityDto>();
        factory.Quotes.SearchFailure = new HttpRequestException("down");
        try
        {
            var local = await client.GetJsonAsync<List<SymbolMatchDto>>("/api/securities/search?q=outage");
            local.ShouldHaveSingleItem().Exchange.ShouldBe("Manual price");

            var none = await client.GetResponseAsync("/api/securities/search?q=nothing-matches-this");
            await none.ShouldBeProblemAsync(HttpStatusCode.BadGateway, "Symbol search is unavailable right now.");
        }
        finally
        {
            factory.Quotes.SearchFailure = null;
        }
    }

    [Fact]
    public async Task WhenResolvingBlankSymbol_ShouldAskForOne()
    {
        var (client, _) = await factory.NewAccountAsync();

        await (await client.PostJsonAsync("/api/securities", new ResolveSecurityRequest("  ", null))).ShouldBeProblemAsync(HttpStatusCode.BadRequest, "Enter a symbol.");
    }

    [Fact]
    public async Task WhenResolvingAQuotedSymbol_ShouldStoreItWithItsDetailsAndLatestPrice()
    {
        var (client, _) = await factory.NewAccountAsync();

        var security = await client.ResolveAsync(" shop.to ");

        (security.Symbol, security.Name, security.Currency, security.Exchange, security.AssetType, security.PriceSource)
            .ShouldBe(("SHOP.TO", "Shopify Inc.", "CAD", "TSX", AssetType.Stock, PriceSource.Yahoo));
        security.LastPrice.ShouldBe(101m);
        security.LastPriceDate.ShouldBe(Today);
        security.DayChangePercent.ShouldBe(0.01m);
        security.LastRefreshError.ShouldBeNull();
        (await client.ResolveAsync("SHOP.TO")).Id.ShouldBe(security.Id);
    }

    [Fact]
    public async Task WhenTheProviderDoesNotKnowTheSymbol_ShouldAnswerNotFoundWithAMessage()
    {
        var (client, _) = await factory.NewAccountAsync();

        var response = await client.PostJsonAsync("/api/securities", new ResolveSecurityRequest("NOPE", null));

        await response.ShouldBeProblemAsync(HttpStatusCode.NotFound, "No quotes were found for \"NOPE\"");
    }

    [Fact]
    public async Task WhenTheSecurityTradesInACurrencyWeCannotConvert_ShouldAnswerBadGatewayAndStoreNothing()
    {
        var (client, _) = await factory.NewAccountAsync();

        var response = await client.PostJsonAsync("/api/securities", new ResolveSecurityRequest("ODDCUR", null));

        response.StatusCode.ShouldBe(HttpStatusCode.BadGateway);
        (await factory.WithDbAsync(db => db.Securities.IgnoreQueryFilters().CountAsync(s => s.OwnerId == null && s.Symbol == "ODDCUR", Ct))).ShouldBe(0);
    }

    [Fact]
    public async Task WhenTheProviderReportsAnotherCanonicalSymbol_ShouldStoreItUnderThatSymbolAndReuseIt()
    {
        var (client, _) = await factory.NewAccountAsync();

        var first = await client.ResolveAsync("aliassrc");
        var second = await client.ResolveAsync("ALIASSRC");

        first.Symbol.ShouldBe("ALIASDST");
        second.Id.ShouldBe(first.Id);
        (await factory.WithDbAsync(db => db.Securities.IgnoreQueryFilters().CountAsync(s => s.Symbol == "ALIASSRC", Ct))).ShouldBe(0);
    }

    [Fact]
    public async Task WhenAnotherRequestStoresTheSameSymbolFirst_ShouldReturnTheStoredSecurity()
    {
        var (client, _) = await factory.NewAccountAsync();
        Guid rival = default;
        factory.Quotes.BeforeHistory = async symbol =>
        {
            if (symbol != "RACEX" || rival != default)
                return;
            rival = Guid.CreateVersion7();
            await factory.WithDbAsync(async db =>
            {
                db.Securities.Add(new Security
                {
                    Id = rival, Symbol = "RACEX", Name = "Stored first", Currency = "CAD", PriceSource = PriceSource.Yahoo,
                    CreatedAt = factory.Time.GetUtcNow(),
                });
                await db.SaveChangesAsync(Ct);
            });
        };
        try
        {
            var security = await client.ResolveAsync("RACEX");

            security.Id.ShouldBe(rival);
            security.Name.ShouldBe("Stored first");
        }
        finally
        {
            factory.Quotes.BeforeHistory = null;
        }
    }

    [Fact]
    public async Task WhenALongerHistoryIsAskedFor_ShouldFetchTheEarlierDaysOnce()
    {
        var (client, _) = await factory.NewAccountAsync();
        var security = await client.ResolveAsync("HISTX", new DateOnly(2026, 9, 1));
        var calls = 0;
        factory.Quotes.BeforeHistory = _ =>
        {
            calls++;
            return Task.CompletedTask;
        };
        try
        {
            await client.ResolveAsync("HISTX", new DateOnly(2026, 8, 3));
            await client.ResolveAsync("HISTX", new DateOnly(2026, 8, 20));
        }
        finally
        {
            factory.Quotes.BeforeHistory = null;
        }

        calls.ShouldBe(1);
        var start = await factory.WithDbAsync(db => db.Securities.IgnoreQueryFilters().Where(s => s.Id == security.Id).Select(s => s.HistoryStart).SingleAsync(Ct));
        start.ShouldBe(new DateOnly(2026, 7, 24));
    }

    [Fact]
    public async Task WhenTheProviderFailsWhileExtendingHistory_ShouldRecordTheErrorAndKeepGoing()
    {
        var (client, _) = await factory.NewAccountAsync();
        var security = await client.ResolveAsync("FAILX", new DateOnly(2026, 9, 1));
        factory.Quotes.Failures["FAILX"] = new HttpRequestException("history is down");
        try
        {
            var again = await client.ResolveAsync("FAILX", new DateOnly(2026, 1, 5));

            again.Id.ShouldBe(security.Id);
            again.LastRefreshError.ShouldBe("history is down");
        }
        finally
        {
            factory.Quotes.Failures.TryRemove("FAILX", out _);
        }

        await client.ResolveAsync("FAILX", new DateOnly(2026, 1, 5));
        (await client.GetJsonAsync<SecurityDto>($"/api/securities/{security.Id}")).LastRefreshError.ShouldBeNull();
    }

    [Fact]
    public async Task WhenCreatingAManualSecurity_ShouldStoreItWithItsFirstPrice()
    {
        var (client, _) = await factory.NewAccountAsync();

        var security = await (await CreateManual(client, Manual(" gic-9 ", " Nine year GIC ", "usd", 1.05m, new DateOnly(2026, 9, 1)))).ReadAsync<SecurityDto>();

        (security.Symbol, security.Name, security.Currency, security.PriceSource, security.LastPrice, security.LastPriceDate)
            .ShouldBe(("GIC-9", "Nine year GIC", "USD", PriceSource.Manual, 1.05m, new DateOnly(2026, 9, 1)));
    }

    [Fact]
    public async Task WhenManualSecurityHasNoPriceOrDate_ShouldHaveNoPriceYetAndUseTodayForALaterPrice()
    {
        var (client, _) = await factory.NewAccountAsync();

        var noPrice = await (await CreateManual(client, Manual("GIC-NONE", price: null))).ReadAsync<SecurityDto>();
        var today = await (await CreateManual(client, Manual("GIC-TODAY", price: 2m, date: null))).ReadAsync<SecurityDto>();

        noPrice.LastPrice.ShouldBeNull();
        today.LastPriceDate.ShouldBe(Today);
    }

    public static TheoryData<string?, string?, string?, decimal?, string> InvalidManual => new()
    {
        { "", "Name", "CAD", 1m, "Enter a short symbol of up to 32 characters." },
        { null, "Name", "CAD", 1m, "Enter a short symbol of up to 32 characters." },
        { "012345678901234567890123456789012", "Name", "CAD", 1m, "Enter a short symbol of up to 32 characters." },
        { "OK", "", "CAD", 1m, "Enter a name of up to 200 characters." },
        { "OK", "   ", "CAD", 1m, "Enter a name of up to 200 characters." },
        { "OK", null, "CAD", 1m, "Enter a name of up to 200 characters." },
        { "OK", new string('x', 201), "CAD", 1m, "Enter a name of up to 200 characters." },
        { "OK", "Name", "XXX", 1m, "Unsupported currency XXX." },
        { "OK", "Name", null, 1m, "Unsupported currency ." },
        { "OK", "Name", "CAD", 0m, "The price must be greater than zero." },
        { "OK", "Name", "CAD", -1m, "The price must be greater than zero." },
    };

    [Theory]
    [MemberData(nameof(InvalidManual))]
    public async Task WhenAManualSecurityBreaksARule_ShouldRefuseItWithTheReason(string? symbol, string? name, string? currency, decimal? price, string expected)
    {
        var (client, _) = await factory.NewAccountAsync();

        var response = await client.PostJsonAsync("/api/securities/manual",
            new { symbol, name, currency, assetType = "Other", price, date = (string?)null });

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, expected);
    }

    [Fact]
    public async Task WhenTheCodeIsAlreadyMineOrQuoted_ShouldAnswerConflict()
    {
        var (client, _) = await factory.NewAccountAsync();
        await CreateManual(client, Manual("DUP-1")).ReadAsync<SecurityDto>();
        await client.ResolveAsync("SHOP.TO");

        await (await CreateManual(client, Manual("dup-1"))).ShouldBeProblemAsync(HttpStatusCode.Conflict, "A security with the symbol DUP-1 already exists.");
        await (await CreateManual(client, Manual("Shop.To"))).ShouldBeProblemAsync(HttpStatusCode.Conflict, "SHOP.TO already exists");
    }

    [Fact]
    public async Task WhenTwoAccountsUseTheSameManualCode_ShouldKeepThemApart()
    {
        var (first, _) = await factory.NewAccountAsync();
        var (second, _) = await factory.NewAccountAsync();

        var a = await (await CreateManual(first, Manual("SAMECODE", price: 1m))).ReadAsync<SecurityDto>();
        var b = await (await CreateManual(second, Manual("SAMECODE", price: 5m))).ReadAsync<SecurityDto>();

        a.Id.ShouldNotBe(b.Id);
        (await first.GetJsonAsync<SecurityDto>($"/api/securities/{a.Id}")).LastPrice.ShouldBe(1m);
        (await second.GetJsonAsync<SecurityDto>($"/api/securities/{b.Id}")).LastPrice.ShouldBe(5m);
    }

    [Fact]
    public async Task WhenAskingForOneSecurity_ShouldFindItOrNot()
    {
        var (client, _) = await factory.NewAccountAsync();
        var security = await client.ResolveAsync("AAPL");

        (await client.GetJsonAsync<SecurityDto>($"/api/securities/{security.Id}")).Symbol.ShouldBe("AAPL");
        (await client.GetResponseAsync($"/api/securities/{Guid.NewGuid()}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await client.GetResponseAsync($"/api/securities/{Guid.NewGuid()}/prices")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await client.GetResponseAsync($"/api/securities/{Guid.NewGuid()}/actions")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await client.GetResponseAsync($"/api/securities/{Guid.NewGuid()}/price-on?date=2026-10-01")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await client.PostJsonAsync($"/api/securities/{Guid.NewGuid()}/prices", new ManualPriceRequest(Today, 1m))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Theory]
    [InlineData("1M", "2026-09-09")]
    [InlineData("3M", "2026-07-09")]
    [InlineData("6m", "2026-04-09")]
    [InlineData("YTD", "2026-01-01")]
    [InlineData(null, "2025-10-09")]
    [InlineData("odd", "2025-10-09")]
    [InlineData("3Y", "2023-10-09")]
    [InlineData("5Y", "2021-10-09")]
    public async Task WhenPricesAreAskedForARange_ShouldLoadAndReturnThemOldestFirstThroughToday(string? range, string from)
    {
        var (client, _) = await factory.NewAccountAsync();
        var security = await client.ResolveAsync("SHOP.TO", new DateOnly(2026, 9, 25));
        var url = $"/api/securities/{security.Id}/prices" + (range is null ? string.Empty : $"?range={range}");

        var prices = await client.GetJsonAsync<List<PricePointDto>>(url);

        var start = DateOnly.Parse(from);
        prices.First().Date.ShouldBeInRange(start, start.AddDays(2));
        prices.Last().ShouldBe(new PricePointDto(Today, 101m));
        prices.Select(p => p.Date).ShouldBe(prices.Select(p => p.Date).Order());
    }

    [Fact]
    public async Task WhenAllPricesAreAskedForWithTradesOrWithout_ShouldStartAtMyFirstTradeOrAYearAgo()
    {
        var (client, _) = await factory.NewAccountAsync();
        var security = await client.ResolveAsync("SHOP.TO", new DateOnly(2026, 9, 25));
        var url = $"/api/securities/{security.Id}/prices?range=ALL";

        (await client.GetJsonAsync<List<PricePointDto>>(url)).First().Date.ShouldBe(new DateOnly(2025, 10, 9));

        var portfolio = await client.CreatePortfolioAsync("All");
        await client.BuyAsync(portfolio, "SHOP.TO", 1, 90m, "2026-03-02");
        (await client.GetJsonAsync<List<PricePointDto>>(url)).First().Date.ShouldBe(new DateOnly(2026, 3, 2));
    }

    [Fact]
    public async Task WhenSettingAManualPrice_ShouldStoreItAndReplaceTheSameDay()
    {
        var (client, _) = await factory.NewAccountAsync();
        var gic = await (await CreateManual(client, Manual("GIC-PRICE", price: 1m, date: new DateOnly(2026, 9, 1)))).ReadAsync<SecurityDto>();
        var url = $"/api/securities/{gic.Id}/prices";

        (await client.PostJsonAsync(url, new ManualPriceRequest(new DateOnly(2026, 10, 1), 1.02m))).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await client.PostJsonAsync(url, new ManualPriceRequest(new DateOnly(2026, 10, 1), 1.03m))).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        (await client.GetJsonAsync<List<PricePointDto>>($"{url}?range=3M")).ShouldBe(
            [new PricePointDto(new DateOnly(2026, 9, 1), 1m), new PricePointDto(new DateOnly(2026, 10, 1), 1.03m)]);
    }

    [Fact]
    public async Task WhenAManualPriceIsInvalidOrNotAllowed_ShouldRefuseIt()
    {
        var (client, _) = await factory.NewAccountAsync();
        var gic = await (await CreateManual(client, Manual("GIC-RULES"))).ReadAsync<SecurityDto>();
        var quoted = await client.ResolveAsync("SHOP.TO");

        await (await client.PostJsonAsync($"/api/securities/{gic.Id}/prices", new ManualPriceRequest(Today, 0m)))
            .ShouldBeProblemAsync(HttpStatusCode.BadRequest, "The price must be greater than zero.");
        await (await client.PostJsonAsync($"/api/securities/{gic.Id}/prices", new ManualPriceRequest(Today.AddDays(1), 1m)))
            .ShouldBeProblemAsync(HttpStatusCode.BadRequest, "The date cannot be in the future.");
        await (await client.PostJsonAsync($"/api/securities/{quoted.Id}/prices", new ManualPriceRequest(Today, 1m)))
            .ShouldBeProblemAsync(HttpStatusCode.BadRequest, "SHOP.TO is priced automatically");
    }

    [Fact]
    public async Task WhenAskingWhatAPriceWasOnADate_ShouldReturnTheLatestCloseOnOrBeforeIt()
    {
        var (client, _) = await factory.NewAccountAsync();
        var gic = await (await CreateManual(client, Manual("GIC-ON", price: 1m, date: new DateOnly(2026, 9, 1)))).ReadAsync<SecurityDto>();
        await client.PostJsonAsync($"/api/securities/{gic.Id}/prices", new ManualPriceRequest(new DateOnly(2026, 9, 15), 1.5m));

        var between = await client.GetJsonAsync<PriceOnDto>($"/api/securities/{gic.Id}/price-on?date=2026-09-20");
        var before = await client.GetJsonAsync<PriceOnDto>($"/api/securities/{gic.Id}/price-on?date=2026-08-01");

        between.ShouldBe(new PriceOnDto(gic.Id, new DateOnly(2026, 9, 20), new DateOnly(2026, 9, 15), 1.5m));
        before.ShouldBe(new PriceOnDto(gic.Id, new DateOnly(2026, 8, 1), null, null));
    }

    [Fact]
    public async Task WhenAskingForAPriceBeforeTheLoadedHistory_ShouldLoadItFirst()
    {
        var (client, _) = await factory.NewAccountAsync();
        var security = await client.ResolveAsync("PRICEX", new DateOnly(2026, 9, 25));

        var answer = await client.GetJsonAsync<PriceOnDto>($"/api/securities/{security.Id}/price-on?date=2026-03-04");

        (answer.Date, answer.Close).ShouldBe((new DateOnly(2026, 3, 4), 100m));
    }

    [Fact]
    public async Task WhenListingCorporateActions_ShouldReturnThemNewestFirst()
    {
        var (client, _) = await factory.NewAccountAsync();
        var security = await factory.SeedSecurityAsync();
        await factory.SeedActionAsync(security.Id, new DateOnly(2026, 3, 1), CorporateActionKind.Split, numerator: 3, denominator: 1);
        await factory.SeedActionAsync(security.Id, new DateOnly(2026, 5, 1), CorporateActionKind.Dividend, amount: 0.25m);

        var actions = await client.GetJsonAsync<List<CorporateActionDto>>($"/api/securities/{security.Id}/actions");

        actions.ShouldBe(
        [
            new CorporateActionDto(new DateOnly(2026, 5, 1), CorporateActionKind.Dividend, 0m, 0m, 0.25m),
            new CorporateActionDto(new DateOnly(2026, 3, 1), CorporateActionKind.Split, 3m, 1m, 0m),
        ]);
    }

    [Fact]
    public async Task WhenQuotesAreStoredForASecurity_ShouldShowTheLatestCloseAndTheMoveFromTheOneBefore()
    {
        var (client, _) = await factory.NewAccountAsync();
        var none = await factory.SeedSecurityAsync();
        var single = await factory.SeedSecurityAsync();
        var moving = await factory.SeedSecurityAsync();
        var stale = await factory.SeedSecurityAsync();
        var split = await factory.SeedSecurityAsync();
        var zero = await factory.SeedSecurityAsync();
        await factory.SeedPricesAsync(single.Id, (new DateOnly(2026, 10, 8), 10m));
        await factory.SeedPricesAsync(moving.Id, (new DateOnly(2026, 10, 7), 100m), (new DateOnly(2026, 10, 8), 110m));
        await factory.SeedPricesAsync(stale.Id, (new DateOnly(2026, 9, 1), 100m), (new DateOnly(2026, 9, 2), 90m));
        await factory.SeedPricesAsync(split.Id, (new DateOnly(2026, 10, 7), 100m), (new DateOnly(2026, 10, 8), 50m));
        await factory.SeedActionAsync(split.Id, new DateOnly(2026, 10, 8), CorporateActionKind.Split, numerator: 2, denominator: 1);
        await factory.SeedPricesAsync(zero.Id, (new DateOnly(2026, 10, 7), 0m), (new DateOnly(2026, 10, 8), 5m));

        async Task<(decimal? Last, decimal? Previous, decimal? Change)> Quote(Security s)
        {
            var dto = await client.GetJsonAsync<SecurityDto>($"/api/securities/{s.Id}");
            return (dto.LastPrice, dto.PreviousClose, dto.DayChangePercent);
        }

        static (decimal? Last, decimal? Previous, decimal? Change) Expect(decimal? last, decimal? previous, decimal? change) => (last, previous, change);

        (await Quote(none)).ShouldBe(Expect(null, null, null));
        (await Quote(single)).ShouldBe(Expect(10m, null, null));
        (await Quote(moving)).ShouldBe(Expect(110m, 100m, 0.1m));
        (await Quote(stale)).ShouldBe(Expect(90m, 100m, null));
        (await Quote(split)).ShouldBe(Expect(50m, 50m, 0m));
        (await Quote(zero)).ShouldBe(Expect(5m, 0m, null));
    }

    [Fact]
    public async Task WhenAServiceCreatesAManualSecurityWithoutAnAccount_ShouldRefuse()
    {
        var (client, _) = await factory.NewAccountAsync();
        await client.ResolveAsync("SHOP.TO");
        using var scope = factory.Services.CreateScope();
        var market = scope.ServiceProvider.GetRequiredService<MarketDataService>();

        var ex = await Should.ThrowAsync<InvalidOperationException>(() => market.CreateManualAsync($"NOUSER{Guid.NewGuid():N}"[..12], "No user", "CAD", AssetType.Other, Ct));

        ex.Message.ShouldBe("Sign in to add a security.");
        var duplicate = await Should.ThrowAsync<InvalidOperationException>(() => market.CreateManualAsync("shop.to", "Dup", "CAD", AssetType.Other, Ct));
        duplicate.Message.ShouldBe("A security with the symbol SHOP.TO already exists.");
    }
}
