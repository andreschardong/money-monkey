using System.Net;
using Folio.Api.Data;
using Folio.Api.Endpoints;
using Folio.Core;
using Microsoft.EntityFrameworkCore;

namespace Folio.Api.Tests;

[Collection(FolioApiCollection.Name)]
public class OverviewAndAssetsTests(FolioApiFactory factory)
{
    private static DateOnly Today => ApiClient.Today;

    private async Task<Guid> HoldAsync(HttpClient client, Guid portfolio, Security security, decimal quantity = 1m, decimal price = 100m, string date = "2026-02-02") =>
        (await client.AddAsync(portfolio, new TransactionRequest(TransactionType.Buy, DateOnly.Parse(date), SecurityId: security.Id, Quantity: quantity, Price: price))).Id;

    [Theory]
    [InlineData("/api/overview?currency=GBP")]
    [InlineData("/api/overview/history?currency=GBP")]
    [InlineData("/api/assets?currency=GBP")]
    public async Task WhenTheDisplayCurrencyIsNotOneOfTheThree_ShouldRefuseIt(string url)
    {
        var (client, _) = await factory.NewAccountAsync();

        await (await client.GetResponseAsync(url)).ShouldBeProblemAsync(HttpStatusCode.BadRequest, "The display currency must be CAD, USD or EUR.");
    }

    [Fact]
    public async Task WhenNothingIsHeld_ShouldBeAllZeroWithNoReturnAndNoSlices()
    {
        var (client, _) = await factory.NewAccountAsync();

        var overview = await client.GetJsonAsync<OverviewDto>("/api/overview");
        var assets = await client.GetJsonAsync<AssetsDto>("/api/assets");

        (overview.Currency, overview.TotalValue, overview.TotalReturn, overview.TotalReturnPercent, overview.DayChangePercent, overview.PricesAsOf)
            .ShouldBe(("CAD", 0m, null, null, null, null));
        overview.Portfolios.ShouldBeEmpty();
        overview.ByCurrency.ShouldBeEmpty();
        (assets.TotalValue, assets.DayChangePercent, assets.UnrealizedGainPercent, assets.PortfolioCount).ShouldBe((0m, null, null, 0));
        assets.Holdings.ShouldBeEmpty();
        assets.Cash.ShouldBeEmpty();
    }

    [Fact]
    public async Task WhenPortfoliosHoldEveryKindOfAsset_ShouldLabelTheAllocationsAndRankThem()
    {
        var (client, _) = await factory.NewAccountAsync();
        var investing = await client.CreatePortfolioAsync("Investing", country: "CA");
        var homes = await client.CreatePortfolioAsync("Homes", kind: PortfolioKind.RealEstate);
        foreach (var (type, value) in new[] { (AssetType.Stock, 500m), (AssetType.Etf, 400m), (AssetType.Fund, 300m), (AssetType.Crypto, 200m), (AssetType.Other, 100m) })
        {
            var security = await factory.SeedSecurityAsync(assetType: type);
            await HoldAsync(client, investing, security, 1, value);
            await factory.SeedPricesAsync(security.Id, (new DateOnly(2026, 10, 8), value));
        }

        var house = await factory.SeedSecurityAsync(assetType: AssetType.RealEstate);
        await HoldAsync(client, homes, house, 1, 900m);
        await factory.SeedPricesAsync(house.Id, (new DateOnly(2026, 10, 8), 900m));
        (await client.PutJsonAsync($"/api/portfolios/{investing}/cash", new SetCashRequest("CAD", 50m, null, null))).EnsureSuccessStatusCode();
        (await client.PutJsonAsync($"/api/portfolios/{homes}/cash", new SetCashRequest("USD", -20m, null, null))).EnsureSuccessStatusCode();

        var overview = await client.GetJsonAsync<OverviewDto>("/api/overview");

        overview.ByAssetType.Select(s => s.Label).ShouldBe(["Real estate", "Stocks", "ETFs", "Funds", "Crypto", "Other", "Cash"]);
        overview.ByAssetType.Sum(s => s.Weight).ShouldBeInRange(0.999m, 1.001m);
        overview.ByAssetType.First().Key.ShouldBe("RealEstate");
        overview.ByCountry.Select(s => s.Label).ShouldBe(["CA", "Not set"]);
        overview.ByCurrency.ShouldNotContain(s => s.Key == "USD");   // negative balances are left out of the charts
        overview.CashValue.ShouldBe(22m);
        overview.TotalValue.ShouldBe(900m + 1500m + 50m - 28m);
        overview.Movers.ShouldBeEmpty();
    }

