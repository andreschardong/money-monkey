using System.Net;
using Folio.Api.Data;
using Folio.Api.Endpoints;
using Folio.Core;
using Microsoft.EntityFrameworkCore;

namespace Folio.Api.Tests;

[Collection(FolioApiCollection.Name)]
public class ResolutionAndSuggestionEdgeTests(FolioApiFactory factory)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static readonly DateOnly Feb2 = new(2026, 2, 2);

    [Fact]
    public async Task WhenTheProviderReportsNoExchange_ShouldStoreTheSecurityWithoutOne()
    {
        var (client, _) = await factory.NewAccountAsync();

        var security = await client.ResolveAsync("NOEXCH");

        security.Exchange.ShouldBeNull();
        security.Name.ShouldBe("No Exchange Inc.");
    }

    [Fact]
    public async Task WhenTheProviderNamesAreLongerThanTheColumns_ShouldTrimThemToFit()
    {
        var (client, _) = await factory.NewAccountAsync();

        var security = await client.ResolveAsync("LONGNAME");

        security.Name.ShouldBe(new string('N', 200));
        security.Exchange.ShouldBe(new string('E', 40));
    }

    [Fact]
    public async Task WhenTheSymbolCannotBeStored_ShouldFailAsAServerErrorAndStoreNothing()
    {
        var (client, _) = await factory.NewAccountAsync();
        const string symbol = "A-SYMBOL-THAT-IS-FAR-TOO-LONG-FOR-THE-DATABASE";

        var response = await client.PostJsonAsync("/api/securities", new ResolveSecurityRequest(symbol, null));

        response.StatusCode.ShouldBe(HttpStatusCode.InternalServerError);
        (await factory.WithDbAsync(db => db.Securities.IgnoreQueryFilters().CountAsync(s => s.Symbol == symbol, Ct))).ShouldBe(0);
    }

    [Fact]
    public async Task WhenAStoredSecurityHasNoHistoryStartYet_ShouldLoadItsHistoryOnTheNextLookup()
    {
        var (client, _) = await factory.NewAccountAsync();
        var security = await factory.SeedSecurityAsync(source: PriceSource.Yahoo, symbol: "RACEX2");
        await factory.WithDbAsync(db => db.Securities.IgnoreQueryFilters().Where(s => s.Id == security.Id)
            .ExecuteUpdateAsync(set => set.SetProperty(s => s.HistoryStart, (DateOnly?)null), Ct));
        var calls = 0;
        factory.Quotes.BeforeHistory = symbol =>
        {
            if (symbol == "RACEX2")
                calls++;
            return Task.CompletedTask;
        };
        try
        {
            var result = await client.ResolveAsync("RACEX2", new DateOnly(2026, 9, 1));

            result.Id.ShouldBe(security.Id);
        }
        finally
        {
            factory.Quotes.BeforeHistory = null;
        }

        calls.ShouldBe(1);
        await factory.WithDbAsync(db => db.Securities.IgnoreQueryFilters().Where(s => s.Id == security.Id).ExecuteDeleteAsync(Ct));
    }

    [Fact]
    public async Task WhenAProviderReportsDividends_ShouldStoreThemAndSuggestTheOnesNotYetRecorded()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Dividends");
        var security = await client.ResolveAsync("DIVX", Feb2);
        await client.AddAsync(portfolio, new TransactionRequest(TransactionType.Buy, Feb2, SecurityId: security.Id, Quantity: 10, Price: 20m));

        var actions = await client.GetJsonAsync<List<CorporateActionDto>>($"/api/securities/{security.Id}/actions");
        var suggestions = await client.GetJsonAsync<List<SuggestionDto>>($"/api/portfolios/{portfolio}/suggestions");

        actions.Select(a => (a.Date.Day, a.Kind, a.Amount)).ShouldBe([(16, CorporateActionKind.Dividend, 0.25m), (15, CorporateActionKind.Dividend, 0.5m)]);
        suggestions.Select(s => (s.Date.Day, s.Amount, s.PerShare)).ShouldBe([(16, 2.5m, 0.25m), (15, 5m, 0.5m)]);

        await client.AddAsync(portfolio, new TransactionRequest(TransactionType.Dividend, new DateOnly(2026, 10, 1), SecurityId: security.Id, Amount: 5m));
        (await client.GetJsonAsync<List<SuggestionDto>>($"/api/portfolios/{portfolio}/suggestions")).ShouldHaveSingleItem().Date.Day.ShouldBe(16);
    }

    [Fact]
    public async Task WhenSeveralSecuritiesAreTraded_ShouldMatchRecordedSplitsAndPaymentsOnlyToTheirOwnSecurityAndDates()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Busy");
        var a = await factory.SeedSecurityAsync();
        var b = await factory.SeedSecurityAsync();
        await client.DepositAsync(portfolio, 5_000m, "2026-01-05");
        await client.AddAsync(portfolio, new TransactionRequest(TransactionType.Buy, Feb2, SecurityId: a.Id, Quantity: 10, Price: 10m));
        await client.AddAsync(portfolio, new TransactionRequest(TransactionType.Buy, new DateOnly(2026, 2, 3), SecurityId: b.Id, Quantity: 5, Price: 10m));
        await client.AddAsync(portfolio, new TransactionRequest(TransactionType.Sell, new DateOnly(2026, 3, 2), SecurityId: a.Id, Quantity: 2, Price: 10m));
        await client.AddAsync(portfolio, new TransactionRequest(TransactionType.Split, new DateOnly(2026, 4, 2), SecurityId: a.Id, SplitFrom: 1, SplitTo: 2));
        await client.AddAsync(portfolio, new TransactionRequest(TransactionType.Split, new DateOnly(2026, 4, 1), SecurityId: b.Id, SplitFrom: 1, SplitTo: 2));
        foreach (var payment in new[] { "2026-07-01", "2026-09-20" })
            await client.AddAsync(portfolio, new TransactionRequest(TransactionType.Dividend, DateOnly.Parse(payment), SecurityId: a.Id, Amount: 3m));
        await client.AddAsync(portfolio, new TransactionRequest(TransactionType.Dividend, new DateOnly(2026, 10, 1), SecurityId: b.Id, Amount: 3m));
        await factory.SeedActionAsync(a.Id, new DateOnly(2026, 4, 1), CorporateActionKind.Split, numerator: 2, denominator: 1);     // recorded the day after
        await factory.SeedActionAsync(a.Id, new DateOnly(2026, 5, 15), CorporateActionKind.Split, numerator: 3, denominator: 1);    // nothing recorded near it
        await factory.SeedActionAsync(a.Id, new DateOnly(2026, 7, 15), CorporateActionKind.Dividend, amount: 1m);                   // the 20 Sep payment is 67 days later
        await factory.SeedActionAsync(a.Id, new DateOnly(2026, 9, 30), CorporateActionKind.Dividend, amount: 2m);                   // the 20 Sep payment is ten days earlier

        var suggestions = await client.GetJsonAsync<List<SuggestionDto>>($"/api/portfolios/{portfolio}/suggestions");

        suggestions.Select(s => (s.Kind, s.Date, s.Quantity)).ShouldBe(
        [
            (CorporateActionKind.Dividend, new DateOnly(2026, 9, 30), (decimal?)16m),
            (CorporateActionKind.Dividend, new DateOnly(2026, 7, 15), 16m),
            (CorporateActionKind.Split, new DateOnly(2026, 5, 15), 16m),
        ]);
    }

    [Fact]
    public async Task WhenAnAccountFeeIsCharged_ShouldAppearInTheTransactionsAndTheFeeTotal()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Fees");

        var fee = await client.AddAsync(portfolio, new TransactionRequest(TransactionType.Fee, Feb2, Amount: 9.5m, Note: "Annual fee"));

        (fee.Type, fee.Total).ShouldBe((TransactionType.Fee, 9.5m));
        (await client.DetailAsync(portfolio)).Fees.ShouldBe(9.5m);
    }

    [Fact]
    public async Task WhenASplitRatioHasAZeroPart_ShouldAskForTheRatio()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Zero split");

        var response = await client.PostJsonAsync($"/api/portfolios/{portfolio}/transactions",
            new TransactionRequest(TransactionType.Split, Feb2, Symbol: "SHOP.TO", SplitFrom: 0, SplitTo: 2));

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "Enter the split ratio");
    }

    [Fact]
    public async Task WhenTheQuoteProviderHasABug_ShouldNotBePassedOffAsAnOutage()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Bug");
        factory.Quotes.Failures["BUGX"] = new InvalidOperationException("bug in the provider");
        try
        {
            var response = await client.PostJsonAsync($"/api/portfolios/{portfolio}/transactions",
                new TransactionRequest(TransactionType.Buy, Feb2, Symbol: "BUGX", Quantity: 1, Price: 1m));

            response.StatusCode.ShouldBe(HttpStatusCode.InternalServerError);
        }
        finally
        {
            factory.Quotes.Failures.TryRemove("BUGX", out _);
        }
    }

    [Fact]
    public async Task WhenTheRateSourceHasABug_ShouldNotBePassedOffAsAMissingRate()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Rate bug");
        factory.Fx.Failure = new InvalidOperationException("bug in the rate source");
        try
        {
            var deposit = await client.PostJsonAsync($"/api/portfolios/{portfolio}/transactions",
                new TransactionRequest(TransactionType.Deposit, Feb2, Amount: 5m, Currency: "GBP"));
            (await client.PutJsonAsync($"/api/portfolios/{portfolio}/cash", new SetCashRequest("GBP", 5m, null, null))).EnsureSuccessStatusCode();
            var snapshot = await client.GetResponseAsync($"/api/portfolios/{portfolio}");

            deposit.StatusCode.ShouldBe(HttpStatusCode.InternalServerError);
            snapshot.StatusCode.ShouldBe(HttpStatusCode.InternalServerError);
        }
        finally
        {
            factory.Fx.Failure = null;
        }
    }

    [Fact]
    public async Task WhenCashIsNegative_ShouldWeighTheHoldingAgainstHoldingsOnlyAndLeaveEveryOtherWeightAtZero()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Borrowed");
        await client.DepositAsync(portfolio, 100m);
        await client.BuyAsync(portfolio, "SHOP.TO", 1, 90m);
        (await client.PutJsonAsync($"/api/portfolios/{portfolio}/cash", new SetCashRequest("CAD", -5_000m, null, null))).EnsureSuccessStatusCode();
        var shop = await client.ResolveAsync("SHOP.TO");

        var detail = await client.GetJsonAsync<HoldingDetailDto>($"/api/portfolios/{portfolio}/holdings/{shop.Id}");
        var assets = await client.GetJsonAsync<AssetsDto>("/api/assets");
        var overview = await client.GetJsonAsync<OverviewDto>("/api/overview");

        detail.Holding!.Weight.ShouldBe(1m);
        detail.Transactions.ShouldHaveSingleItem().Type.ShouldBe(TransactionType.Buy);
        assets.TotalValue.ShouldBeLessThan(0m);
        assets.Holdings.ShouldHaveSingleItem().Weight.ShouldBe(0m);
        assets.Cash.ShouldHaveSingleItem().Weight.ShouldBe(0m);
        overview.ByAssetType.ShouldHaveSingleItem().Key.ShouldBe("Stock");
    }

    [Fact]
    public async Task WhenTheOnlyHoldingIsWorthNothing_ShouldWeighItAtZero()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Gift");
        var security = await factory.SeedSecurityAsync();
        await client.AddAsync(portfolio, new TransactionRequest(TransactionType.TransferIn, Feb2, SecurityId: security.Id, Quantity: 1, Price: 0m));
        (await client.PutJsonAsync($"/api/portfolios/{portfolio}/cash", new SetCashRequest("CAD", -100m, null, null))).EnsureSuccessStatusCode();

        var detail = await client.GetJsonAsync<HoldingDetailDto>($"/api/portfolios/{portfolio}/holdings/{security.Id}");

        detail.Holding!.Weight.ShouldBe(0m);
    }

    [Fact]
    public async Task WhenAManualPriceIsOlderThanTheChartRange_ShouldStillValueTheHoldingFromIt()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Old price");
        var security = await factory.SeedSecurityAsync();
        await factory.SeedPricesAsync(security.Id, (new DateOnly(2025, 11, 3), 20m));
        await client.AddAsync(portfolio, new TransactionRequest(TransactionType.Buy, new DateOnly(2026, 1, 5), SecurityId: security.Id, Quantity: 10, Price: 15m));

        var history = await client.GetJsonAsync<HistoryDto>($"/api/portfolios/{portfolio}/history?range=1M");
        var detail = await client.DetailAsync(portfolio);

        history.Points.ShouldAllBe(p => p.Value == 200m);
        detail.Holdings.ShouldHaveSingleItem().Price.ShouldBe(20m);
    }

    [Fact]
    public async Task WhenSeveralAccountsShareAPortfolio_ShouldShowEachItsOwnAccessAndTheShareCount()
    {
        var (owner, _) = await factory.NewAccountAsync();
        var (viewer, viewerEmail) = await factory.NewAccountAsync();
        var (editor, editorEmail) = await factory.NewAccountAsync();
        var portfolio = await owner.CreatePortfolioAsync("Family");
        await owner.ShareWithAsync(portfolio, viewerEmail, canEdit: false);
        await owner.ShareWithAsync(portfolio, editorEmail, canEdit: true);

        var asViewer = (await viewer.DetailAsync(portfolio)).Summary;
        var asEditor = (await editor.DetailAsync(portfolio)).Summary;
        var asOwner = (await owner.DetailAsync(portfolio)).Summary;

        (asViewer.Access, asViewer.SharedWith).ShouldBe(("View", 2));
        (asEditor.Access, asEditor.SharedWith).ShouldBe(("Edit", 2));
        (asOwner.Access, asOwner.SharedWith).ShouldBe(("Owner", 2));
    }

    [Fact]
    public async Task WhenSecuritiesHaveSplitsOfTheirOwnOrABrokenRatio_ShouldRestateOnlyWhereItApplies()
    {
        var (client, _) = await factory.NewAccountAsync();
        var broken = await factory.SeedSecurityAsync();
        var splitting = await factory.SeedSecurityAsync();
        await factory.SeedPricesAsync(broken.Id, (new DateOnly(2026, 10, 7), 100m), (new DateOnly(2026, 10, 8), 50m));
        await factory.SeedPricesAsync(splitting.Id, (new DateOnly(2026, 10, 7), 100m), (new DateOnly(2026, 10, 8), 50m));
        await factory.SeedActionAsync(broken.Id, new DateOnly(2026, 10, 8), CorporateActionKind.Split, numerator: 2, denominator: 0);
        await factory.SeedActionAsync(splitting.Id, new DateOnly(2026, 10, 8), CorporateActionKind.Split, numerator: 2, denominator: 1);
        await factory.SeedActionAsync(splitting.Id, new DateOnly(2026, 10, 6), CorporateActionKind.Split, numerator: 5, denominator: 1);   // before the earlier close

        var list = await client.GetJsonAsync<List<SecurityDto>>("/api/securities");

        list.Single(s => s.Id == broken.Id).PreviousClose.ShouldBe(100m);
        list.Single(s => s.Id == splitting.Id).PreviousClose.ShouldBe(50m);
    }
}
