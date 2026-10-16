using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Folio.Api.Data;
using Folio.Api.Endpoints;
using Folio.Core;
using Microsoft.AspNetCore.Mvc;

namespace Folio.Api.Tests;

public class PortfolioApiTests(FolioApiFactory factory) : IClassFixture<FolioApiFactory>, IAsyncLifetime
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

    private HttpClient _client = null!;

    public async ValueTask InitializeAsync() => _client = await factory.CreateSignedInClientAsync();

    public ValueTask DisposeAsync()
    {
        _client.Dispose();
        return ValueTask.CompletedTask;
    }

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task A_deposit_and_a_buy_are_valued_at_the_latest_close()
    {
        var portfolio = await CreatePortfolioAsync("CAD");
        await AddAsync(portfolio, new TransactionRequest(TransactionType.Deposit, D("2026-01-05"), Amount: 10_000m));
        await AddAsync(portfolio, new TransactionRequest(TransactionType.Buy, D("2026-01-06"), Symbol: "shop.to", Quantity: 10, Price: 100m, Fee: 5m));
        await SetCashAsync(portfolio, "CAD", 8_995m);

        var detail = await GetAsync<PortfolioDetailDto>($"/api/portfolios/{portfolio}");
        var holding = Assert.Single(detail.Holdings);

        Assert.Equal("SHOP.TO", holding.Symbol);
        Assert.Equal(101m, holding.Price);
        Assert.Equal(1_010m, holding.MarketValue);
        Assert.Equal(1_005m, holding.CostBasis);
        Assert.Equal(10m, holding.DayChange);
        Assert.Equal(8_995m, Assert.Single(detail.Cash).Balance);
        Assert.Equal(10_005m, detail.Summary.TotalValue);
        Assert.Equal(5m, detail.Summary.TotalReturn);
        Assert.Empty(detail.Warnings);
    }

    [Fact]
    public async Task A_us_stock_in_a_cad_portfolio_gets_the_days_exchange_rate()
    {
        var portfolio = await CreatePortfolioAsync("CAD");
        await AddAsync(portfolio, new TransactionRequest(TransactionType.Deposit, D("2026-02-02"), Amount: 1_400m));
        await SetCashAsync(portfolio, "USD", 1_000m, D("2026-02-02"));
        var buy = await AddAsync(portfolio, new TransactionRequest(TransactionType.Buy, D("2026-02-03"), Symbol: "AAPL", Quantity: 5, Price: 200m));

        Assert.Equal("USD", buy.Currency);
        Assert.Equal(1.40m, buy.FxRate);

        // The buy did not touch the entered cash; it stays what the statement said.
        var detail = await GetAsync<PortfolioDetailDto>($"/api/portfolios/{portfolio}");
        Assert.Equal(5m * 202m * 1.40m, Assert.Single(detail.Holdings).MarketValue);
        var usd = Assert.Single(detail.Cash);
        Assert.Equal((1_000m, 1_400m, D("2026-02-02")), (usd.Balance, usd.Value, usd.AsOf));
        Assert.Equal(1_400m, detail.Summary.NetContributions);
    }

    [Fact]
    public async Task Selling_more_than_is_held_is_refused_with_a_reason()
    {
        var portfolio = await CreatePortfolioAsync("CAD");
        await AddAsync(portfolio, new TransactionRequest(TransactionType.Buy, D("2026-03-02"), Symbol: "SHOP.TO", Quantity: 3, Price: 100m));

        var problem = await AddExpectingProblemAsync(portfolio, new TransactionRequest(TransactionType.Sell, D("2026-03-03"), Symbol: "SHOP.TO", Quantity: 4, Price: 100m));
        Assert.Contains("only 3 held", problem.Detail);
    }

    [Fact]
    public async Task Deleting_a_buy_that_a_later_sell_needs_is_refused()
    {
        var portfolio = await CreatePortfolioAsync("CAD");
        var buy = await AddAsync(portfolio, new TransactionRequest(TransactionType.Buy, D("2026-03-02"), Symbol: "SHOP.TO", Quantity: 3, Price: 100m));
        await AddAsync(portfolio, new TransactionRequest(TransactionType.Sell, D("2026-04-01"), Symbol: "SHOP.TO", Quantity: 2, Price: 100m));

        var response = await _client.DeleteAsync($"/api/portfolios/{portfolio}/transactions/{buy.Id}", Ct);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ProblemDetails>(Json, Ct);
        Assert.Contains("sell on 2026-04-01", problem!.Detail);
    }

    [Fact]
    public async Task An_unrecorded_split_is_suggested_and_recording_it_restores_the_value()
    {
        var portfolio = await CreatePortfolioAsync("USD");
        await AddAsync(portfolio, new TransactionRequest(TransactionType.Buy, D("2026-05-04"), Symbol: "SPLT", Quantity: 10, Price: 100m));

        var suggestion = Assert.Single(await GetAsync<List<SuggestionDto>>($"/api/portfolios/{portfolio}/suggestions"));
        Assert.Equal(CorporateActionKind.Split, suggestion.Kind);
        Assert.Equal(FakeQuoteProvider.SplitDate, suggestion.Date);
        Assert.Equal((1m, 2m), (suggestion.SplitFrom, suggestion.SplitTo));

        var before = await GetAsync<PortfolioDetailDto>($"/api/portfolios/{portfolio}");
        Assert.Equal(505m, before.Summary.HoldingsValue);   // 10 old shares at the new price: looks like a halving

        await AddAsync(portfolio, new TransactionRequest(TransactionType.Split, suggestion.Date, SecurityId: suggestion.SecurityId,
            SplitFrom: suggestion.SplitFrom, SplitTo: suggestion.SplitTo));

        var after = await GetAsync<PortfolioDetailDto>($"/api/portfolios/{portfolio}");
        Assert.Equal(20m, Assert.Single(after.Holdings).Quantity);
        Assert.Equal(1_010m, after.Summary.HoldingsValue);
        Assert.Empty(await GetAsync<List<SuggestionDto>>($"/api/portfolios/{portfolio}/suggestions"));

        // The chart is continuous across the split: 10 x 100 on Friday and 20 x 50 on Monday.
        var history = await GetAsync<HistoryDto>($"/api/portfolios/{portfolio}/history?range=ALL");
        Assert.Equal(1_000m, history.Points.Single(p => p.Date == D("2026-05-29")).Value);
        Assert.Equal(1_000m, history.Points.Single(p => p.Date == D("2026-06-01")).Value);
        Assert.Equal(after.Summary.TotalValue, history.Points[^1].Value);
    }

    [Fact]
    public async Task A_dismissed_suggestion_stays_hidden()
    {
        var portfolio = await CreatePortfolioAsync("USD");
        await AddAsync(portfolio, new TransactionRequest(TransactionType.Buy, D("2026-05-04"), Symbol: "SPLT", Quantity: 1, Price: 100m));
        var suggestion = Assert.Single(await GetAsync<List<SuggestionDto>>($"/api/portfolios/{portfolio}/suggestions"));

        var response = await _client.PostAsJsonAsync($"/api/portfolios/{portfolio}/suggestions/dismiss",
            new DismissSuggestionRequest(suggestion.SecurityId, suggestion.Date, suggestion.Kind), Json, Ct);
        response.EnsureSuccessStatusCode();

        Assert.Empty(await GetAsync<List<SuggestionDto>>($"/api/portfolios/{portfolio}/suggestions"));
    }

    [Fact]
    public async Task The_overview_converts_every_portfolio_into_the_display_currency()
    {
        var cad = await CreatePortfolioAsync("CAD");
        await AddAsync(cad, new TransactionRequest(TransactionType.Deposit, D("2026-07-02"), Amount: 700m));
        await SetCashAsync(cad, "CAD", 700m);
        var usd = await CreatePortfolioAsync("USD");
        await AddAsync(usd, new TransactionRequest(TransactionType.Deposit, D("2026-07-02"), Amount: 500m));
        await SetCashAsync(usd, "USD", 500m);

        var overview = await GetAsync<OverviewDto>("/api/overview?currency=USD");
        var mine = overview.Portfolios.Where(p => p.Id == cad || p.Id == usd).ToDictionary(p => p.Id);

        Assert.Equal(500m, mine[cad].ValueInDisplay);
        Assert.Equal(500m, mine[usd].ValueInDisplay);
        Assert.Equal(overview.Portfolios.Sum(p => p.ValueInDisplay), overview.TotalValue, 2);
    }

    [Fact]
    public async Task The_overview_counts_currency_gains_on_deposits_made_at_an_older_rate()
    {
        var usd = await CreatePortfolioAsync("USD");
        await AddAsync(usd, new TransactionRequest(TransactionType.Deposit, D("2025-06-02"), Amount: 1_000m));
        await SetCashAsync(usd, "USD", 1_000m, D("2025-06-02"));

        var overview = await GetAsync<OverviewDto>("/api/overview?currency=CAD");
        var row = overview.Portfolios.Single(p => p.Id == usd);

        // Deposited when US$1 was C$1.30, worth C$1.40 today: C$100 of return in Canadian dollars.
        Assert.Equal(1_400m, row.ValueInDisplay);
        Assert.Equal(100m, row.TotalReturnInDisplay);
        Assert.Equal(100m / 1_300m, row.TotalReturnPercent!.Value, 5);

        // The portfolio's own view, in US dollars, has no gain at all.
        var detail = await GetAsync<PortfolioDetailDto>($"/api/portfolios/{usd}");
        Assert.Equal(0m, detail.Summary.TotalReturn);
    }

    [Fact]
    public async Task Cash_balances_are_entered_directly_and_dated()
    {
        var portfolio = await CreatePortfolioAsync("CAD");
        await SetCashAsync(portfolio, "CAD", 500m, D("2026-09-01"));
        await SetCashAsync(portfolio, "CAD", 750m, D("2026-10-01"));
        await SetCashAsync(portfolio, "USD", 100m);

        var detail = await GetAsync<PortfolioDetailDto>($"/api/portfolios/{portfolio}");
        Assert.Equal(750m, detail.Cash.Single(c => c.Currency == "CAD").Balance);
        Assert.Equal(D("2026-10-01"), detail.Cash.Single(c => c.Currency == "CAD").AsOf);
        Assert.Equal(140m, detail.Cash.Single(c => c.Currency == "USD").Value);
        Assert.Equal(890m, detail.Summary.TotalValue);
        Assert.Null(detail.Summary.TotalReturn);   // nothing recorded as deposited yet

        // History follows the dated entries, and a wrong one can be removed.
        var history = await GetAsync<HistoryDto>($"/api/portfolios/{portfolio}/history?range=ALL");
        Assert.Equal(500m, history.Points.Single(p => p.Date == D("2026-09-15")).Value);
        Assert.Equal(3, (await GetAsync<List<CashEntryDto>>($"/api/portfolios/{portfolio}/cash")).Count);
        (await _client.DeleteAsync($"/api/portfolios/{portfolio}/cash/CAD/2026-09-01", Ct)).EnsureSuccessStatusCode();
        Assert.Equal(2, (await GetAsync<List<CashEntryDto>>($"/api/portfolios/{portfolio}/cash")).Count);
    }

    [Fact]
    public async Task All_assets_adds_up_the_same_holding_across_portfolios()
    {
        var cad = await CreatePortfolioAsync("CAD");
        var usd = await CreatePortfolioAsync("USD");
        await AddAsync(cad, new TransactionRequest(TransactionType.Buy, D("2026-03-02"), Symbol: "AAPL", Quantity: 10, Price: 200m));
        await AddAsync(usd, new TransactionRequest(TransactionType.Buy, D("2026-03-02"), Symbol: "AAPL", Quantity: 5, Price: 200m));
        await SetCashAsync(cad, "CAD", 1_400m);
        await SetCashAsync(usd, "CAD", 700m);

        var assets = await GetAsync<AssetsDto>("/api/assets?currency=CAD");

        Assert.Equal(2, assets.PortfolioCount);
        var aapl = Assert.Single(assets.Holdings);
        Assert.Equal(15m, aapl.Quantity);
        Assert.Equal(200m, aapl.AverageCost);                     // blended, in USD
        Assert.Equal(15m * 202m * 1.40m, aapl.MarketValue);       // in CAD
        Assert.Equal(15m * 202m, aapl.MarketValueLocal);
        Assert.Equal(4_200m, aapl.CostBasis);                     // 2,800 + 1,000 x 1.40
        Assert.Equal(42m, aapl.UnrealizedGain);
        Assert.Equal(2, aapl.Portfolios.Count);
        Assert.Equal(10m, aapl.Portfolios.Single(p => p.PortfolioId == cad).Quantity);

        var cash = Assert.Single(assets.Cash);
        Assert.Equal(("CAD", 2_100m, 2_100m), (cash.Currency, cash.Balance, cash.Value));
        Assert.Equal(aapl.MarketValue + 2_100m, assets.TotalValue);
        Assert.Equal(1m, aapl.Weight + cash.Weight, 3);
        Assert.Equal(42m, assets.UnrealizedGain);
    }

    [Fact]
    public async Task Today_counts_only_holdings_that_traded_in_the_latest_session()
    {
        var portfolio = await CreatePortfolioAsync("CAD");
        await AddAsync(portfolio, new TransactionRequest(TransactionType.Buy, D("2026-09-01"), Symbol: "SHOP.TO", Quantity: 10, Price: 100m));
        await AddAsync(portfolio, new TransactionRequest(TransactionType.Buy, D("2026-09-01"), Symbol: "HOLI.TO", Quantity: 10, Price: 50m));

        var detail = await GetAsync<PortfolioDetailDto>($"/api/portfolios/{portfolio}");
        Assert.Equal(FolioApiFactory.Today, detail.Summary.DayChangeDate);
        // SHOP.TO rose 1 % today; HOLI.TO's exchange was closed, so its 10 % move the day before doesn't count.
        Assert.Equal(10m, detail.Summary.DayChange);
        Assert.Equal(0m, detail.Holdings.Single(h => h.Symbol == "HOLI.TO").DayChange);

        var overview = await GetAsync<OverviewDto>("/api/overview?currency=CAD");
        Assert.Equal(FolioApiFactory.Today, overview.DayChangeDate);
        var assets = await GetAsync<AssetsDto>("/api/assets?currency=CAD");
        Assert.Equal(FolioApiFactory.Today, assets.DayChangeDate);
    }

    [Fact]
    public async Task The_export_carries_everything_the_account_entered()
    {
        var portfolio = await CreatePortfolioAsync("CAD");
        await AddAsync(portfolio, new TransactionRequest(TransactionType.Deposit, D("2026-01-05"), Amount: 1_000m, Note: "Opening, \"with quotes\""));
        await AddAsync(portfolio, new TransactionRequest(TransactionType.Buy, D("2026-01-06"), Symbol: "SHOP.TO", Quantity: 3, Price: 100m, Fee: 4.95m));
        await SetCashAsync(portfolio, "CAD", 690.05m);

        var export = await GetAsync<ExportDto>("/api/export");
        var mine = export.Portfolios.Single(p => p.Id == portfolio);
        Assert.Equal(2, mine.Transactions.Count);
        Assert.Equal("SHOP.TO", mine.Transactions[1].Symbol);
        Assert.Equal(690.05m, Assert.Single(mine.CashBalances).Balance);

        var response = await _client.GetAsync("/api/export/transactions.csv", Ct);
        response.EnsureSuccessStatusCode();
        Assert.Equal("text/csv", response.Content.Headers.ContentType!.MediaType);
        Assert.Contains("folio-transactions-", response.Content.Headers.ContentDisposition!.FileName);
        var csv = await response.Content.ReadAsStringAsync(Ct);
        Assert.StartsWith("﻿Portfolio,Date,Type,Symbol", csv);
        Assert.Contains("2026-01-06,Buy,SHOP.TO,Shopify Inc.,CAD,3,100,0,4.95,1,0,0,", csv);
        Assert.Contains("\"Opening, \"\"with quotes\"\"\"", csv);   // commas and quotes are escaped

        var holdings = await _client.GetStringAsync("/api/export/holdings.csv", Ct);
        Assert.Contains("SHOP.TO,Shopify Inc.,CAD,3,101.65", holdings);
        Assert.Contains("CASH,Cash CAD,CAD,690.05", holdings);
    }

    [Fact]
    public async Task The_currency_cannot_change_once_transactions_exist()
    {
        var portfolio = await CreatePortfolioAsync("CAD");
        var update = new UpdatePortfolioRequest("Renamed", "CAD", null);
        (await _client.PutAsJsonAsync($"/api/portfolios/{portfolio}", update, Json, Ct)).EnsureSuccessStatusCode();

        await AddAsync(portfolio, new TransactionRequest(TransactionType.Deposit, D("2026-07-02"), Amount: 1m));
        var response = await _client.PutAsJsonAsync($"/api/portfolios/{portfolio}", update with { BaseCurrency = "USD" }, Json, Ct);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task An_unknown_symbol_gets_a_readable_error()
    {
        var portfolio = await CreatePortfolioAsync("CAD");
        var problem = await AddExpectingProblemAsync(portfolio, new TransactionRequest(TransactionType.Buy, D("2026-03-02"), Symbol: "NOPE", Quantity: 1, Price: 1m));
        Assert.Contains("No quotes were found for \"NOPE\"", problem.Detail);
    }

    [Fact]
    public async Task A_manual_refresh_is_logged()
    {
        var portfolio = await CreatePortfolioAsync("CAD");
        await AddAsync(portfolio, new TransactionRequest(TransactionType.Buy, D("2026-03-02"), Symbol: "SHOP.TO", Quantity: 1, Price: 100m));

        var response = await _client.PostAsync("/api/market/refresh", null, Ct);
        Assert.True(response.StatusCode is HttpStatusCode.Accepted or HttpStatusCode.Conflict);

        MarketStatusDto status;
        var waited = 0;
        do
        {
            await Task.Delay(100, Ct);
            status = await GetAsync<MarketStatusDto>("/api/market/status");
        }
        while ((status.Running || status.LastRun is null) && (waited += 100) < 10_000);

        Assert.Equal(RefreshStatus.Succeeded, status.LastRun!.Status);
        Assert.Contains("SHOP.TO", status.LastRun.Log);
    }

    [Fact]
    public async Task A_portfolio_may_belong_to_a_country_and_the_overview_sums_by_country()
    {
        var created = await _client.PostAsJsonAsync("/api/portfolios", new CreatePortfolioRequest("TFSA", "CAD", null, " ca "), Json, Ct);
        created.EnsureSuccessStatusCode();
        var tfsa = (await created.Content.ReadFromJsonAsync<PortfolioSummaryDto>(Json, Ct))!;
        Assert.Equal("CA", tfsa.Country);
        var rrsp = await CreatePortfolioAsync("CAD");
        var usa = await _client.PostAsJsonAsync("/api/portfolios", new CreatePortfolioRequest("Brokerage", "USD", null, "US"), Json, Ct);
        usa.EnsureSuccessStatusCode();
        var brokerage = (await usa.Content.ReadFromJsonAsync<PortfolioSummaryDto>(Json, Ct))!.Id;
        await SetCashAsync(tfsa.Id, "CAD", 700m);
        await SetCashAsync(rrsp, "CAD", 300m);
        await SetCashAsync(brokerage, "USD", 500m);

        // The RRSP gets its country afterwards, through an edit.
        var renamed = await _client.PutAsJsonAsync($"/api/portfolios/{rrsp}", new UpdatePortfolioRequest("RRSP", "CAD", null, "CA"), Json, Ct);
        renamed.EnsureSuccessStatusCode();
        Assert.Equal("CA", (await renamed.Content.ReadFromJsonAsync<PortfolioSummaryDto>(Json, Ct))!.Country);

        var overview = await GetAsync<OverviewDto>("/api/overview?currency=CAD");
        var byCountry = overview.ByCountry.ToDictionary(a => a.Key);
        Assert.Equal(1_000m, byCountry["CA"].Value);
        Assert.Equal(700m, byCountry["US"].Value); // US$500 at 1.40
        Assert.Equal(1_000m / 1_700m, byCountry["CA"].Weight, 5);
        Assert.Equal("CA", overview.Portfolios.Single(p => p.Id == rrsp).Country);
        Assert.Equal("CA", (await GetAsync<ExportDto>("/api/export")).Portfolios.Single(p => p.Id == tfsa.Id).Country);

        // A portfolio without a country is summed as "Not set"; a name instead of a code is refused.
        var other = await CreatePortfolioAsync("CAD");
        await SetCashAsync(other, "CAD", 50m);
        overview = await GetAsync<OverviewDto>("/api/overview?currency=CAD");
        Assert.Equal(50m, overview.ByCountry.Single(a => a.Key == "").Value);
        Assert.Equal("Not set", overview.ByCountry.Single(a => a.Key == "").Label);
        var refused = await _client.PostAsJsonAsync("/api/portfolios", new CreatePortfolioRequest("Bad", "CAD", null, "Canada"), Json, Ct);
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
    }

    [Fact]
    public async Task A_real_estate_portfolio_can_be_left_out_of_the_overview()
    {
        var savings = await CreatePortfolioAsync("CAD");
        await SetCashAsync(savings, "CAD", 1_000m, D("2026-09-01"));
        var created = await _client.PostAsJsonAsync("/api/portfolios",
            new CreatePortfolioRequest("Apartment", "CAD", null, "BR", PortfolioKind.RealEstate), Json, Ct);
        created.EnsureSuccessStatusCode();
        var home = (await created.Content.ReadFromJsonAsync<PortfolioSummaryDto>(Json, Ct))!;
        Assert.Equal(PortfolioKind.RealEstate, home.Kind);
        var security = await _client.PostAsJsonAsync("/api/securities/manual",
            new ManualSecurityRequest("APT-SP", "Apartment in São Paulo", "CAD", AssetType.Other, 500_000m, D("2026-10-01")), Json, Ct);
        security.EnsureSuccessStatusCode();
        var apartment = (await security.Content.ReadFromJsonAsync<SecurityDto>(Json, Ct))!.Id;
        await AddAsync(home.Id, new TransactionRequest(TransactionType.Buy, D("2026-10-01"), SecurityId: apartment, Quantity: 1m, Price: 500_000m));

        var everything = await GetAsync<OverviewDto>("/api/overview?currency=CAD");
        Assert.Equal(501_000m, everything.TotalValue);
        Assert.Contains(everything.Portfolios, p => p.Id == home.Id && p.Kind == PortfolioKind.RealEstate);
        Assert.Equal(500_000m, everything.ByAssetType.Single(a => a.Key == "RealEstate").Value);
        Assert.Equal("Real estate", everything.ByAssetType.Single(a => a.Key == "RealEstate").Label);

        var liquid = await GetAsync<OverviewDto>("/api/overview?currency=CAD&excludeRealEstate=true");
        Assert.Equal(1_000m, liquid.TotalValue);
        Assert.DoesNotContain(liquid.Portfolios, p => p.Id == home.Id);
        Assert.DoesNotContain(liquid.ByAssetType, a => a.Key == "RealEstate");

        var history = await GetAsync<HistoryDto>("/api/overview/history?currency=CAD&range=1M&excludeRealEstate=true");
        Assert.Equal(1_000m, history.Points[^1].Value);
        Assert.Equal(PortfolioKind.RealEstate, (await GetAsync<ExportDto>("/api/export")).Portfolios.Single(p => p.Id == home.Id).Kind);
    }

    private static DateOnly D(string iso) => DateOnly.Parse(iso, System.Globalization.CultureInfo.InvariantCulture);

    private async Task<Guid> CreatePortfolioAsync(string currency)
    {
        var response = await _client.PostAsJsonAsync("/api/portfolios", new CreatePortfolioRequest($"Test {currency}", currency, null), Json, Ct);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<PortfolioSummaryDto>(Json, Ct))!.Id;
    }

    private async Task<TransactionDto> AddAsync(Guid portfolio, TransactionRequest request)
    {
        var response = await _client.PostAsJsonAsync($"/api/portfolios/{portfolio}/transactions", request, Json, Ct);
        if (!response.IsSuccessStatusCode)
            Assert.Fail($"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(Ct)}");
        return (await response.Content.ReadFromJsonAsync<List<TransactionDto>>(Json, Ct))![^1];
    }

    private async Task SetCashAsync(Guid portfolio, string currency, decimal balance, DateOnly? date = null)
    {
        var response = await _client.PutAsJsonAsync($"/api/portfolios/{portfolio}/cash", new SetCashRequest(currency, balance, date, null), Json, Ct);
        if (!response.IsSuccessStatusCode)
            Assert.Fail($"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(Ct)}");
    }

    private async Task<ProblemDetails> AddExpectingProblemAsync(Guid portfolio, TransactionRequest request)
    {
        var response = await _client.PostAsJsonAsync($"/api/portfolios/{portfolio}/transactions", request, Json, Ct);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<ProblemDetails>(Json, Ct))!;
    }

    private async Task<T> GetAsync<T>(string url) =>
        (await _client.GetFromJsonAsync<T>(url, Json, Ct))!;
}
