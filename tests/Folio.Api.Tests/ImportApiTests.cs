using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Folio.Api.Endpoints;
using Folio.Core;

namespace Folio.Api.Tests;

public class ImportApiTests(FolioApiFactory factory) : IClassFixture<FolioApiFactory>
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task An_export_imports_into_another_account_as_the_same_portfolios()
    {
        using var source = await factory.CreateSignedInClientAsync();
        using var target = await factory.CreateSignedInClientAsync();
        var portfolio = await CreatePortfolioAsync(source, "Moved TFSA", "CAD");
        await AddAsync(source, portfolio, new TransactionRequest(TransactionType.Deposit, D("2026-01-05"), Amount: 1_000m, Note: "Opening"));
        await AddAsync(source, portfolio, new TransactionRequest(TransactionType.Buy, D("2026-01-06"), Symbol: "SHOP.TO", Quantity: 3, Price: 100m, Fee: 4.95m));
        await AddAsync(source, portfolio, new TransactionRequest(TransactionType.Buy, D("2026-01-07"), Symbol: "AAPL", Quantity: 1, Price: 200m, FxRate: 1.40m));
        (await source.PutAsJsonAsync($"/api/portfolios/{portfolio}/cash", new SetCashRequest("CAD", 690.05m, D("2026-01-08"), "Statement"), Json, Ct)).EnsureSuccessStatusCode();
        var export = (await source.GetFromJsonAsync<ExportDto>("/api/export", Json, Ct))!;

        var response = await target.PostAsJsonAsync("/api/import", export, Json, Ct);
        if (!response.IsSuccessStatusCode)
            Assert.Fail($"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(Ct)}");
        var result = (await response.Content.ReadFromJsonAsync<ImportResultDto>(Json, Ct))!;
        Assert.Equal((1, 3, 1), (result.Portfolios, result.Transactions, result.CashBalances));
        Assert.Empty(result.Warnings);

        var imported = Assert.Single((await target.GetFromJsonAsync<List<PortfolioSummaryDto>>("/api/portfolios", Json, Ct))!);
        Assert.Equal("Moved TFSA", imported.Name);
        Assert.NotEqual(portfolio, imported.Id);
        Assert.Equal(3, imported.TransactionsCount);
        var original = (await source.GetFromJsonAsync<PortfolioDetailDto>($"/api/portfolios/{portfolio}", Json, Ct))!;
        var copy = (await target.GetFromJsonAsync<PortfolioDetailDto>($"/api/portfolios/{imported.Id}", Json, Ct))!;
        Assert.Equal(original.Summary.TotalValue, copy.Summary.TotalValue);
        Assert.Equal(original.CostBasis, copy.CostBasis);
        Assert.Equal(original.Summary.NetContributions, copy.Summary.NetContributions);
        Assert.Equal(690.05m, Assert.Single(copy.Cash).Balance);

        // The round trip is exact: exporting the copy gives the same records.
        var again = (await target.GetFromJsonAsync<ExportDto>("/api/export", Json, Ct))!;
        var before = export.Portfolios.Single().Transactions.Select(t => (t.Date, t.Type, t.Symbol, t.Quantity, t.Price, t.Amount, t.Fee, t.FxRate, t.Note));
        var after = again.Portfolios.Single().Transactions.Select(t => (t.Date, t.Type, t.Symbol, t.Quantity, t.Price, t.Amount, t.Fee, t.FxRate, t.Note));
        Assert.Equal(before, after);

        // Importing the same file again never overwrites: the copy gets a distinct name.
        (await target.PostAsJsonAsync("/api/import", export, Json, Ct)).EnsureSuccessStatusCode();
        var names = (await target.GetFromJsonAsync<List<PortfolioSummaryDto>>("/api/portfolios", Json, Ct))!.Select(p => p.Name).Order().ToList();
        Assert.Equal(["Moved TFSA", "Moved TFSA (imported)"], names);
    }

    [Fact]
    public async Task Symbols_that_cannot_be_quoted_become_manual_securities_with_a_warning()
    {
        using var target = await factory.CreateSignedInClientAsync();
        var file = new ExportDto(DateTimeOffset.UtcNow, [new ExportPortfolioDto(Guid.NewGuid(), "Odd lots", "USD", null, DateTimeOffset.UtcNow,
            [new ExportTransactionDto(D("2026-03-02"), TransactionType.Buy, "ZZZZ.PRIVATE", "Private Co", "Yahoo", "USD", 10, 5m, 0, 0, 1, 0, 0, null)],
            [])]);

        var response = await target.PostAsJsonAsync("/api/import", file, Json, Ct);
        if (!response.IsSuccessStatusCode)
            Assert.Fail($"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(Ct)}");
        var result = (await response.Content.ReadFromJsonAsync<ImportResultDto>(Json, Ct))!;
        Assert.Contains(result.Warnings, w => w.StartsWith("ZZZZ.PRIVATE could not be quoted"));
        var imported = Assert.Single((await target.GetFromJsonAsync<List<PortfolioSummaryDto>>("/api/portfolios", Json, Ct))!);
        var detail = (await target.GetFromJsonAsync<PortfolioDetailDto>($"/api/portfolios/{imported.Id}", Json, Ct))!;
        Assert.Equal("ZZZZ.PRIVATE", Assert.Single(detail.Holdings).Symbol);
    }

    [Fact]
    public async Task A_file_that_does_not_add_up_is_refused_whole()
    {
        using var target = await factory.CreateSignedInClientAsync();
        var file = new ExportDto(DateTimeOffset.UtcNow, [new ExportPortfolioDto(Guid.NewGuid(), "Broken", "CAD", null, DateTimeOffset.UtcNow,
            [new ExportTransactionDto(D("2026-03-02"), TransactionType.Sell, "SHOP.TO", "Shopify Inc.", "Yahoo", "CAD", 10, 100m, 0, 0, 1, 0, 0, null)],
            [])]);

        var response = await target.PostAsJsonAsync("/api/import", file, Json, Ct);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("doesn't add up", await response.Content.ReadAsStringAsync(Ct));
        Assert.Empty((await target.GetFromJsonAsync<List<PortfolioSummaryDto>>("/api/portfolios", Json, Ct))!);

        var empty = await target.PostAsJsonAsync("/api/import", new ExportDto(DateTimeOffset.UtcNow, []), Json, Ct);
        Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);
    }

    private static DateOnly D(string iso) => DateOnly.Parse(iso, System.Globalization.CultureInfo.InvariantCulture);

    private static async Task<Guid> CreatePortfolioAsync(HttpClient client, string name, string currency)
    {
        var response = await client.PostAsJsonAsync("/api/portfolios", new CreatePortfolioRequest(name, currency, null), Json, Ct);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<PortfolioSummaryDto>(Json, Ct))!.Id;
    }

    private static async Task AddAsync(HttpClient client, Guid portfolio, TransactionRequest request)
    {
        var response = await client.PostAsJsonAsync($"/api/portfolios/{portfolio}/transactions", request, Json, Ct);
        if (!response.IsSuccessStatusCode)
            Assert.Fail($"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(Ct)}");
    }
}