    [Fact]
    public async Task WhenRealEstateIsExcluded_ShouldCountOnlyTheOtherPortfoliosInOverviewAndHistory()
    {
        var (client, _) = await factory.NewAccountAsync();
        var investing = await client.CreatePortfolioAsync("Investing");
        var homes = await client.CreatePortfolioAsync("Homes", kind: PortfolioKind.RealEstate);
        await client.DepositAsync(investing, 100m);
        await client.DepositAsync(homes, 1_000m);

        var all = await client.GetJsonAsync<OverviewDto>("/api/overview");
        var liquid = await client.GetJsonAsync<OverviewDto>("/api/overview?excludeRealEstate=true");
        var history = await client.GetJsonAsync<HistoryDto>("/api/overview/history?range=ALL&excludeRealEstate=true");
        var allHistory = await client.GetJsonAsync<HistoryDto>("/api/overview/history?range=ALL");

        all.Portfolios.Count.ShouldBe(2);
        liquid.Portfolios.ShouldHaveSingleItem().Id.ShouldBe(investing);
        (all.NetContributions, liquid.NetContributions).ShouldBe((1_100m, 100m));
        history.Points.Last().NetContributions.ShouldBe(100m);
        allHistory.Points.Last().NetContributions.ShouldBe(1_100m);
    }

    [Fact]
    public async Task WhenPortfoliosHaveDifferentPriceDates_ShouldReportTheNewestAndSkipPortfoliosWithoutPrices()
    {
        var (client, _) = await factory.NewAccountAsync();
        await client.CreatePortfolioAsync("Empty first");
        var oldest = await client.CreatePortfolioAsync("Old");
        var newest = await client.CreatePortfolioAsync("New");
        var older = await client.CreatePortfolioAsync("Older again");
        var oldSecurity = await factory.SeedSecurityAsync();
        var newSecurity = await factory.SeedSecurityAsync();
        var olderSecurity = await factory.SeedSecurityAsync();
        await HoldAsync(client, oldest, oldSecurity);
        await HoldAsync(client, newest, newSecurity);
        await HoldAsync(client, older, olderSecurity);
        await factory.SeedPricesAsync(oldSecurity.Id, (new DateOnly(2026, 9, 1), 100m));
        await factory.SeedPricesAsync(newSecurity.Id, (new DateOnly(2026, 10, 7), 100m));
        await factory.SeedPricesAsync(olderSecurity.Id, (new DateOnly(2026, 8, 1), 100m));

        var overview = await client.GetJsonAsync<OverviewDto>("/api/overview");
        var assets = await client.GetJsonAsync<AssetsDto>("/api/assets");

        overview.PricesAsOf.ShouldBe(new DateOnly(2026, 10, 7));
        assets.PricesAsOf.ShouldBe(new DateOnly(2026, 10, 7));
    }

    [Fact]
    public async Task WhenOnlyWithdrawalsWereRecorded_ShouldShowAReturnWithoutAPercentage()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Drawn down");
        await client.AddAsync(portfolio, new TransactionRequest(TransactionType.Withdrawal, new DateOnly(2026, 2, 2), Amount: 50m));

        var overview = await client.GetJsonAsync<OverviewDto>("/api/overview");

