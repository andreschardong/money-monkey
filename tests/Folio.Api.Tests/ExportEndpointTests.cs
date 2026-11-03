using System.Net;
using System.Text;
using Folio.Api.Data;
using Folio.Api.Endpoints;
using Folio.Core;

namespace Folio.Api.Tests;

[Collection(FolioApiCollection.Name)]
public class ExportEndpointTests(FolioApiFactory factory)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static async Task<(string[] Lines, HttpResponseMessage Response)> CsvAsync(HttpClient client, string url)
    {
        var response = await client.GetAsync(url, Ct);
        response.EnsureSuccessStatusCode();
        var bytes = await response.Content.ReadAsByteArrayAsync(Ct);
        bytes.Take(3).ShouldBe(Encoding.UTF8.GetPreamble());
        var text = Encoding.UTF8.GetString(bytes, 3, bytes.Length - 3);
        return (text.Split("\r\n", StringSplitOptions.RemoveEmptyEntries), response);
    }

    [Fact]
    public async Task WhenAnAccountExports_ShouldGetItsOwnPortfoliosWithEveryFieldAndNothingSharedWithIt()
    {
        var (owner, ownerEmail) = await factory.NewAccountAsync();
        var (guest, _) = await factory.NewAccountAsync();
        var mine = await owner.CreatePortfolioAsync("Homes", "USD", "us", PortfolioKind.RealEstate);
        await owner.AddAsync(mine, new TransactionRequest(TransactionType.Deposit, new DateOnly(2026, 2, 2), Amount: 25m, Currency: "USD", Note: "seed"));
        await owner.BuyAsync(mine, "SHOP.TO", 2, 50m, "2026-03-02");
        (await owner.PutJsonAsync($"/api/portfolios/{mine}/cash", new SetCashRequest("USD", 7m, new DateOnly(2026, 3, 3), "bank"))).EnsureSuccessStatusCode();
        var theirs = await guest.CreatePortfolioAsync("Theirs");
        await guest.ShareWithAsync(theirs, ownerEmail, canEdit: false);

        var export = await owner.GetJsonAsync<ExportDto>("/api/export");

        export.ExportedAt.ShouldBe(factory.Time.GetUtcNow());
        var portfolio = export.Portfolios.ShouldHaveSingleItem();
        (portfolio.Id, portfolio.Name, portfolio.BaseCurrency, portfolio.Country, portfolio.Kind).ShouldBe((mine, "Homes", "USD", "US", PortfolioKind.RealEstate));
        portfolio.Transactions.Select(t => (t.Type, t.Symbol, t.PriceSource, t.Currency, t.Note)).ShouldBe(
            [(TransactionType.Deposit, null, null, "USD", "seed"), (TransactionType.Buy, "SHOP.TO", "Yahoo", "CAD", null)]);
        portfolio.CashBalances.ShouldHaveSingleItem().ShouldBe(new CashEntryDto("USD", new DateOnly(2026, 3, 3), 7m, "bank"));
        (await CsvAsync(owner, "/api/export/transactions.csv")).Lines.Length.ShouldBe(3);
    }

    [Fact]
    public async Task WhenTransactionsAreExportedAsCsv_ShouldQuoteAwkwardTextAndFormatNumbersForASpreadsheet()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Trades, \"big\"");
        await client.BuyAsync(portfolio, "SHOP.TO", 2.5m, 90.125m, "2026-02-02");
        await client.AddAsync(portfolio, new TransactionRequest(TransactionType.Dividend, new DateOnly(2026, 3, 2), Symbol: "SHOP.TO", Amount: 3m, Fee: 0.5m, Note: "one, \"two\""));
        await client.AddAsync(portfolio, new TransactionRequest(TransactionType.Split, new DateOnly(2026, 4, 1), Symbol: "SHOP.TO", SplitFrom: 1, SplitTo: 2));
        await client.AddAsync(portfolio, new TransactionRequest(TransactionType.Deposit, new DateOnly(2026, 1, 5), Amount: 1_000m));

        var (lines, response) = await CsvAsync(client, "/api/export/transactions.csv");

        response.Content.Headers.ContentType!.ToString().ShouldBe("text/csv; charset=utf-8");
        response.Content.Headers.ContentDisposition!.FileNameStar.ShouldBe("folio-transactions-2026-10-09.csv");
        const string name = "\"Trades, \"\"big\"\"\"";
        lines.ShouldBe(
        [
            "Portfolio,Date,Type,Symbol,Security,Currency,Quantity,Price,Amount,Fee,Exchange rate,Split from,Split to,Note",
            $"{name},2026-01-05,Deposit,,,CAD,0,0,1000,0,1,0,0,",
            $"{name},2026-02-02,Buy,SHOP.TO,Shopify Inc.,CAD,2.5,90.125,0,0,1,0,0,",
            $"{name},2026-03-02,Dividend,SHOP.TO,Shopify Inc.,CAD,0,0,3,0.5,1,0,0,\"one, \"\"two\"\"\"",
            $"{name},2026-04-01,Split,SHOP.TO,Shopify Inc.,CAD,0,0,0,0,1,1,2,",
        ]);
    }

    [Fact]
    public async Task WhenACellHasALineBreak_ShouldKeepItInsideQuotes()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Notes");
        await client.AddAsync(portfolio, new TransactionRequest(TransactionType.Deposit, new DateOnly(2026, 1, 5), Amount: 1m, Note: "first\r\nsecond"));

        var response = await client.GetAsync("/api/export/transactions.csv", Ct);

        (await response.Content.ReadAsStringAsync(Ct)).ShouldContain(",\"first\r\nsecond\"\r\n");
    }

    [Fact]
    public async Task WhenCashIsExportedAsCsv_ShouldListEachBalanceByCurrencyThenDate()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Cash");
        await client.PutJsonAsync($"/api/portfolios/{portfolio}/cash", new SetCashRequest("USD", 5m, new DateOnly(2026, 3, 3), "a, b"));
        await client.PutJsonAsync($"/api/portfolios/{portfolio}/cash", new SetCashRequest("CAD", 9.5m, new DateOnly(2026, 4, 4), null));
        await client.PutJsonAsync($"/api/portfolios/{portfolio}/cash", new SetCashRequest("CAD", 8m, new DateOnly(2026, 3, 3), null));

        var (lines, response) = await CsvAsync(client, "/api/export/cash.csv");

        response.Content.Headers.ContentDisposition!.FileNameStar.ShouldBe("folio-cash-2026-10-09.csv");
        lines.ShouldBe(["Portfolio,Currency,Date,Balance,Note", "Cash,CAD,2026-03-03,8,", "Cash,CAD,2026-04-04,9.5,", "Cash,USD,2026-03-03,5,\"a, b\""]);
    }

    [Fact]
    public async Task WhenHoldingsAreExportedAsCsv_ShouldListPositionsAndCashByValueIncludingUnpricedOnes()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Holdings");
        await client.BuyAsync(portfolio, "SHOP.TO", 10, 90m);
        var unpriced = await factory.SeedSecurityAsync();
        await client.AddAsync(portfolio, new TransactionRequest(TransactionType.Buy, new DateOnly(2026, 2, 2), SecurityId: unpriced.Id, Quantity: 1, Price: 5m));
        await client.PutJsonAsync($"/api/portfolios/{portfolio}/cash", new SetCashRequest("USD", 10m, new DateOnly(2026, 3, 3), null));

        var (lines, response) = await CsvAsync(client, "/api/export/holdings.csv");

        response.Content.Headers.ContentDisposition!.FileNameStar.ShouldBe("folio-holdings-2026-10-09.csv");
        lines[0].ShouldStartWith("Portfolio,Portfolio currency,Symbol,Security,Currency,Shares,Average cost,");
        lines[1].ShouldBe("Holdings,CAD,SHOP.TO,Shopify Inc.,CAD,10,90,900,101,2026-10-09,1010,1010,110");
        lines[2].ShouldBe($"Holdings,CAD,{unpriced.Symbol},Seeded security,CAD,1,5,5,,,5,5,0");
        lines[3].ShouldBe("Holdings,CAD,CASH,Cash USD,USD,10,,,,2026-03-03,10,14,");
    }

    [Fact]
    public async Task WhenAnAccountHasNothing_ShouldExportJustTheHeaders()
    {
        var (client, _) = await factory.NewAccountAsync();

        (await CsvAsync(client, "/api/export/transactions.csv")).Lines.Length.ShouldBe(1);
        (await CsvAsync(client, "/api/export/cash.csv")).Lines.Length.ShouldBe(1);
        (await CsvAsync(client, "/api/export/holdings.csv")).Lines.Length.ShouldBe(1);
        (await client.GetJsonAsync<ExportDto>("/api/export")).Portfolios.ShouldBeEmpty();
    }

    [Fact]
    public async Task WhenNotSignedIn_ShouldRefuseEveryExport()
    {
        using var anonymous = factory.CreateClient();

        foreach (var url in new[] { "/api/export", "/api/export/transactions.csv", "/api/export/cash.csv", "/api/export/holdings.csv" })
            (await anonymous.GetAsync(url, Ct)).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }
}
