using System.Net;
using Folio.Api.Data;
using Folio.Api.Endpoints;
using Folio.Core;


namespace Folio.Api.Tests;

[Collection(FolioApiCollection.Name)]
public class ImportEndpointTests(FolioApiFactory factory)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static readonly DateOnly Mar2 = new(2026, 3, 2);

    private static ExportTransactionDto Buy(string? symbol, string? source = "Yahoo", string? name = null, string currency = "CAD", decimal quantity = 1, DateOnly? date = null) =>
        new(date ?? Mar2, TransactionType.Buy, symbol, name, source, currency, quantity, 10m, 0m, 0m, 1m, 0m, 0m, null);

    private static ExportTransactionDto Deposit(decimal amount = 10m, string currency = "CAD", DateOnly? date = null, string? note = null, decimal fxRate = 1m) =>
        new(date ?? Mar2, TransactionType.Deposit, null, null, null, currency, 0m, 0m, amount, 0m, fxRate, 0m, 0m, note);

    private static ExportPortfolioDto Portfolio(
        string? name, IReadOnlyList<ExportTransactionDto>? transactions = null, string currency = "CAD", IReadOnlyList<CashEntryDto>? cash = null,
        string? country = null, PortfolioKind kind = PortfolioKind.Investment, string? description = null) =>
        new(Guid.NewGuid(), name!, currency, description, DateTimeOffset.UtcNow, transactions ?? [], cash ?? [], country, kind);

    private static ExportDto File(params ExportPortfolioDto[] portfolios) => new(DateTimeOffset.UtcNow, portfolios);

    private static Task<HttpResponseMessage> Import(HttpClient client, ExportDto file) => client.PostJsonAsync("/api/import", file);

    [Fact]
    public async Task WhenTheFileHasNoPortfoliosAtAll_ShouldSaySo()
    {
        var (client, _) = await factory.NewAccountAsync();

        await (await client.PostJsonAsync("/api/import", new { exportedAt = DateTimeOffset.UtcNow, portfolios = (object?)null }))
            .ShouldBeProblemAsync(HttpStatusCode.BadRequest, "no portfolios in it");
        await (await Import(client, File())).ShouldBeProblemAsync(HttpStatusCode.BadRequest, "no portfolios in it");
    }

    [Fact]
    public async Task WhenTheFileHasTooManyTransactions_ShouldRefuseItBeforeReadingThem()
    {
        var (client, _) = await factory.NewAccountAsync();
        var many = Enumerable.Range(0, 20_001).Select(_ => Deposit(1m)).ToList();

        await (await Import(client, File(Portfolio("Huge", many)))).ShouldBeProblemAsync(HttpStatusCode.BadRequest, "more than 20,000 transactions");
        (await client.GetJsonAsync<List<PortfolioSummaryDto>>("/api/portfolios")).ShouldBeEmpty();
    }

    [Fact]
    public async Task WhenTheFileHasTooManyDifferentSymbols_ShouldAskToSplitItUp()
    {
        var (client, _) = await factory.NewAccountAsync();
        var many = Enumerable.Range(0, 501).Select(i => Buy($"SYM{i}")).ToList();

        await (await Import(client, File(Portfolio("Wide", many)))).ShouldBeProblemAsync(HttpStatusCode.BadRequest, "more than 500 different symbols");
    }

    [Fact]
    public async Task WhenPortfolioNameOrCurrencyIsMissing_ShouldNameTheFault()
    {
        var (client, _) = await factory.NewAccountAsync();

        await (await Import(client, File(Portfolio("  ")))).ShouldBeProblemAsync(HttpStatusCode.BadRequest, "needs a name and a currency of CAD, USD or EUR");
        await (await Import(client, File(Portfolio("Fine", currency: "GBP")))).ShouldBeProblemAsync(HttpStatusCode.BadRequest, "Portfolio \"Fine\" needs a name");
    }

    [Fact]
    public async Task WhenTheCountryIsNotACode_ShouldRefuseTheFile()
    {
        var (client, _) = await factory.NewAccountAsync();

        await (await Import(client, File(Portfolio("Abroad", country: "Canada")))).ShouldBeProblemAsync(HttpStatusCode.BadRequest, "Portfolio \"Abroad\": The country must be a two-letter code");
    }

    [Fact]
    public async Task WhenPortfoliosCarryCountryKindAndDescription_ShouldKeepThemNormalized()
    {
        var (client, _) = await factory.NewAccountAsync();
        var odd = new ExportPortfolioDto(Guid.NewGuid(), "Odd kind", "EUR", "  ", DateTimeOffset.UtcNow, [], [], " ca ", (PortfolioKind)42);
        var homes = Portfolio("Homes", country: "us", kind: PortfolioKind.RealEstate, description: " Rentals ");

        var result = await Import(client, File(odd, homes)).ReadAsync<ImportResultDto>();

        result.Portfolios.ShouldBe(2);
        var portfolios = await client.GetJsonAsync<List<PortfolioSummaryDto>>("/api/portfolios");
        var oddImported = portfolios.Single(p => p.Name == "Odd kind");
        (oddImported.Description, oddImported.Country, oddImported.Kind, oddImported.BaseCurrency).ShouldBe((null, "CA", PortfolioKind.Investment, "EUR"));
        var homesImported = portfolios.Single(p => p.Name == "Homes");
        (homesImported.Description, homesImported.Country, homesImported.Kind).ShouldBe(("Rentals", "US", PortfolioKind.RealEstate));
    }

    [Fact]
    public async Task WhenTwoPortfoliosShareANameOrMatchAnExistingOne_ShouldRenameTheLaterOnes()
    {
        var (client, _) = await factory.NewAccountAsync();
        await client.CreatePortfolioAsync("Taken");

        await Import(client, File(Portfolio("TAKEN"), Portfolio("Twin"), Portfolio("Twin"))).ReadAsync<ImportResultDto>();

        (await client.GetJsonAsync<List<PortfolioSummaryDto>>("/api/portfolios")).Select(p => p.Name).Order(StringComparer.Ordinal)
            .ShouldBe(["TAKEN (imported)", "Taken", "Twin", "Twin (imported)"]);
    }

    [Fact]
    public async Task WhenATransactionHasAnUnknownTypeOrCurrency_ShouldNameTheDate()
    {
        var (client, _) = await factory.NewAccountAsync();
        var weird = Deposit() with { Type = (TransactionType)99 };
        var foreign = Deposit(currency: "XXX");

        await (await Import(client, File(Portfolio("Types", [weird])))).ShouldBeProblemAsync(HttpStatusCode.BadRequest, "\"Types\": unknown transaction type on 2026-03-02.");
        await (await Import(client, File(Portfolio("Money", [foreign])))).ShouldBeProblemAsync(HttpStatusCode.BadRequest, "\"Money\": unsupported currency XXX on 2026-03-02.");
    }

    [Fact]
    public async Task WhenATradeHasNoSymbol_ShouldSayWhichOne()
    {
        var (client, _) = await factory.NewAccountAsync();

        await (await Import(client, File(Portfolio("No symbol", [Buy("  ")])))).ShouldBeProblemAsync(HttpStatusCode.BadRequest, "the Buy on 2026-03-02 has no symbol");
        await (await Import(client, File(Portfolio("No symbol", [Buy(null)])))).ShouldBeProblemAsync(HttpStatusCode.BadRequest, "has no symbol");
    }

    [Fact]
    public async Task WhenCashBalancesAreIncluded_ShouldImportEachCurrencyAndDateOnce()
    {
        var (client, _) = await factory.NewAccountAsync();
        var cash = new List<CashEntryDto>
        {
            new("usd", Mar2, 10m, "first"),
            new("USD", Mar2, 99m, "duplicate"),
            new("CAD", Mar2, 0m, null),
        };

        var result = await Import(client, File(Portfolio("Cash", cash: cash))).ReadAsync<ImportResultDto>();

        result.CashBalances.ShouldBe(2);
        var id = (await client.GetJsonAsync<List<PortfolioSummaryDto>>("/api/portfolios")).Single().Id;
        (await client.GetJsonAsync<List<CashEntryDto>>($"/api/portfolios/{id}/cash")).Select(e => (e.Currency, e.Balance, e.Note)).Order()
            .ShouldBe([("CAD", 0m, null), ("USD", 10m, "first")]);
    }

    [Fact]
    public async Task WhenACashBalanceHasAnUnsupportedCurrency_ShouldRefuseTheFileWholeAndStoreNothing()
    {
        var (client, _) = await factory.NewAccountAsync();
        var cash = new List<CashEntryDto> { new("XXX", Mar2, 10m, null) };

        await (await Import(client, File(Portfolio("Good", [Deposit()]), Portfolio("Cash", cash: cash)))).ShouldBeProblemAsync(HttpStatusCode.BadRequest, "\"Cash\": unsupported cash currency XXX.");

        (await client.GetJsonAsync<List<PortfolioSummaryDto>>("/api/portfolios")).ShouldBeEmpty();
    }

    [Fact]
    public async Task WhenTransactionsNeedCleaningUp_ShouldStoreThemInDateOrderWithSaneRates()
    {
        var (client, _) = await factory.NewAccountAsync();
        var later = Deposit(5m, date: new DateOnly(2026, 4, 1), note: "  later  ", fxRate: 0m);
        var earlier = Deposit(7m, date: Mar2, note: "   ");

        await Import(client, File(Portfolio("Order", [later, earlier]))).ReadAsync<ImportResultDto>();

        var id = (await client.GetJsonAsync<List<PortfolioSummaryDto>>("/api/portfolios")).Single().Id;
        var stored = await client.GetJsonAsync<List<TransactionDto>>($"/api/portfolios/{id}/transactions");
        stored.Select(t => (t.Date, t.Amount, t.Note, t.FxRate)).ShouldBe([(new DateOnly(2026, 4, 1), 5m, "later", 1m), (Mar2, 7m, null, 1m)]);
    }

    [Fact]
    public async Task WhenASymbolRepeatsOrIsAlreadyKnown_ShouldReuseThatSecurity()
    {
        var (client, _) = await factory.NewAccountAsync();
        var shop = await client.ResolveAsync("SHOP.TO");

        await Import(client, File(Portfolio("Repeat", [Buy("shop.to"), Buy("SHOP.TO", date: new DateOnly(2026, 3, 3))]))).ReadAsync<ImportResultDto>();

        var id = (await client.GetJsonAsync<List<PortfolioSummaryDto>>("/api/portfolios")).Single().Id;
        (await client.GetJsonAsync<List<TransactionDto>>($"/api/portfolios/{id}/transactions")).Select(t => t.SecurityId).Distinct().ShouldBe([shop.Id]);
    }

    [Fact]
    public async Task WhenASymbolIsQuotableButNotStoredYet_ShouldBeLookedUpAndShared()
    {
        var (client, _) = await factory.NewAccountAsync();

        var result = await Import(client, File(Portfolio("Lookup", [Buy("IMPORTX", name: "Ignored name")]))).ReadAsync<ImportResultDto>();

        result.Warnings.ShouldBeEmpty();
        var security = await client.ResolveAsync("IMPORTX");
        (security.Name, security.PriceSource).ShouldBe(("Import Test Inc.", PriceSource.Yahoo));
    }

    [Fact]
    public async Task WhenTheQuoteProviderIsDownDuringAnImport_ShouldKeepTheSymbolAsAManualSecurityWithAWarning()
    {
        var (client, _) = await factory.NewAccountAsync();
        factory.Quotes.Failures["OFFLINEX"] = new HttpRequestException("provider is down");
        try
        {
            var result = await Import(client, File(Portfolio("Offline", [Buy("OFFLINEX", name: "")]))).ReadAsync<ImportResultDto>();

            result.Warnings.ShouldHaveSingleItem().ShouldStartWith("OFFLINEX could not be quoted; it was added with a manual price. ");
        }
        finally
        {
            factory.Quotes.Failures.TryRemove("OFFLINEX", out _);
        }

        var id = (await client.GetJsonAsync<List<PortfolioSummaryDto>>("/api/portfolios")).Single().Id;
        var holding = (await client.DetailAsync(id)).Holdings.ShouldHaveSingleItem();
        (holding.Symbol, holding.Name).ShouldBe(("OFFLINEX", "OFFLINEX"));
    }

    [Fact]
    public async Task WhenAManuallyPricedSymbolIsImported_ShouldUseMineOrCreateItWithTheFilesName()
    {
        var (client, _) = await factory.NewAccountAsync();
        var mine = await (await client.PostJsonAsync("/api/securities/manual", new ManualSecurityRequest("MYGIC", "My GIC", "CAD", AssetType.Other, 1m, null))).ReadAsync<SecurityDto>();

        var result = await Import(client, File(Portfolio("Manual", [Buy("MYGIC", "Manual", "Other name"), Buy("NEWGIC", "manual", "New GIC"), Buy("NONAME", "Manual", "  ")]))).ReadAsync<ImportResultDto>();

        result.Warnings.ShouldBeEmpty();
        var id = (await client.GetJsonAsync<List<PortfolioSummaryDto>>("/api/portfolios")).Single().Id;
        var holdings = (await client.DetailAsync(id)).Holdings.ToDictionary(h => h.Symbol);
        holdings["MYGIC"].SecurityId.ShouldBe(mine.Id);
        holdings["NEWGIC"].Name.ShouldBe("New GIC");
        holdings["NONAME"].Name.ShouldBe("NONAME");
    }

    [Fact]
    public async Task WhenOnlyMyManualSecurityHasThatCode_ShouldBeUsedForAQuotedLookingRow()
    {
        var (client, _) = await factory.NewAccountAsync();
        var mine = await (await client.PostJsonAsync("/api/securities/manual", new ManualSecurityRequest("ONLYMINE", "Only mine", "CAD", AssetType.Other, 1m, null))).ReadAsync<SecurityDto>();

        await Import(client, File(Portfolio("Mine", [Buy("ONLYMINE", "Yahoo")]))).ReadAsync<ImportResultDto>();

        var id = (await client.GetJsonAsync<List<PortfolioSummaryDto>>("/api/portfolios")).Single().Id;
        (await client.DetailAsync(id)).Holdings.ShouldHaveSingleItem().SecurityId.ShouldBe(mine.Id);
    }

    [Fact]
    public async Task WhenALedgerInTheFileDoesNotAddUp_ShouldNameThePortfolioAndImportNothingFromTheFile()
    {
        var (client, _) = await factory.NewAccountAsync();
        var sell = Buy("SHOP.TO") with { Type = TransactionType.Sell };

        var response = await Import(client, File(Portfolio("Fine", [Deposit()]), Portfolio("Broken", [sell])));

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "\"Broken\" doesn't add up: Cannot sell 1 shares on 2026-03-02: only 0 held.");
        (await client.GetJsonAsync<List<PortfolioSummaryDto>>("/api/portfolios")).ShouldBeEmpty();
    }
}