        overview.TotalReturn.ShouldBe(50m);
        overview.TotalReturnPercent.ShouldBeNull();
        overview.Portfolios.ShouldHaveSingleItem().TotalReturnPercent.ShouldBeNull();
    }

    [Fact]
    public async Task WhenDepositsAndWithdrawalsCancelOut_ShouldHaveNoReturnYet()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Even");
        await client.DepositAsync(portfolio, 50m);
        await client.AddAsync(portfolio, new TransactionRequest(TransactionType.Withdrawal, new DateOnly(2026, 2, 2), Amount: 50m));

        var overview = await client.GetJsonAsync<OverviewDto>("/api/overview");

        overview.TotalReturn.ShouldBeNull();
        overview.Portfolios.ShouldHaveSingleItem().TotalReturnInDisplay.ShouldBeNull();
    }

    [Fact]
    public async Task WhenAHoldingMovedInTheLastSession_ShouldRankTheBiggestMoversFirst()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Movers");
        await client.BuyAsync(portfolio, "SHOP.TO", 1, 90m);
        await client.BuyAsync(portfolio, "AAPL", 1, 150m);

        var overview = await client.GetJsonAsync<OverviewDto>("/api/overview");

        overview.Movers.Select(m => m.Symbol).ShouldBe(["SHOP.TO", "AAPL"], ignoreOrder: true);
        overview.Movers.ShouldAllBe(m => m.DayChangePercent == 0.01m);
        overview.DayChangePercent.ShouldNotBeNull();
        overview.DayChange.ShouldBeGreaterThan(0m);
    }

    [Fact]
    public async Task WhenARateIsMissing_ShouldWarnInOverviewAssetsAndThePortfolioAndCountTheAmountOneToOne()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Pounds");
        (await client.PutJsonAsync($"/api/portfolios/{portfolio}/cash", new SetCashRequest("GBP", 100m, null, null))).EnsureSuccessStatusCode();

        var overview = await client.GetJsonAsync<OverviewDto>("/api/overview");
        var assets = await client.GetJsonAsync<AssetsDto>("/api/assets");
        var detail = await client.DetailAsync(portfolio);

        overview.CashValue.ShouldBe(100m);
        overview.Warnings.ShouldContain("Pounds: no GBP exchange rate yet, counted 1:1.");
        assets.Warnings.ShouldContain("Pounds: no GBP exchange rate yet, counted 1:1.");
        detail.Warnings.ShouldContain("No GBP exchange rate has been downloaded yet, so GBP amounts are counted 1:1 in CAD until the next refresh.");
    }

    [Fact]
    public async Task WhenAPortfolioIsInAnotherCurrencyWithoutRates_ShouldWarnAboutTheConversionToTheDisplayCurrency()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Euros", "EUR");
        await client.DepositAsync(portfolio, 10m);
        (await client.PutJsonAsync($"/api/portfolios/{portfolio}/cash", new SetCashRequest("EUR", 10m, null, null))).EnsureSuccessStatusCode();
        await factory.WithDbAsync(db => db.FxRates.Where(r => r.Currency == "EUR").ExecuteDeleteAsync(TestContext.Current.CancellationToken));
        factory.Fx.Failure = new HttpRequestException("rates are down");
        try
        {
            var overview = await client.GetJsonAsync<OverviewDto>("/api/overview");
            var assets = await client.GetJsonAsync<AssetsDto>("/api/assets");

            overview.Warnings.ShouldContain("No EUR to CAD exchange rate yet; EUR amounts are counted 1:1.");
            assets.Warnings.ShouldContain("No EUR to CAD exchange rate yet; EUR amounts are counted 1:1.");
        }
        finally
        {
            factory.Fx.Failure = null;
        }
    }

    [Fact]
    public async Task WhenHoldingsAreInSeveralPortfolios_ShouldMergeThemPerSecurityWithTheirSlicesAndSortedCash()
    {
        var (client, _) = await factory.NewAccountAsync();
        var big = await client.CreatePortfolioAsync("Big");
        var small = await client.CreatePortfolioAsync("Small", "USD");
        var zeroCost = await client.CreatePortfolioAsync("Gifts");
        await client.BuyAsync(big, "SHOP.TO", 10, 90m);
        await client.BuyAsync(small, "SHOP.TO", 1, 90m);
        var shop = await client.ResolveAsync("SHOP.TO");
        await client.AddAsync(zeroCost, new TransactionRequest(TransactionType.TransferIn, new DateOnly(2026, 2, 2), Symbol: "AAPL", Quantity: 1, Price: 0m));
        (await client.PutJsonAsync($"/api/portfolios/{big}/cash", new SetCashRequest("USD", 10m, null, null))).EnsureSuccessStatusCode();
        (await client.PutJsonAsync($"/api/portfolios/{big}/cash", new SetCashRequest("CAD", 25m, null, null))).EnsureSuccessStatusCode();
        (await client.PutJsonAsync($"/api/portfolios/{small}/cash", new SetCashRequest("USD", 5m, null, null))).EnsureSuccessStatusCode();

        var assets = await client.GetJsonAsync<AssetsDto>("/api/assets");

        assets.PortfolioCount.ShouldBe(3);
        var shopHolding = assets.Holdings.Single(h => h.Symbol == "SHOP.TO");
        shopHolding.SecurityId.ShouldBe(shop.Id);
        shopHolding.Quantity.ShouldBe(11m);
        shopHolding.Portfolios.Select(s => s.PortfolioName).ShouldBe(["Big", "Small"]);
        shopHolding.UnrealizedGainPercent.ShouldNotBeNull();
        var gift = assets.Holdings.Single(h => h.Symbol == "AAPL");
        (gift.CostBasis, gift.UnrealizedGainPercent).ShouldBe((0m, null));
        assets.Cash.Select(c => c.Currency).ShouldBe(["CAD", "USD"]);
        assets.Cash.Single(c => c.Currency == "USD").Balance.ShouldBe(15m);
        assets.Cash.Single(c => c.Currency == "USD").Portfolios.Count.ShouldBe(2);
        assets.Holdings.Sum(h => h.Weight).ShouldBeLessThan(1m);
        assets.UnrealizedGainPercent.ShouldNotBeNull();
        assets.DayChangeDate.ShouldBe(Today);
    }

    [Fact]
    public async Task WhenAHoldingHasNoPrice_ShouldFlagItAndCarryItAtCost()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Unpriced");
        var security = await factory.SeedSecurityAsync();
        await HoldAsync(client, portfolio, security, 2, 50m);

        var assets = await client.GetJsonAsync<AssetsDto>("/api/assets");
        var detail = await client.DetailAsync(portfolio);

        var holding = assets.Holdings.ShouldHaveSingleItem();
        (holding.PriceMissing, holding.Price, holding.MarketValue, holding.CostBasis).ShouldBe((true, null, 100m, 100m));
        detail.Warnings.ShouldContain($"No price is available for {security.Symbol} yet, so it is shown at cost.");
    }

    [Fact]
    public async Task WhenAViewerLooksAtSharedPortfolios_ShouldIncludeThemWithTheOwnersAddress()
    {
        var (owner, ownerEmail) = await factory.NewAccountAsync();
        var (viewer, viewerEmail) = await factory.NewAccountAsync();
        var portfolio = await owner.CreatePortfolioAsync("Shared");
        await owner.DepositAsync(portfolio, 100m);
        await owner.ShareWithAsync(portfolio, viewerEmail, canEdit: false);

        var overview = await viewer.GetJsonAsync<OverviewDto>("/api/overview");

        var entry = overview.Portfolios.ShouldHaveSingleItem();
        (entry.Access, entry.OwnerEmail).ShouldBe(("View", ownerEmail));
    }

    [Fact]
    public async Task WhenHistoryIsRequestedInAnotherCurrency_ShouldConvertEachDayAtItsOwnRate()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Usd", "USD");
        await client.DepositAsync(portfolio, 100m, "2025-12-01");

        var inCad = await client.GetJsonAsync<HistoryDto>("/api/overview/history?range=ALL&currency=cad");
        var inEur = await client.GetJsonAsync<HistoryDto>("/api/overview/history?range=ALL&currency=EUR");

        inCad.Currency.ShouldBe("CAD");
        inCad.Points.First().NetContributions.ShouldBe(130m);
        inEur.Points.First().NetContributions.ShouldBe(86.6667m);
    }
}
