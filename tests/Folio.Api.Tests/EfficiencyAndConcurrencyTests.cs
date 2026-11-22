using System.Net;
using Folio.Api.Data;
using Folio.Api.Endpoints;
using Folio.Core;
using Microsoft.EntityFrameworkCore;

namespace Folio.Api.Tests;

/// <summary>Pages that add every portfolio together cost the same queries however many there are; writes to one portfolio queue.</summary>
[Collection(FolioApiCollection.Name)]
public class EfficiencyAndConcurrencyTests(FolioApiFactory factory)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static readonly string[] AllPortfolioPages =
    [
        "/api/overview",
        "/api/overview?excludeRealEstate=true",
        "/api/overview/history?range=ALL",
        "/api/assets",
        "/api/assets?excludeRealEstate=true",
        "/api/portfolios",
        "/api/export/holdings.csv",
    ];

    /// <summary>A portfolio with a recently priced holding, one priced only long ago (the fallback path), and cash.</summary>
    private async Task AddPortfolioAsync(HttpClient client, int index)
    {
        var portfolio = await client.CreatePortfolioAsync($"P{index}", index % 2 == 0 ? "CAD" : "USD",
            kind: index % 3 == 0 ? PortfolioKind.RealEstate : PortfolioKind.Investment);
        var recent = await factory.SeedSecurityAsync(currency: "USD");
        var old = await factory.SeedSecurityAsync(currency: "EUR");
        await factory.SeedPricesAsync(recent.Id, (ApiClient.Today.AddDays(-2), 10m), (ApiClient.Today.AddDays(-1), 11m));
        await factory.SeedPricesAsync(old.Id, (new DateOnly(2025, 1, 2), 5m), (new DateOnly(2025, 1, 3), 6m));
        await client.AddAsync(portfolio, new TransactionRequest(TransactionType.Buy, new DateOnly(2026, 2, 2), SecurityId: recent.Id, Quantity: 2, Price: 9m, FxRate: 1.4m));
        await client.AddAsync(portfolio, new TransactionRequest(TransactionType.Buy, new DateOnly(2026, 2, 3), SecurityId: old.Id, Quantity: 3, Price: 4m, FxRate: 1.5m));
        (await client.PutJsonAsync($"/api/portfolios/{portfolio}/cash", new SetCashRequest("EUR", 25m, null, null))).EnsureSuccessStatusCode();
    }

    /// <summary>The commands one request sends, after a first call has downloaded whatever rates were missing.</summary>
    private async Task<int> CountCommandsAsync(HttpClient client, string url)
    {
        (await client.GetResponseAsync(url)).EnsureSuccessStatusCode();
        var count = 0;
        factory.Commands.BeforeReader = _ => { Interlocked.Increment(ref count); return Task.CompletedTask; };
        factory.Commands.BeforeNonQuery = _ => { Interlocked.Increment(ref count); return Task.CompletedTask; };
        try
        {
            (await client.GetResponseAsync(url)).EnsureSuccessStatusCode();
            return count;
        }
        finally
        {
            factory.Commands.BeforeReader = null;
            factory.Commands.BeforeNonQuery = null;
        }
    }

    [Fact]
    public async Task WhenAnAccountHasMorePortfolios_ShouldSendTheSameNumberOfQueriesOnEveryAllPortfolioPage()
    {
        var (client, _) = await factory.NewAccountAsync();
        await AddPortfolioAsync(client, 1);
        var withOne = new Dictionary<string, int>();
        foreach (var url in AllPortfolioPages)
            withOne[url] = await CountCommandsAsync(client, url);

        for (var i = 2; i <= 7; i++)
            await AddPortfolioAsync(client, i);

        foreach (var url in AllPortfolioPages)
            (await CountCommandsAsync(client, url)).ShouldBe(withOne[url], url);
        (await client.GetJsonAsync<List<PortfolioSummaryDto>>("/api/portfolios")).Count.ShouldBe(7);
    }

    [Fact]
    public async Task WhenBatchedValuationsRun_ShouldGiveEachPortfolioTheSameFiguresAsItsOwnPage()
    {
        var (client, _) = await factory.NewAccountAsync();
        for (var i = 1; i <= 3; i++)
            await AddPortfolioAsync(client, i);

        var summaries = await client.GetJsonAsync<List<PortfolioSummaryDto>>("/api/portfolios");

        foreach (var summary in summaries)
        {
            var detail = await client.DetailAsync(summary.Id);
            (summary.TotalValue, summary.TransactionsCount).ShouldBe((detail.Summary.TotalValue, detail.Summary.TransactionsCount));
            detail.Holdings.Count.ShouldBe(2);
            detail.Holdings.ShouldAllBe(h => h.Price != null);
        }
    }

    [Fact]
    public async Task WhenTwoSellsOfTheSameSharesArriveTogether_ShouldAcceptOneAndRefuseTheOther()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Race");
        var security = await factory.SeedSecurityAsync();
        await client.AddAsync(portfolio, new TransactionRequest(TransactionType.Buy, new DateOnly(2026, 2, 2), SecurityId: security.Id, Quantity: 10, Price: 100m));
        var sell = new TransactionRequest(TransactionType.Sell, new DateOnly(2026, 3, 2), SecurityId: security.Id, Quantity: 10, Price: 120m);

        // Each write pauses after it starts reading the ledger, so without the portfolio lock both would read ten shares held.
        factory.Commands.BeforeReader = command =>
            command.CommandText.Contains("max(t.sequence)", StringComparison.OrdinalIgnoreCase) ? Task.Delay(400, Ct) : Task.CompletedTask;
        HttpResponseMessage[] responses;
        try
        {
            responses = await Task.WhenAll(
                client.PostJsonAsync($"/api/portfolios/{portfolio}/transactions", sell),
                client.PostJsonAsync($"/api/portfolios/{portfolio}/transactions", sell));
        }
        finally
        {
            factory.Commands.BeforeReader = null;
        }

        responses.Count(r => r.StatusCode == HttpStatusCode.Created).ShouldBe(1);
        await responses.Single(r => r.StatusCode != HttpStatusCode.Created).ShouldBeProblemAsync(HttpStatusCode.BadRequest);
        var sequences = await factory.WithDbAsync(db => db.Transactions.Where(t => t.PortfolioId == portfolio).Select(t => t.Sequence).ToListAsync(Ct));
        sequences.Order().ShouldBe([1L, 2L]);
    }

    [Fact]
    public async Task WhenTwoBuysArriveTogether_ShouldSaveBothWithTheirOwnEntryNumbers()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Two tabs");
        var security = await factory.SeedSecurityAsync();
        var buy = new TransactionRequest(TransactionType.Buy, new DateOnly(2026, 2, 2), SecurityId: security.Id, Quantity: 1, Price: 100m);

        factory.Commands.BeforeReader = command =>
            command.CommandText.Contains("max(t.sequence)", StringComparison.OrdinalIgnoreCase) ? Task.Delay(400, Ct) : Task.CompletedTask;
        HttpResponseMessage[] responses;
        try
        {
            responses = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => client.PostJsonAsync($"/api/portfolios/{portfolio}/transactions", buy)));
        }
        finally
        {
            factory.Commands.BeforeReader = null;
        }

        responses.ShouldAllBe(r => r.StatusCode == HttpStatusCode.Created);
        var sequences = await factory.WithDbAsync(db => db.Transactions.Where(t => t.PortfolioId == portfolio).Select(t => t.Sequence).ToListAsync(Ct));
        sequences.Order().ShouldBe([1L, 2L, 3L]);
    }

    [Fact]
    public async Task WhenTwoTransactionsInAPortfolioShareAnEntryNumber_ShouldBeRefusedByTheDatabase()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Unique");
        var first = await client.DepositAsync(portfolio, 100m);

        var duplicate = () => factory.WithDbAsync(async db =>
        {
            db.Transactions.Add(new Transaction
            {
                Id = Guid.CreateVersion7(), PortfolioId = portfolio, Type = TransactionType.Deposit, Date = first.Date,
                Sequence = 1, Currency = "CAD", Amount = 5m,
            });
            await db.SaveChangesAsync(Ct);
        });

        await Should.ThrowAsync<DbUpdateException>(duplicate);
    }
}
