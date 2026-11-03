using System.Net;
using Folio.Api.Data;
using Folio.Api.Endpoints;
using Folio.Core;
using Microsoft.EntityFrameworkCore;

namespace Folio.Api.Tests;

[Collection(FolioApiCollection.Name)]
public class PortfolioEndpointTests(FolioApiFactory factory)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private Task<(HttpClient Client, string Email)> NewAccountAsync() => factory.NewAccountAsync();

    private static Task<HttpResponseMessage> CreateRaw(HttpClient client, object body) => client.PostJsonAsync("/api/portfolios", body);

    [Fact]
    public async Task WhenDetailsAreMessyButValid_ShouldCreateTheNormalizedPortfolioAndListIt()
    {
        var (client, _) = await NewAccountAsync();

        var response = await client.PostJsonAsync("/api/portfolios",
            new CreatePortfolioRequest("  RRSP  ", "usd", "  Retirement  ", " ca ", PortfolioKind.RealEstate));

        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        var created = await response.ReadAsync<PortfolioSummaryDto>();
        response.Headers.Location!.ToString().ShouldBe($"/api/portfolios/{created.Id}");
        created.Name.ShouldBe("RRSP");
        created.BaseCurrency.ShouldBe("USD");
        created.Description.ShouldBe("Retirement");
        created.Country.ShouldBe("CA");
        created.Kind.ShouldBe(PortfolioKind.RealEstate);
        created.Access.ShouldBe("Owner");
        created.TotalValue.ShouldBe(0m);
        (await client.GetJsonAsync<List<PortfolioSummaryDto>>("/api/portfolios")).Select(p => p.Id).ShouldBe([created.Id]);
    }

    [Fact]
    public async Task WhenDescriptionAndCountryAreBlank_ShouldStoreThemAsNothing()
    {
        var (client, _) = await NewAccountAsync();

        var created = await (await client.PostJsonAsync("/api/portfolios", new CreatePortfolioRequest("Blank", "CAD", "   ", "  "))).ReadAsync<PortfolioSummaryDto>();

        created.Description.ShouldBeNull();
        created.Country.ShouldBeNull();
        created.Kind.ShouldBe(PortfolioKind.Investment);
    }

    [Theory]
    [InlineData("", "CAD", "Give the portfolio a name of up to 100 characters.")]
    [InlineData("   ", "CAD", "Give the portfolio a name of up to 100 characters.")]
    [InlineData("GBP account", "GBP", "The portfolio currency must be CAD, USD or EUR.")]
    [InlineData("No currency", "", "The portfolio currency must be CAD, USD or EUR.")]
    public async Task WhenNameOrCurrencyIsWrong_ShouldRefuseWithTheReason(string name, string currency, string expected)
    {
        var (client, _) = await NewAccountAsync();

        var response = await client.PostJsonAsync("/api/portfolios", new CreatePortfolioRequest(name, currency, null));

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, expected);
    }

    [Fact]
    public async Task WhenNameIsTooLong_ShouldRefuseIt()
    {
        var (client, _) = await NewAccountAsync();

        var response = await client.PostJsonAsync("/api/portfolios", new CreatePortfolioRequest(new string('n', 101), "CAD", null));

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "up to 100 characters");
    }

    [Fact]
    public async Task WhenDescriptionIsTooLong_ShouldRefuseIt()
    {
        var (client, _) = await NewAccountAsync();

        var response = await client.PostJsonAsync("/api/portfolios", new CreatePortfolioRequest("Long", "CAD", new string('d', 501)));

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "limited to 500 characters");
    }

    [Theory]
    [InlineData("CAN")]
    [InlineData("C1")]
    [InlineData("é")]
    public async Task WhenCountryIsNotATwoLetterCode_ShouldRefuseIt(string country)
    {
        var (client, _) = await NewAccountAsync();

        var response = await client.PostJsonAsync("/api/portfolios", new CreatePortfolioRequest("Country", "CAD", null, country));

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "two-letter code");
    }

    [Fact]
    public async Task WhenAccountTypeIsUnknown_ShouldRefuseIt()
    {
        var (client, _) = await NewAccountAsync();

        var response = await CreateRaw(client, new { name = "Odd", baseCurrency = "CAD", kind = 99 });

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "Investment or RealEstate");
    }

    [Fact]
    public async Task WhenAnotherAccountAsksForAPortfolio_ShouldFindNothing()
    {
        var (owner, _) = await NewAccountAsync();
        var (stranger, _) = await NewAccountAsync();
        var id = await owner.CreatePortfolioAsync("Private");
        var security = await owner.ResolveAsync("SHOP.TO");

        foreach (var url in new[]
                 {
                     $"/api/portfolios/{id}", $"/api/portfolios/{id}/history", $"/api/portfolios/{id}/realized",
                     $"/api/portfolios/{id}/holdings/{security.Id}", $"/api/portfolios/{id}/suggestions", $"/api/portfolios/{id}/cash",
                     $"/api/portfolios/{id}/transactions",
                 })
        {
            (await stranger.GetResponseAsync(url)).StatusCode.ShouldBe(HttpStatusCode.NotFound, url);
        }

        (await stranger.GetJsonAsync<List<PortfolioSummaryDto>>("/api/portfolios")).ShouldBeEmpty();
        (await stranger.PutJsonAsync($"/api/portfolios/{id}", new UpdatePortfolioRequest("Mine", "CAD", null))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await stranger.DeleteResponseAsync($"/api/portfolios/{id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await stranger.PutJsonAsync($"/api/portfolios/{id}/cash", new SetCashRequest("CAD", 1m, null, null))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await stranger.DeleteResponseAsync($"/api/portfolios/{id}/cash/CAD/2026-10-09")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await stranger.PostJsonAsync($"/api/portfolios/{id}/suggestions/dismiss", new DismissSuggestionRequest(security.Id, Today, CorporateActionKind.Split)))
            .StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    private static DateOnly Today => ApiClient.Today;

    [Fact]
    public async Task WhenOwnerEditsThePortfolio_ShouldChangeItAndKeepTheRest()
    {
        var (owner, _) = await NewAccountAsync();
        var id = await owner.CreatePortfolioAsync("Old", "CAD", "CA");

        var updated = await (await owner.PutJsonAsync($"/api/portfolios/{id}",
            new UpdatePortfolioRequest(" New ", "eur", " Notes ", "us", PortfolioKind.RealEstate))).ReadAsync<PortfolioSummaryDto>();

        updated.Name.ShouldBe("New");
        updated.BaseCurrency.ShouldBe("EUR");
        updated.Description.ShouldBe("Notes");
        updated.Country.ShouldBe("US");
        updated.Kind.ShouldBe(PortfolioKind.RealEstate);

        var cleared = await (await owner.PutJsonAsync($"/api/portfolios/{id}", new UpdatePortfolioRequest("New", "EUR", " ", null))).ReadAsync<PortfolioSummaryDto>();
        cleared.Description.ShouldBeNull();
        cleared.Country.ShouldBeNull();
    }

    [Fact]
    public async Task WhenEditIsInvalid_ShouldRefuseAndChangeNothing()
    {
        var (owner, _) = await NewAccountAsync();
        var id = await owner.CreatePortfolioAsync("Keep");
        var url = $"/api/portfolios/{id}";

        (await owner.PutJsonAsync(url, new UpdatePortfolioRequest("", "CAD", null))).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        await (await owner.PutJsonAsync(url, new UpdatePortfolioRequest("Keep", "CAD", null, "CAN"))).ShouldBeProblemAsync(HttpStatusCode.BadRequest, "two-letter code");
        await (await owner.PutJsonAsync(url, new { name = "Keep", baseCurrency = "CAD", kind = 7 })).ShouldBeProblemAsync(HttpStatusCode.BadRequest, "Investment or RealEstate");
        (await owner.DetailAsync(id)).Summary.Name.ShouldBe("Keep");
    }

    [Fact]
    public async Task WhenTransactionsExist_ShouldNotAllowChangingTheCurrencyButAllowRenaming()
    {
        var (owner, _) = await NewAccountAsync();
        var id = await owner.CreatePortfolioAsync("Locked");
        await owner.DepositAsync(id, 100m);

        await (await owner.PutJsonAsync($"/api/portfolios/{id}", new UpdatePortfolioRequest("Locked", "USD", null)))
            .ShouldBeProblemAsync(HttpStatusCode.BadRequest, "currency cannot change");
        var renamed = await (await owner.PutJsonAsync($"/api/portfolios/{id}", new UpdatePortfolioRequest("Renamed", "cad", null))).ReadAsync<PortfolioSummaryDto>();
        renamed.Name.ShouldBe("Renamed");
        renamed.BaseCurrency.ShouldBe("CAD");
    }

    [Fact]
    public async Task WhenAnEditorOrViewerTriesToManageThePortfolio_ShouldBeForbidden()
    {
        var (owner, _) = await NewAccountAsync();
        var (editor, editorEmail) = await NewAccountAsync();
        var (viewer, viewerEmail) = await NewAccountAsync();
        var id = await owner.CreatePortfolioAsync("Shared");
        await owner.ShareWithAsync(id, editorEmail, canEdit: true);
        await owner.ShareWithAsync(id, viewerEmail, canEdit: false);

        foreach (var client in new[] { editor, viewer })
        {
            await (await client.PutJsonAsync($"/api/portfolios/{id}", new UpdatePortfolioRequest("Hijack", "CAD", null)))
                .ShouldBeProblemAsync(HttpStatusCode.Forbidden, "Only the portfolio's owner can rename it.");
            await (await client.DeleteResponseAsync($"/api/portfolios/{id}"))
                .ShouldBeProblemAsync(HttpStatusCode.Forbidden, "Only the portfolio's owner can delete it.");
        }

        (await owner.DetailAsync(id)).Summary.Name.ShouldBe("Shared");
    }

    [Fact]
    public async Task WhenOwnerDeletesThePortfolio_ShouldRemoveItWithItsTransactionsAndShares()
    {
        var (owner, _) = await NewAccountAsync();
        var (viewer, viewerEmail) = await NewAccountAsync();
        var id = await owner.CreatePortfolioAsync("Gone");
        await owner.DepositAsync(id, 50m);
        await owner.ShareWithAsync(id, viewerEmail, canEdit: false);

        (await owner.DeleteResponseAsync($"/api/portfolios/{id}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        (await owner.GetResponseAsync($"/api/portfolios/{id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await viewer.GetResponseAsync($"/api/portfolios/{id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await factory.WithDbAsync(db => db.Transactions.CountAsync(t => t.PortfolioId == id, Ct))).ShouldBe(0);
        (await factory.WithDbAsync(db => db.PortfolioShares.CountAsync(s => s.PortfolioId == id, Ct))).ShouldBe(0);
        (await owner.DeleteResponseAsync($"/api/portfolios/{id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Theory]
    [InlineData("1M", "2026-09-09")]
    [InlineData("3M", "2026-07-09")]
    [InlineData("6M", "2026-04-09")]
    [InlineData("YTD", "2026-01-05")]
    [InlineData("1Y", "2026-01-05")]
    [InlineData("3Y", "2026-01-05")]
    [InlineData("5Y", "2026-01-05")]
    [InlineData("ALL", "2026-01-05")]
    [InlineData("all", "2026-01-05")]
    [InlineData("nonsense", "2026-01-05")]
    [InlineData(null, "2026-01-05")]
    public async Task WhenHistoryIsRequestedForARange_ShouldStartAtTheRangeOrTheFirstActivity(string? range, string expectedStart)
    {
        var (client, _) = await NewAccountAsync();
        var id = await client.CreatePortfolioAsync("History");
        await client.DepositAsync(id, 1_000m, "2026-01-05");
        var url = $"/api/portfolios/{id}/history" + (range is null ? string.Empty : $"?range={range}");

        var history = await client.GetJsonAsync<HistoryDto>(url);

        history.Currency.ShouldBe("CAD");
        history.Range.ShouldBe(range is "nonsense" or null ? "1Y" : range.ToUpperInvariant());
        history.Points.First().Date.ShouldBe(DateOnly.Parse(expectedStart));
        history.Points.Last().Date.ShouldBe(Today);
        history.Points.ShouldAllBe(p => p.NetContributions == 1_000m && p.Value == 0m);
    }

    [Fact]
    public async Task WhenYearToDateStartsBeforeAnyActivity_ShouldStartAtTheFirstDeposit()
    {
        var (client, _) = await NewAccountAsync();
        var id = await client.CreatePortfolioAsync("Ytd");
        await client.DepositAsync(id, 10m, "2026-03-02");

        var history = await client.GetJsonAsync<HistoryDto>($"/api/portfolios/{id}/history?range=YTD");

        history.Points.First().Date.ShouldBe(new DateOnly(2026, 3, 2));
    }

    [Fact]
    public async Task WhenPortfolioIsEmpty_ShouldHaveNoHistory()
    {
        var (client, _) = await NewAccountAsync();
        var id = await client.CreatePortfolioAsync("Empty");

        var history = await client.GetJsonAsync<HistoryDto>($"/api/portfolios/{id}/history");

        history.Points.ShouldBeEmpty();
        history.Range.ShouldBe("1Y");
    }

    [Fact]
    public async Task WhenOnlyCashWasEntered_ShouldChartFromTheFirstCashBalance()
    {
        var (client, _) = await NewAccountAsync();
        var id = await client.CreatePortfolioAsync("Cash only");
        (await client.PutJsonAsync($"/api/portfolios/{id}/cash", new SetCashRequest("CAD", 750m, new DateOnly(2026, 3, 3), null))).EnsureSuccessStatusCode();

        var history = await client.GetJsonAsync<HistoryDto>($"/api/portfolios/{id}/history?range=ALL");

        history.Points.First().Date.ShouldBe(new DateOnly(2026, 3, 3));
        history.Points.ShouldAllBe(p => p.Value == 750m);
    }

    [Fact]
    public async Task WhenCashPredatesTheFirstTransaction_ShouldChartFromTheCash()
    {
        var (client, _) = await NewAccountAsync();
        var id = await client.CreatePortfolioAsync("Cash first");
        await client.DepositAsync(id, 100m, "2026-03-03");
        (await client.PutJsonAsync($"/api/portfolios/{id}/cash", new SetCashRequest("CAD", 5m, new DateOnly(2026, 2, 2), null))).EnsureSuccessStatusCode();

        var history = await client.GetJsonAsync<HistoryDto>($"/api/portfolios/{id}/history?range=ALL");

        history.Points.First().Date.ShouldBe(new DateOnly(2026, 2, 2));
    }

    [Fact]
    public async Task WhenCashComesAfterTheFirstTransaction_ShouldChartFromTheTransaction()
    {
        var (client, _) = await NewAccountAsync();
        var id = await client.CreatePortfolioAsync("Cash later");
        await client.DepositAsync(id, 100m, "2026-03-03");
        (await client.PutJsonAsync($"/api/portfolios/{id}/cash", new SetCashRequest("CAD", 5m, new DateOnly(2026, 4, 6), null))).EnsureSuccessStatusCode();

        var history = await client.GetJsonAsync<HistoryDto>($"/api/portfolios/{id}/history?range=ALL");

        history.Points.First().Date.ShouldBe(new DateOnly(2026, 3, 3));
    }

    [Fact]
    public async Task WhenSharesWereSoldAndIncomeReceived_ShouldReportEachYearsSalesAndIncome()
    {
        var (client, _) = await NewAccountAsync();
        var id = await client.CreatePortfolioAsync("Realized");
        await client.BuyAsync(id, "SHOP.TO", 10, 90m);
        await client.AddAsync(id, new TransactionRequest(TransactionType.Sell, new DateOnly(2026, 3, 2), Symbol: "SHOP.TO", Quantity: 4, Price: 100m));
        await client.AddAsync(id, new TransactionRequest(TransactionType.Dividend, new DateOnly(2026, 4, 1), Symbol: "SHOP.TO", Amount: 10m, Fee: 1m));
        await client.AddAsync(id, new TransactionRequest(TransactionType.Interest, new DateOnly(2025, 12, 1), Amount: 5m));

        var report = await client.GetJsonAsync<RealizedReportDto>($"/api/portfolios/{id}/realized");

        report.Currency.ShouldBe("CAD");
        var sale = report.Sales.ShouldHaveSingleItem();
        (sale.Symbol, sale.Quantity, sale.ProceedsLocal, sale.CostLocal, sale.GainLocal, sale.Gain).ShouldBe(("SHOP.TO", 4m, 400m, 360m, 40m, 40m));
        report.Years.Select(y => y.Year).ShouldBe([2026, 2025]);
        var y2026 = report.Years[0];
        (y2026.Proceeds, y2026.CostBasis, y2026.Gain, y2026.Dividends, y2026.Interest, y2026.TaxWithheld).ShouldBe((400m, 360m, 40m, 9m, 0m, 1m));
        var y2025 = report.Years[1];
        (y2025.Gain, y2025.Dividends, y2025.Interest).ShouldBe((0m, 0m, 5m));
    }

    [Fact]
    public async Task WhenSalesSpanSeveralDays_ShouldListTheNewestFirst()
    {
        var (client, _) = await NewAccountAsync();
        var id = await client.CreatePortfolioAsync("Order");
        await client.BuyAsync(id, "SHOP.TO", 10, 90m);
        await client.AddAsync(id, new TransactionRequest(TransactionType.Sell, new DateOnly(2026, 3, 2), Symbol: "SHOP.TO", Quantity: 1, Price: 100m));
        await client.AddAsync(id, new TransactionRequest(TransactionType.Sell, new DateOnly(2026, 5, 4), Symbol: "SHOP.TO", Quantity: 1, Price: 100m));

        var report = await client.GetJsonAsync<RealizedReportDto>($"/api/portfolios/{id}/realized");

        report.Sales.Select(s => s.Date).ShouldBe([new DateOnly(2026, 5, 4), new DateOnly(2026, 3, 2)]);
    }

    [Fact]
    public async Task WhenAHoldingIsOpen_ShouldDescribeItAndItsTransactionsNewestFirst()
    {
        var (client, _) = await NewAccountAsync();
        var id = await client.CreatePortfolioAsync("Holding");
        await client.BuyAsync(id, "SHOP.TO", 10, 90m);
        await client.BuyAsync(id, "SHOP.TO", 5, 95m, "2026-03-02");
        var security = await client.ResolveAsync("SHOP.TO");

        var detail = await client.GetJsonAsync<HoldingDetailDto>($"/api/portfolios/{id}/holdings/{security.Id}");

        detail.BaseCurrency.ShouldBe("CAD");
        detail.Security.Symbol.ShouldBe("SHOP.TO");
        detail.Security.InUse.ShouldBeTrue();
        detail.Holding.ShouldNotBeNull();
        (detail.Holding.Quantity, detail.Holding.CostBasis).ShouldBe((15m, 1375m));
        detail.Holding.Price.ShouldBe(101m);
        detail.Transactions.Select(t => t.Date).ShouldBe([new DateOnly(2026, 3, 2), new DateOnly(2026, 2, 2)]);
        detail.RealizedGain.ShouldBe(0m);
    }

    [Fact]
    public async Task WhenAHoldingWasSoldOut_ShouldKeepItsRealizedGainWithoutAnOpenHolding()
    {
        var (client, _) = await NewAccountAsync();
        var id = await client.CreatePortfolioAsync("Closed");
        await client.BuyAsync(id, "SHOP.TO", 10, 90m);
        await client.AddAsync(id, new TransactionRequest(TransactionType.Sell, new DateOnly(2026, 3, 2), Symbol: "SHOP.TO", Quantity: 10, Price: 100m));
        await client.AddAsync(id, new TransactionRequest(TransactionType.Dividend, new DateOnly(2026, 3, 3), Symbol: "SHOP.TO", Amount: 7m));
        var security = await client.ResolveAsync("SHOP.TO");

        var detail = await client.GetJsonAsync<HoldingDetailDto>($"/api/portfolios/{id}/holdings/{security.Id}");

        detail.Holding.ShouldBeNull();
        detail.RealizedGain.ShouldBe(100m);
        detail.Dividends.ShouldBe(7m);
        detail.Transactions.Count.ShouldBe(3);
    }

    [Fact]
    public async Task WhenTheSecurityIsNotInThePortfolio_ShouldFindNoHolding()
    {
        var (client, _) = await NewAccountAsync();
        var id = await client.CreatePortfolioAsync("Other");
        var security = await client.ResolveAsync("AAPL");

        (await client.GetResponseAsync($"/api/portfolios/{id}/holdings/{security.Id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task WhenASplitWasMissedOrAlreadyRecorded_ShouldSuggestItOnlyWhileMissing()
    {
        var (client, _) = await NewAccountAsync();
        var id = await client.CreatePortfolioAsync("Splits");
        var security = await factory.SeedSecurityAsync();
        await factory.SeedActionAsync(security.Id, new DateOnly(2026, 6, 1), CorporateActionKind.Split, numerator: 2, denominator: 1);
        await client.AddAsync(id, new TransactionRequest(TransactionType.Buy, new DateOnly(2026, 2, 2), SecurityId: security.Id, Quantity: 10, Price: 100m));
        var url = $"/api/portfolios/{id}/suggestions";

        var suggestion = (await client.GetJsonAsync<List<SuggestionDto>>(url)).ShouldHaveSingleItem();

        (suggestion.Kind, suggestion.Symbol, suggestion.Date, suggestion.SplitFrom, suggestion.SplitTo, suggestion.Quantity)
            .ShouldBe((CorporateActionKind.Split, security.Symbol, new DateOnly(2026, 6, 1), 1m, 2m, 10m));

        // Recorded within a few days of the ex-date: nothing left to suggest.
        await client.AddAsync(id, new TransactionRequest(TransactionType.Split, new DateOnly(2026, 6, 3), SecurityId: security.Id, SplitFrom: 1, SplitTo: 2));
        (await client.GetJsonAsync<List<SuggestionDto>>(url)).ShouldBeEmpty();
    }

    [Fact]
    public async Task WhenADividendWasMissed_ShouldSuggestItWithTheAmountAndStopOnceItIsRecorded()
    {
        var (client, _) = await NewAccountAsync();
        var id = await client.CreatePortfolioAsync("Dividends");
        var security = await factory.SeedSecurityAsync();
        await factory.SeedActionAsync(security.Id, new DateOnly(2026, 9, 15), CorporateActionKind.Dividend, amount: 0.5m);
        await client.AddAsync(id, new TransactionRequest(TransactionType.Buy, new DateOnly(2026, 2, 2), SecurityId: security.Id, Quantity: 10, Price: 100m));
        var url = $"/api/portfolios/{id}/suggestions";

        var suggestion = (await client.GetJsonAsync<List<SuggestionDto>>(url)).ShouldHaveSingleItem();

        (suggestion.Kind, suggestion.PerShare, suggestion.Quantity, suggestion.Amount).ShouldBe((CorporateActionKind.Dividend, 0.5m, 10m, 5m));

        await client.AddAsync(id, new TransactionRequest(TransactionType.Dividend, new DateOnly(2026, 10, 1), SecurityId: security.Id, Amount: 5m));
        (await client.GetJsonAsync<List<SuggestionDto>>(url)).ShouldBeEmpty();
    }

    [Fact]
    public async Task WhenActionsAreOldDismissedOrNotHeld_ShouldNotSuggestThem()
    {
        var (client, _) = await NewAccountAsync();
        var id = await client.CreatePortfolioAsync("Quiet");
        var security = await factory.SeedSecurityAsync();
        await factory.SeedActionAsync(security.Id, new DateOnly(2026, 5, 1), CorporateActionKind.Dividend, amount: 1m);        // older than 90 days
        await factory.SeedActionAsync(security.Id, new DateOnly(2026, 9, 1), CorporateActionKind.Dividend, amount: 1m);        // dismissed below
        await factory.SeedActionAsync(security.Id, new DateOnly(2026, 9, 20), CorporateActionKind.Dividend, amount: 1m);       // nothing held by then
        await client.AddAsync(id, new TransactionRequest(TransactionType.Buy, new DateOnly(2026, 2, 2), SecurityId: security.Id, Quantity: 10, Price: 100m));
        await client.AddAsync(id, new TransactionRequest(TransactionType.Sell, new DateOnly(2026, 9, 10), SecurityId: security.Id, Quantity: 10, Price: 100m));
        var dismiss = await client.PostJsonAsync($"/api/portfolios/{id}/suggestions/dismiss",
            new DismissSuggestionRequest(security.Id, new DateOnly(2026, 9, 1), CorporateActionKind.Dividend));
        dismiss.StatusCode.ShouldBe(HttpStatusCode.NoContent);

        (await client.GetJsonAsync<List<SuggestionDto>>($"/api/portfolios/{id}/suggestions")).ShouldBeEmpty();
    }

    [Fact]
    public async Task WhenSeveralDividendsAreMatchedToPayments_ShouldPairEachPaymentOnce()
    {
        var (client, _) = await NewAccountAsync();
        var id = await client.CreatePortfolioAsync("Pairs");
        var security = await factory.SeedSecurityAsync();
        await factory.SeedActionAsync(security.Id, new DateOnly(2026, 8, 1), CorporateActionKind.Dividend, amount: 1m);
        await factory.SeedActionAsync(security.Id, new DateOnly(2026, 8, 5), CorporateActionKind.Dividend, amount: 2m);
        await client.AddAsync(id, new TransactionRequest(TransactionType.Buy, new DateOnly(2026, 2, 2), SecurityId: security.Id, Quantity: 10, Price: 100m));
        await client.AddAsync(id, new TransactionRequest(TransactionType.Dividend, new DateOnly(2026, 8, 20), SecurityId: security.Id, Amount: 10m));

        var suggestion = (await client.GetJsonAsync<List<SuggestionDto>>($"/api/portfolios/{id}/suggestions")).ShouldHaveSingleItem();

        suggestion.Date.ShouldBe(new DateOnly(2026, 8, 5));
    }

    [Fact]
    public async Task WhenTheSameSuggestionIsDismissedTwice_ShouldStayDismissedWithoutError()
    {
        var (client, _) = await NewAccountAsync();
        var id = await client.CreatePortfolioAsync("Twice");
        var security = await factory.SeedSecurityAsync();
        var request = new DismissSuggestionRequest(security.Id, new DateOnly(2026, 6, 1), CorporateActionKind.Split);

        (await client.PostJsonAsync($"/api/portfolios/{id}/suggestions/dismiss", request)).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await client.PostJsonAsync($"/api/portfolios/{id}/suggestions/dismiss", request)).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        (await factory.WithDbAsync(db => db.DismissedSuggestions.CountAsync(d => d.PortfolioId == id, Ct))).ShouldBe(1);
    }

    [Fact]
    public async Task WhenDismissingForAnUnknownSecurity_ShouldFindNothing()
    {
        var (client, _) = await NewAccountAsync();
        var id = await client.CreatePortfolioAsync("Unknown");

        var response = await client.PostJsonAsync($"/api/portfolios/{id}/suggestions/dismiss",
            new DismissSuggestionRequest(Guid.NewGuid(), new DateOnly(2026, 6, 1), CorporateActionKind.Split));

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task WhenAViewerDismissesASuggestion_ShouldBeForbidden()
    {
        var (owner, _) = await NewAccountAsync();
        var (viewer, viewerEmail) = await NewAccountAsync();
        var id = await owner.CreatePortfolioAsync("Watched");
        await owner.ShareWithAsync(id, viewerEmail, canEdit: false);
        var security = await factory.SeedSecurityAsync();

        var response = await viewer.PostJsonAsync($"/api/portfolios/{id}/suggestions/dismiss",
            new DismissSuggestionRequest(security.Id, new DateOnly(2026, 6, 1), CorporateActionKind.Split));

        await response.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "view only");
        (await viewer.GetJsonAsync<List<SuggestionDto>>($"/api/portfolios/{id}/suggestions")).ShouldBeEmpty();
    }

    [Fact]
    public async Task WhenCashIsEntered_ShouldListNewestFirstAndOverwriteTheSameDay()
    {
        var (client, _) = await NewAccountAsync();
        var id = await client.CreatePortfolioAsync("Cash");
        var url = $"/api/portfolios/{id}/cash";
        (await client.GetJsonAsync<List<CashEntryDto>>(url)).ShouldBeEmpty();

        var first = await (await client.PutJsonAsync(url, new SetCashRequest("usd", 100m, new DateOnly(2026, 3, 2), "  statement  "))).ReadAsync<CashEntryDto>();
        first.ShouldBe(new CashEntryDto("USD", new DateOnly(2026, 3, 2), 100m, "statement"));
        await (await client.PutJsonAsync(url, new SetCashRequest("CAD", 50m, new DateOnly(2026, 3, 2), null))).ReadAsync<CashEntryDto>();
        var today = await (await client.PutJsonAsync(url, new SetCashRequest("CAD", 70m, null, " "))).ReadAsync<CashEntryDto>();
        today.ShouldBe(new CashEntryDto("CAD", Today, 70m, null));

        var overwritten = await (await client.PutJsonAsync(url, new SetCashRequest("USD", 125m, new DateOnly(2026, 3, 2), null))).ReadAsync<CashEntryDto>();
        overwritten.Balance.ShouldBe(125m);

        var entries = await client.GetJsonAsync<List<CashEntryDto>>(url);
        entries.Select(e => (e.Date, e.Currency, e.Balance)).ShouldBe(
            [(Today, "CAD", 70m), (new DateOnly(2026, 3, 2), "CAD", 50m), (new DateOnly(2026, 3, 2), "USD", 125m)]);
    }

    [Theory]
    [InlineData("XXX", "2026-03-02", "1", "Unsupported currency XXX.")]
    [InlineData("CAD", "2026-10-10", "1", "date cannot be in the future")]
    [InlineData("CAD", "1969-12-31", "1", "too far in the past")]
    [InlineData("CAD", "2026-03-02", "1000000000001", "out of range")]
    [InlineData("CAD", "2026-03-02", "-1000000000001", "out of range")]
    public async Task WhenCashEntryIsInvalid_ShouldRefuseWithTheReason(string currency, string date, string balance, string expected)
    {
        var (client, _) = await NewAccountAsync();
        var id = await client.CreatePortfolioAsync("Cash rules");

        var response = await client.PutJsonAsync($"/api/portfolios/{id}/cash",
            new SetCashRequest(currency, decimal.Parse(balance, System.Globalization.CultureInfo.InvariantCulture), DateOnly.Parse(date), null));

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, expected);
    }

    [Fact]
    public async Task WhenCashNoteIsTooLong_ShouldRefuseIt()
    {
        var (client, _) = await NewAccountAsync();
        var id = await client.CreatePortfolioAsync("Note");

        var response = await client.PutJsonAsync($"/api/portfolios/{id}/cash", new SetCashRequest("CAD", 1m, null, new string('n', 201)));

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "limited to 200 characters");
    }

    [Fact]
    public async Task WhenCashIsDeleted_ShouldRemoveOnlyThatEntry()
    {
        var (client, _) = await NewAccountAsync();
        var id = await client.CreatePortfolioAsync("Delete cash");
        var date = new DateOnly(2026, 3, 2);
        await client.PutJsonAsync($"/api/portfolios/{id}/cash", new SetCashRequest("USD", 1m, date, null));
        await client.PutJsonAsync($"/api/portfolios/{id}/cash", new SetCashRequest("CAD", 2m, date, null));

        (await client.DeleteResponseAsync($"/api/portfolios/{id}/cash/usd/2026-03-02")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await client.DeleteResponseAsync($"/api/portfolios/{id}/cash/usd/2026-03-02")).StatusCode.ShouldBe(HttpStatusCode.NotFound);

        (await client.GetJsonAsync<List<CashEntryDto>>($"/api/portfolios/{id}/cash")).Select(e => e.Currency).ShouldBe(["CAD"]);
    }

    [Fact]
    public async Task WhenAViewerChangesCash_ShouldBeForbiddenButAnEditorMay()
    {
        var (owner, _) = await NewAccountAsync();
        var (viewer, viewerEmail) = await NewAccountAsync();
        var (editor, editorEmail) = await NewAccountAsync();
        var id = await owner.CreatePortfolioAsync("Shared cash");
        await owner.ShareWithAsync(id, viewerEmail, canEdit: false);
        await owner.ShareWithAsync(id, editorEmail, canEdit: true);
        await owner.PutJsonAsync($"/api/portfolios/{id}/cash", new SetCashRequest("CAD", 1m, new DateOnly(2026, 3, 2), null));

        await (await viewer.PutJsonAsync($"/api/portfolios/{id}/cash", new SetCashRequest("CAD", 9m, null, null)))
            .ShouldBeProblemAsync(HttpStatusCode.Forbidden, "view only");
        await (await viewer.DeleteResponseAsync($"/api/portfolios/{id}/cash/CAD/2026-03-02")).ShouldBeProblemAsync(HttpStatusCode.Forbidden, "view only");
        (await viewer.GetJsonAsync<List<CashEntryDto>>($"/api/portfolios/{id}/cash")).ShouldHaveSingleItem().Balance.ShouldBe(1m);

        (await editor.DeleteResponseAsync($"/api/portfolios/{id}/cash/CAD/2026-03-02")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
    }
}
