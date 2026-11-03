using System.Net;
using Folio.Api.Data;
using Folio.Api.Endpoints;
using Folio.Core;
using Microsoft.EntityFrameworkCore;

namespace Folio.Api.Tests;

[Collection(FolioApiCollection.Name)]
public class TransactionEndpointTests(FolioApiFactory factory)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static readonly DateOnly Feb2 = new(2026, 2, 2);

    private async Task<(HttpClient Client, Guid Portfolio)> NewPortfolioAsync(string currency = "CAD")
    {
        var (client, _) = await factory.NewAccountAsync();
        return (client, await client.CreatePortfolioAsync("Trades", currency));
    }

    private static Task<HttpResponseMessage> Post(HttpClient client, Guid portfolio, object request) =>
        client.PostJsonAsync($"/api/portfolios/{portfolio}/transactions", request);

    [Fact]
    public async Task WhenPortfolioDoesNotExist_ShouldFindNothingToListOrAdd()
    {
        var (client, _) = await factory.NewAccountAsync();
        var missing = Guid.NewGuid();

        (await client.GetResponseAsync($"/api/portfolios/{missing}/transactions")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await Post(client, missing, new TransactionRequest(TransactionType.Deposit, Feb2, Amount: 1m))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await client.PutJsonAsync($"/api/portfolios/{missing}/transactions/{Guid.NewGuid()}", new TransactionRequest(TransactionType.Deposit, Feb2, Amount: 1m)))
            .StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await client.DeleteResponseAsync($"/api/portfolios/{missing}/transactions/{Guid.NewGuid()}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task WhenTransactionsAreListed_ShouldBeNewestFirstAndFilterableBySecurityAndType()
    {
        var (client, portfolio) = await NewPortfolioAsync();
        await client.DepositAsync(portfolio, 5_000m, "2026-01-05");
        await client.BuyAsync(portfolio, "SHOP.TO", 10, 90m, "2026-02-02");
        await client.BuyAsync(portfolio, "AAPL", 1, 150m, "2026-02-02");
        await client.BuyAsync(portfolio, "SHOP.TO", 5, 95m, "2026-03-02");
        var shop = await client.ResolveAsync("SHOP.TO");
        var url = $"/api/portfolios/{portfolio}/transactions";

        var all = await client.GetJsonAsync<List<TransactionDto>>(url);
        all.Select(t => (t.Date.Month, t.Symbol)).ShouldBe([(3, "SHOP.TO"), (2, "AAPL"), (2, "SHOP.TO"), (1, null)]);

        (await client.GetJsonAsync<List<TransactionDto>>($"{url}?securityId={shop.Id}")).Count.ShouldBe(2);
        (await client.GetJsonAsync<List<TransactionDto>>($"{url}?type=Deposit")).ShouldHaveSingleItem().Amount.ShouldBe(5_000m);
        (await client.GetJsonAsync<List<TransactionDto>>($"{url}?type=Buy&securityId={shop.Id}")).Count.ShouldBe(2);
        (await client.GetJsonAsync<List<TransactionDto>>($"{url}?type=Sell")).ShouldBeEmpty();
    }

    [Fact]
    public async Task WhenABuyIsAddedBySymbol_ShouldStoreTheTradeInTheSecuritysCurrencyWithTheDaysRate()
    {
        var (client, portfolio) = await NewPortfolioAsync();

        var response = await Post(client, portfolio, new TransactionRequest(TransactionType.Buy, Feb2, Symbol: "aapl", Quantity: 3, Price: 150m, Fee: 5m, Note: "  first  "));

        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        var created = (await response.ReadAsync<List<TransactionDto>>()).ShouldHaveSingleItem();
        response.Headers.Location!.ToString().ShouldBe($"/api/portfolios/{portfolio}/transactions/{created.Id}");
        (created.Symbol, created.Currency, created.FxRate, created.Quantity, created.Price, created.Fee, created.Note)
            .ShouldBe(("AAPL", "USD", 1.4m, 3m, 150m, 5m, "first"));
        created.Total.ShouldBe(455m);
    }

    [Fact]
    public async Task WhenARateIsGiven_ShouldUseItInsteadOfTheStoredOne()
    {
        var (client, portfolio) = await NewPortfolioAsync();

        var created = await client.AddAsync(portfolio, new TransactionRequest(TransactionType.Buy, Feb2, Symbol: "AAPL", Quantity: 1, Price: 100m, FxRate: 1.25m));

        created.FxRate.ShouldBe(1.25m);
    }

    [Fact]
    public async Task WhenATransferInIsAdded_ShouldIgnoreAnyCommission()
    {
        var (client, portfolio) = await NewPortfolioAsync();

        var created = await client.AddAsync(portfolio, new TransactionRequest(TransactionType.TransferIn, Feb2, Symbol: "SHOP.TO", Quantity: 2, Price: 80m, Fee: 9m));

        created.Fee.ShouldBe(0m);
        created.Total.ShouldBe(160m);
        (await client.DetailAsync(portfolio)).Summary.NetContributions.ShouldBe(160m);
    }

    [Fact]
    public async Task WhenAViewerAddsATransaction_ShouldBeForbiddenButAnEditorMay()
    {
        var (owner, portfolio) = await NewPortfolioAsync();
        var (viewer, viewerEmail) = await factory.NewAccountAsync();
        var (editor, editorEmail) = await factory.NewAccountAsync();
        await owner.ShareWithAsync(portfolio, viewerEmail, canEdit: false);
        await owner.ShareWithAsync(portfolio, editorEmail, canEdit: true);
        var deposit = await owner.DepositAsync(portfolio, 10m);
        var request = new TransactionRequest(TransactionType.Deposit, Feb2, Amount: 5m);

        await (await Post(viewer, portfolio, request)).ShouldBeProblemAsync(HttpStatusCode.Forbidden, "view only");
        await (await viewer.PutJsonAsync($"/api/portfolios/{portfolio}/transactions/{deposit.Id}", request)).ShouldBeProblemAsync(HttpStatusCode.Forbidden, "view only");
        await (await viewer.DeleteResponseAsync($"/api/portfolios/{portfolio}/transactions/{deposit.Id}")).ShouldBeProblemAsync(HttpStatusCode.Forbidden, "view only");

        (await Post(editor, portfolio, request)).StatusCode.ShouldBe(HttpStatusCode.Created);
        (await editor.PutJsonAsync($"/api/portfolios/{portfolio}/transactions/{deposit.Id}", request)).EnsureSuccessStatusCode();
        (await editor.DeleteResponseAsync($"/api/portfolios/{portfolio}/transactions/{deposit.Id}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
    }

    public static TheoryData<TransactionRequest, string> InvalidRequests => new()
    {
        { new TransactionRequest(TransactionType.Deposit, new DateOnly(2026, 10, 10), Amount: 1m), "The date cannot be in the future." },
        { new TransactionRequest(TransactionType.Deposit, new DateOnly(1969, 12, 31), Amount: 1m), "The date is too far in the past." },
        { new TransactionRequest(TransactionType.Deposit, Feb2, Amount: 1m, Note: new string('n', 501)), "The note is limited to 500 characters." },
        { new TransactionRequest(TransactionType.Buy, Feb2, Quantity: 1, Price: 1m), "Choose a stock or fund." },
        { new TransactionRequest(TransactionType.Buy, Feb2, Symbol: "  ", Quantity: 1, Price: 1m), "Choose a stock or fund." },
        { new TransactionRequest(TransactionType.Buy, Feb2, SecurityId: Guid.NewGuid(), Quantity: 1, Price: 1m), "That security no longer exists." },
        { new TransactionRequest(TransactionType.Buy, Feb2, Symbol: "NOPE", Quantity: 1, Price: 1m), "No quotes were found for \"NOPE\"" },
        { new TransactionRequest(TransactionType.Buy, Feb2, Symbol: "SHOP.TO", Price: 1m), "Enter the number of shares." },
        { new TransactionRequest(TransactionType.Sell, Feb2, Symbol: "SHOP.TO", Quantity: 0, Price: 1m), "Enter the number of shares." },
        { new TransactionRequest(TransactionType.Buy, Feb2, Symbol: "SHOP.TO", Quantity: 1), "Enter the price per share." },
        { new TransactionRequest(TransactionType.Buy, Feb2, Symbol: "SHOP.TO", Quantity: 1, Price: -1m), "Enter the price per share." },
        { new TransactionRequest(TransactionType.Buy, Feb2, Symbol: "SHOP.TO", Quantity: 1, Price: 1m, Fee: -1m), "The commission cannot be negative." },
        { new TransactionRequest(TransactionType.Split, Feb2, Symbol: "SHOP.TO", SplitTo: 2), "Enter the split ratio" },
        { new TransactionRequest(TransactionType.Split, Feb2, Symbol: "SHOP.TO", SplitFrom: 2, SplitTo: 0), "Enter the split ratio" },
        { new TransactionRequest(TransactionType.Split, Feb2, Symbol: "SHOP.TO", SplitFrom: 2), "Enter the split ratio" },
        { new TransactionRequest(TransactionType.Split, Feb2, Symbol: "SHOP.TO", SplitFrom: 2, SplitTo: 2), "A split must change the number of shares." },
        { new TransactionRequest(TransactionType.Dividend, Feb2, Symbol: "SHOP.TO"), "Enter the dividend amount." },
        { new TransactionRequest(TransactionType.Dividend, Feb2, Symbol: "SHOP.TO", Amount: 5m, Fee: -1m), "The tax withheld must be between zero and the dividend amount." },
        { new TransactionRequest(TransactionType.Dividend, Feb2, Symbol: "SHOP.TO", Amount: 5m, Fee: 6m), "The tax withheld must be between zero and the dividend amount." },
        { new TransactionRequest(TransactionType.Dividend, Feb2, Symbol: "SHOP.TO", Amount: 5m, Currency: "XXX"), "Unsupported currency XXX." },
        { new TransactionRequest(TransactionType.Deposit, Feb2, Amount: 5m, Currency: "XXX"), "Unsupported currency XXX." },
        { new TransactionRequest(TransactionType.Deposit, Feb2), "Enter an amount greater than zero." },
        { new TransactionRequest(TransactionType.Withdrawal, Feb2, Amount: 0m), "Enter an amount greater than zero." },
        { new TransactionRequest(TransactionType.Deposit, Feb2, Amount: 5m, Currency: "GBP"), "No GBP to CAD exchange rate is available for 2026-02-02." },
        { new TransactionRequest(TransactionType.Sell, Feb2, Symbol: "SHOP.TO", Quantity: 1, Price: 1m), "Cannot sell 1 shares on 2026-02-02: only 0 held." },
        { new TransactionRequest(TransactionType.Split, Feb2, Symbol: "SHOP.TO", SplitFrom: 1, SplitTo: 2), "No shares are held on 2026-02-02, so there is nothing to split." },
    };

    [Theory]
    [MemberData(nameof(InvalidRequests))]
    public async Task WhenARequestBreaksARule_ShouldRefuseItWithTheReasonAndStoreNothing(TransactionRequest request, string expected)
    {
        var (client, portfolio) = await NewPortfolioAsync();

        var response = await Post(client, portfolio, request);

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, expected);
        (await client.GetJsonAsync<List<TransactionDto>>($"/api/portfolios/{portfolio}/transactions")).ShouldBeEmpty();
    }

    [Fact]
    public async Task WhenTheTypeIsUnknown_ShouldRefuseIt()
    {
        var (client, portfolio) = await NewPortfolioAsync();

        var response = await Post(client, portfolio, new { type = 99, date = "2026-02-02", amount = 1 });

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "Unknown transaction type.");
    }

    [Fact]
    public async Task WhenTheQuoteProviderIsDownDuringALookup_ShouldAskTheOwnerToTryAgainOrUseAManualPrice()
    {
        var (client, portfolio) = await NewPortfolioAsync();
        factory.Quotes.Failures["BOOM"] = new HttpRequestException("network is down");
        try
        {
            var response = await Post(client, portfolio, new TransactionRequest(TransactionType.Buy, Feb2, Symbol: "BOOM", Quantity: 1, Price: 1m));

            await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "Could not look up BOOM right now (network is down). Try again, or add it with a manual price.");
        }
        finally
        {
            factory.Quotes.Failures.TryRemove("BOOM", out _);
        }
    }

    [Fact]
    public async Task WhenTheRateSourceIsDown_ShouldReportTheMissingRateInsteadOfFailing()
    {
        var (client, portfolio) = await NewPortfolioAsync();
        factory.Fx.Failure = new HttpRequestException("rates are down");
        try
        {
            var response = await Post(client, portfolio, new TransactionRequest(TransactionType.Deposit, Feb2, Amount: 5m, Currency: "GBP"));

            await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "Enter the rate you received.");
        }
        finally
        {
            factory.Fx.Failure = null;
        }
    }

    [Fact]
    public async Task WhenAForeignDepositGivesItsOwnRate_ShouldAcceptIt()
    {
        var (client, portfolio) = await NewPortfolioAsync();

        var created = await client.AddAsync(portfolio, new TransactionRequest(TransactionType.Deposit, Feb2, Amount: 100m, Currency: "GBP", FxRate: 1.7m));

        (created.Currency, created.FxRate).ShouldBe(("GBP", 1.7m));
        (await client.DetailAsync(portfolio)).Summary.NetContributions.ShouldBe(170m);
    }

    [Fact]
    public async Task WhenADividendIsPaidInAnotherCurrency_ShouldConvertItAtThatDaysRate()
    {
        var (client, portfolio) = await NewPortfolioAsync();
        await client.BuyAsync(portfolio, "SHOP.TO", 10, 90m);

        var dividend = await client.AddAsync(portfolio,
            new TransactionRequest(TransactionType.Dividend, new DateOnly(2026, 3, 2), Symbol: "SHOP.TO", Amount: 10m, Fee: 1m, Currency: "usd"));

        (dividend.Currency, dividend.FxRate, dividend.Total).ShouldBe(("USD", 1.4m, 9m));
        (await client.DetailAsync(portfolio)).Dividends.ShouldBe(12.6m);
    }

    [Fact]
    public async Task WhenABackDatedSellWouldStrandALaterOne_ShouldNameTheBrokenTransaction()
    {
        var (client, portfolio) = await NewPortfolioAsync();
        await client.BuyAsync(portfolio, "SHOP.TO", 10, 90m);
        await client.AddAsync(portfolio, new TransactionRequest(TransactionType.Sell, new DateOnly(2026, 3, 2), Symbol: "SHOP.TO", Quantity: 10, Price: 100m));

        var response = await Post(client, portfolio, new TransactionRequest(TransactionType.Sell, new DateOnly(2026, 2, 16), Symbol: "SHOP.TO", Quantity: 5, Price: 100m));

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "This would break the sell on 2026-03-02: Cannot sell 10 shares on 2026-03-02: only 5 held.");
    }

    [Fact]
    public async Task WhenATransactionIsEdited_ShouldChangeItsFieldsAndKeepItsPlaceInTheLedger()
    {
        var (client, portfolio) = await NewPortfolioAsync();
        var buy = await client.BuyAsync(portfolio, "SHOP.TO", 10, 90m);
        var url = $"/api/portfolios/{portfolio}/transactions/{buy.Id}";

        var updated = await (await client.PutJsonAsync(url,
            new TransactionRequest(TransactionType.Buy, new DateOnly(2026, 2, 3), Symbol: "AAPL", Quantity: 4, Price: 100m, Fee: 2m, Note: " edited "))).ReadAsync<TransactionDto>();

        (updated.Id, updated.Symbol, updated.Currency, updated.Date, updated.Quantity, updated.Fee, updated.Note, updated.FxRate)
            .ShouldBe((buy.Id, "AAPL", "USD", new DateOnly(2026, 2, 3), 4m, 2m, "edited", 1.4m));
        var stored = (await client.GetJsonAsync<List<TransactionDto>>($"/api/portfolios/{portfolio}/transactions")).ShouldHaveSingleItem();
        (stored.Symbol, stored.Quantity).ShouldBe(("AAPL", 4m));
    }

    [Fact]
    public async Task WhenAnEditIsInvalid_ShouldRefuseItAndLeaveTheTransactionAlone()
    {
        var (client, portfolio) = await NewPortfolioAsync();
        var buy = await client.BuyAsync(portfolio, "SHOP.TO", 10, 90m);
        var url = $"/api/portfolios/{portfolio}/transactions/{buy.Id}";

        await (await client.PutJsonAsync(url, new TransactionRequest(TransactionType.Buy, Feb2, Symbol: "SHOP.TO", Quantity: 0, Price: 1m)))
            .ShouldBeProblemAsync(HttpStatusCode.BadRequest, "Enter the number of shares.");

        (await client.GetJsonAsync<List<TransactionDto>>($"/api/portfolios/{portfolio}/transactions")).ShouldHaveSingleItem().Quantity.ShouldBe(10m);
    }

    [Fact]
    public async Task WhenAnEditWouldStrandALaterSell_ShouldNameTheSellAndKeepTheBuy()
    {
        var (client, portfolio) = await NewPortfolioAsync();
        var buy = await client.BuyAsync(portfolio, "SHOP.TO", 10, 90m);
        await client.AddAsync(portfolio, new TransactionRequest(TransactionType.Sell, new DateOnly(2026, 3, 2), Symbol: "SHOP.TO", Quantity: 10, Price: 100m));

        var response = await client.PutJsonAsync($"/api/portfolios/{portfolio}/transactions/{buy.Id}",
            new TransactionRequest(TransactionType.Buy, Feb2, Symbol: "SHOP.TO", Quantity: 2, Price: 90m));

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "This would break the sell on 2026-03-02");
        (await client.GetJsonAsync<List<TransactionDto>>($"/api/portfolios/{portfolio}/transactions?type=Buy")).ShouldHaveSingleItem().Quantity.ShouldBe(10m);
    }

    [Fact]
    public async Task WhenAnEditMakesTheEditedEntryItselfInvalid_ShouldReportTheLedgerMessage()
    {
        var (client, portfolio) = await NewPortfolioAsync();
        await client.BuyAsync(portfolio, "SHOP.TO", 10, 90m);
        var sell = await client.AddAsync(portfolio, new TransactionRequest(TransactionType.Sell, new DateOnly(2026, 3, 2), Symbol: "SHOP.TO", Quantity: 4, Price: 100m));

        var response = await client.PutJsonAsync($"/api/portfolios/{portfolio}/transactions/{sell.Id}",
            new TransactionRequest(TransactionType.Sell, new DateOnly(2026, 3, 2), Symbol: "SHOP.TO", Quantity: 40, Price: 100m));

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "Cannot sell 40 shares on 2026-03-02: only 10 held.");
        (await client.GetJsonAsync<List<TransactionDto>>($"/api/portfolios/{portfolio}/transactions?type=Sell")).ShouldHaveSingleItem().Quantity.ShouldBe(4m);
    }

    [Fact]
    public async Task WhenATransactionBelongsToAnotherPortfolio_ShouldNotBeFoundThroughThisOne()
    {
        var (client, portfolio) = await NewPortfolioAsync();
        var other = await client.CreatePortfolioAsync("Other");
        var deposit = await client.DepositAsync(other, 10m);
        var request = new TransactionRequest(TransactionType.Deposit, Feb2, Amount: 1m);

        (await client.PutJsonAsync($"/api/portfolios/{portfolio}/transactions/{deposit.Id}", request)).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await client.DeleteResponseAsync($"/api/portfolios/{portfolio}/transactions/{deposit.Id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task WhenABuyThatLaterSalesDependOnIsDeleted_ShouldRefuseAndNameTheSale()
    {
        var (client, portfolio) = await NewPortfolioAsync();
        var buy = await client.BuyAsync(portfolio, "SHOP.TO", 10, 90m);
        await client.AddAsync(portfolio, new TransactionRequest(TransactionType.Sell, new DateOnly(2026, 3, 2), Symbol: "SHOP.TO", Quantity: 10, Price: 100m));

        var response = await client.DeleteResponseAsync($"/api/portfolios/{portfolio}/transactions/{buy.Id}");

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "This would break the sell on 2026-03-02");
        (await client.GetJsonAsync<List<TransactionDto>>($"/api/portfolios/{portfolio}/transactions")).Count.ShouldBe(2);
    }

    [Fact]
    public async Task WhenATransactionIsDeleted_ShouldRemoveItAndRecomputeTheTotals()
    {
        var (client, portfolio) = await NewPortfolioAsync();
        var deposit = await client.DepositAsync(portfolio, 100m);
        await client.DepositAsync(portfolio, 50m, "2026-01-06");

        (await client.DeleteResponseAsync($"/api/portfolios/{portfolio}/transactions/{deposit.Id}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        (await client.DetailAsync(portfolio)).Summary.NetContributions.ShouldBe(50m);
    }

    [Fact]
    public async Task WhenAnotherEntryIsBrokenInTheStoredLedger_ShouldDescribeItByItsKind()
    {
        var (client, portfolio) = await NewPortfolioAsync();
        await client.BuyAsync(portfolio, "SHOP.TO", 10, 90m, "2026-02-02");
        var deposit = await client.DepositAsync(portfolio, 5m);
        var shop = await client.ResolveAsync("SHOP.TO");
        // A transfer in recorded in the wrong currency for its security: only possible by editing the data directly.
        await factory.WithDbAsync(async db =>
        {
            db.Transactions.Add(new Transaction
            {
                Id = Guid.CreateVersion7(), PortfolioId = portfolio, Type = TransactionType.TransferIn, Date = new DateOnly(2026, 3, 2), Sequence = 99,
                SecurityId = shop.Id, Currency = "USD", Quantity = 1, Price = 1, FxRate = 1.4m, CreatedAt = factory.Time.GetUtcNow(), UpdatedAt = factory.Time.GetUtcNow(),
            });
            await db.SaveChangesAsync(Ct);
        });

        var response = await client.DeleteResponseAsync($"/api/portfolios/{portfolio}/transactions/{deposit.Id}");

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "This would break the transfer in on 2026-03-02: This security trades in CAD, not USD.");
        (await client.GetJsonAsync<List<TransactionDto>>($"/api/portfolios/{portfolio}/transactions?type=Deposit")).ShouldHaveSingleItem().Id.ShouldBe(deposit.Id);
    }
}
