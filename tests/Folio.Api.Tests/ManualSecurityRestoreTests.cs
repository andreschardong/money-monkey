using System.Net;
using Folio.Api.Data;
using Folio.Api.Endpoints;
using Folio.Core;
using Microsoft.EntityFrameworkCore;

namespace Folio.Api.Tests;

/// <summary>An export carries what was typed by hand (a property's valuations, its kind), so a restore values it as before.</summary>
[Collection(FolioApiCollection.Name)]
public class ManualSecurityRestoreTests(FolioApiFactory factory)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static readonly DateOnly Bought = new(2020, 6, 15);

    private static ExportPortfolioDto Portfolio(string name, params ExportTransactionDto[] transactions) =>
        new(Guid.NewGuid(), name, "CAD", null, DateTimeOffset.UtcNow, transactions, []);

    private static ExportTransactionDto ManualBuy(string symbol, decimal price = 100m) =>
        new(Bought, TransactionType.Buy, symbol, "Typed by hand", nameof(PriceSource.Manual), "CAD", 1m, price, 0m, 0m, 1m, 0m, 0m, null);

    private static string NewSymbol() => $"M{Guid.NewGuid():N}"[..12].ToUpperInvariant();

    [Fact]
    public async Task WhenAPropertyIsExportedAndImported_ShouldKeepItsValueAndKind()
    {
        var (source, _) = await factory.NewAccountAsync();
        var homes = await source.CreatePortfolioAsync("Homes", kind: PortfolioKind.RealEstate);
        var name = $"H{Guid.NewGuid():N}"[..10];
        (await source.PostJsonAsync($"/api/portfolios/{homes}/properties",
            new PropertyRequest(name, "12 Lake Road", Bought, 400_000m, 12_000m, 520_000m))).EnsureSuccessStatusCode();

        var export = await source.GetJsonAsync<ExportDto>("/api/export");

        var saved = export.ManualSecurities.ShouldNotBeNull().ShouldHaveSingleItem();
        (saved.Symbol, saved.AssetType, saved.Currency).ShouldBe((name.ToUpperInvariant(), AssetType.RealEstate, "CAD"));
        saved.Prices.ShouldBe([new PricePointDto(Bought, 400_000m), new PricePointDto(ApiClient.Today, 520_000m)]);

        var (target, _) = await factory.NewAccountAsync();
        (await target.PostJsonAsync("/api/import", export)).EnsureSuccessStatusCode();
        var copy = (await target.GetJsonAsync<List<PortfolioSummaryDto>>("/api/portfolios")).ShouldHaveSingleItem();
        var holding = (await target.DetailAsync(copy.Id)).Holdings.ShouldHaveSingleItem();
        (holding.AssetType, holding.Price, holding.PriceDate, holding.MarketValue, holding.CostBasis)
            .ShouldBe((AssetType.RealEstate, 520_000m, ApiClient.Today, 520_000m, 412_000m));
    }

    [Fact]
    public async Task WhenAFileFromBeforeManualSecuritiesWereSavedIsImported_ShouldCarryThemAtCostAsOther()
    {
        var (client, _) = await factory.NewAccountAsync();
        var symbol = NewSymbol();

        (await client.PostJsonAsync("/api/import", new ExportDto(DateTimeOffset.UtcNow, [Portfolio("Old file", ManualBuy(symbol, 250m))]))).EnsureSuccessStatusCode();

        var portfolio = (await client.GetJsonAsync<List<PortfolioSummaryDto>>("/api/portfolios")).ShouldHaveSingleItem();
        var holding = (await client.DetailAsync(portfolio.Id)).Holdings.ShouldHaveSingleItem();
        (holding.AssetType, holding.Price, holding.MarketValue).ShouldBe((AssetType.Other, null, 250m));
    }

    [Fact]
    public async Task WhenASavedSecurityHasAnUnknownKindOrNoPrices_ShouldImportItAsOtherAtCost()
    {
        var (client, _) = await factory.NewAccountAsync();
        var symbol = NewSymbol();
        var file = new ExportDto(DateTimeOffset.UtcNow, [Portfolio("Odd", ManualBuy(symbol, 75m))],
            [new ExportSecurityDto(symbol.ToLowerInvariant(), "Odd", "CAD", (AssetType)99, null!)]);

        (await client.PostJsonAsync("/api/import", file)).EnsureSuccessStatusCode();

        var portfolio = (await client.GetJsonAsync<List<PortfolioSummaryDto>>("/api/portfolios")).ShouldHaveSingleItem();
        var holding = (await client.DetailAsync(portfolio.Id)).Holdings.ShouldHaveSingleItem();
        (holding.AssetType, holding.Price, holding.MarketValue).ShouldBe((AssetType.Other, null, 75m));
    }

    [Theory]
    [InlineData(" ", 10, "needs a symbol and prices greater than zero")]
    [InlineData("GOOD", 0, "needs a symbol and prices greater than zero")]
    public async Task WhenASavedSecurityIsMalformed_ShouldRefuseTheFile(string symbol, int close, string message)
    {
        var (client, _) = await factory.NewAccountAsync();
        var file = new ExportDto(DateTimeOffset.UtcNow, [Portfolio("Bad")],
            [new ExportSecurityDto(symbol, "Bad", "CAD", AssetType.Fund, [new PricePointDto(Bought, close)])]);

        await (await client.PostJsonAsync("/api/import", file)).ShouldBeProblemAsync(HttpStatusCode.BadRequest, message);
    }

    [Fact]
    public async Task WhenAFileHasTooManyHandEnteredPrices_ShouldRefuseIt()
    {
        var (client, _) = await factory.NewAccountAsync();
        var prices = Enumerable.Range(0, 100_001).Select(i => new PricePointDto(new DateOnly(1800, 1, 1).AddDays(i), 1m)).ToList();
        var file = new ExportDto(DateTimeOffset.UtcNow, [Portfolio("Big")], [new ExportSecurityDto("BIG", "Big", "CAD", AssetType.Fund, prices)]);

        await (await client.PostJsonAsync("/api/import", file)).ShouldBeProblemAsync(HttpStatusCode.BadRequest, "hand-entered prices");
    }

    [Fact]
    public async Task WhenAFileHasTooManyManualSecurities_ShouldRefuseIt()
    {
        var (client, _) = await factory.NewAccountAsync();
        var many = Enumerable.Range(0, 501).Select(i => new ExportSecurityDto($"S{i}", "S", "CAD", AssetType.Fund, [])).ToList();

        await (await client.PostJsonAsync("/api/import", new ExportDto(DateTimeOffset.UtcNow, [Portfolio("Many")], many)))
            .ShouldBeProblemAsync(HttpStatusCode.BadRequest, "manual securities");
    }

    [Fact]
    public async Task WhenAFileIsRefusedHalfwayThrough_ShouldLeaveNoSecurityOrPriceBehind()
    {
        var (client, _) = await factory.NewAccountAsync();
        var symbol = NewSymbol();
        var broken = Portfolio("Broken") with { BaseCurrency = "XXX" };
        var file = new ExportDto(DateTimeOffset.UtcNow, [Portfolio("Fine", ManualBuy(symbol)), broken],
            [new ExportSecurityDto(symbol, "Kept?", "CAD", AssetType.Fund, [new PricePointDto(Bought, 120m)])]);

        await (await client.PostJsonAsync("/api/import", file)).ShouldBeProblemAsync(HttpStatusCode.BadRequest, "needs a name and a currency");

        (await client.GetJsonAsync<List<PortfolioSummaryDto>>("/api/portfolios")).ShouldBeEmpty();
        (await factory.WithDbAsync(db => db.Securities.IgnoreQueryFilters().AnyAsync(s => s.Symbol == symbol, Ct))).ShouldBeFalse();
    }
}
