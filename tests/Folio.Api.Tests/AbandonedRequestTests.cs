using System.Net;
using System.Net.Http.Json;
using Folio.Api.Data;
using Folio.Api.Endpoints;
using Folio.Core;
using Microsoft.EntityFrameworkCore;

namespace Folio.Api.Tests;

/// <summary>A request the browser gives up on, or a database that fails oddly, in the middle of a lookup.</summary>
[Collection(FolioApiCollection.Name)]
public class AbandonedRequestTests(FolioApiFactory factory)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    /// <summary>Sends the request, waits until the app is stuck waiting on a provider, hangs up, and waits for the app to finish with it.</summary>
    private async Task AbandonAsync(HttpClient client, HttpRequestMessage request, TaskCompletionSource waiting)
    {
        var id = Guid.NewGuid().ToString("N");
        request.Headers.Add("X-Test-Request", id);
        using var cancel = new CancellationTokenSource();
        var pending = client.SendAsync(request, cancel.Token);
        await waiting.Task.WaitAsync(TimeSpan.FromSeconds(30), Ct);

        await cancel.CancelAsync();

        await Should.ThrowAsync<TaskCanceledException>(() => pending);
        await factory.Requests.WhenCompletedAsync(id);
    }

    [Fact]
    public async Task WhenTheBrowserHangsUpWhileASymbolIsBeingLookedUp_ShouldNotReportItAsAProviderOutage()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Hang up");
        var waiting = new TaskCompletionSource();
        factory.Quotes.WhileHistory = async (_, ct) =>
        {
            waiting.TrySetResult();
            await Task.Delay(Timeout.Infinite, ct);
        };
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, $"/api/portfolios/{portfolio}/transactions")
            {
                Content = JsonContent.Create(new TransactionRequest(TransactionType.Buy, new DateOnly(2026, 2, 2), Symbol: "SLOWX", Quantity: 1, Price: 1m), options: ApiClient.Json),
            };

            await AbandonAsync(client, request, waiting);
        }
        finally
        {
            factory.Quotes.WhileHistory = null;
        }

        (await client.GetJsonAsync<List<TransactionDto>>($"/api/portfolios/{portfolio}/transactions")).ShouldBeEmpty();
    }

    [Fact]
    public async Task WhenTheBrowserHangsUpWhileARateIsBeingLookedUp_ShouldStopWithoutStoringAnything()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Hang up on a rate");
        var waiting = new TaskCompletionSource();
        factory.Fx.WhileRates = async ct =>
        {
            waiting.TrySetResult();
            await Task.Delay(Timeout.Infinite, ct);
        };
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, $"/api/portfolios/{portfolio}/transactions")
            {
                Content = JsonContent.Create(new TransactionRequest(TransactionType.Deposit, new DateOnly(2026, 2, 2), Amount: 5m, Currency: "GBP"), options: ApiClient.Json),
            };

            await AbandonAsync(client, request, waiting);
        }
        finally
        {
            factory.Fx.WhileRates = null;
        }

        (await client.GetJsonAsync<List<TransactionDto>>($"/api/portfolios/{portfolio}/transactions")).ShouldBeEmpty();
    }

    [Fact]
    public async Task WhenTheBrowserHangsUpWhileRatesAreBeingFetchedForAPortfolio_ShouldStopQuietly()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Hang up on a portfolio");
        (await client.PutJsonAsync($"/api/portfolios/{portfolio}/cash", new SetCashRequest("GBP", 5m, null, null))).EnsureSuccessStatusCode();
        var waiting = new TaskCompletionSource();
        factory.Fx.WhileRates = async ct =>
        {
            waiting.TrySetResult();
            await Task.Delay(Timeout.Infinite, ct);
        };
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, $"/api/portfolios/{portfolio}");

            await AbandonAsync(client, request, waiting);
        }
        finally
        {
            factory.Fx.WhileRates = null;
        }

        (await client.GetResponseAsync($"/api/portfolios/{portfolio}")).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task WhenTheDatabaseConnectionDropsWhileStoringANewSecurity_ShouldFailAsAServerErrorAndStoreNothing()
    {
        var (client, _) = await factory.NewAccountAsync();
        factory.Commands.BeforeReader = command =>
            command.CommandText.Contains("INSERT INTO securities", StringComparison.Ordinal) ? throw new IOException("connection lost") : Task.CompletedTask;
        try
        {
            var response = await client.PostJsonAsync("/api/securities", new ResolveSecurityRequest("READERX", null));

            response.StatusCode.ShouldBe(HttpStatusCode.InternalServerError);
        }
        finally
        {
            factory.Commands.BeforeReader = null;
        }

        (await factory.WithDbAsync(db => db.Securities.IgnoreQueryFilters().CountAsync(s => s.Symbol == "READERX", Ct))).ShouldBe(0);
        (await client.ResolveAsync("READERX")).Symbol.ShouldBe("READERX");
    }

    [Fact]
    public async Task WhenStoredTransactionsLackASecurity_ShouldNotLetThemHideOrFakeAnyRecordedSplitOrPayment()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Corrupt");
        var security = await factory.SeedSecurityAsync();
        await client.AddAsync(portfolio, new TransactionRequest(TransactionType.Buy, new DateOnly(2026, 2, 2), SecurityId: security.Id, Quantity: 10, Price: 10m));
        await factory.SeedActionAsync(security.Id, new DateOnly(2026, 5, 15), CorporateActionKind.Split, numerator: 2, denominator: 1);
        await factory.SeedActionAsync(security.Id, new DateOnly(2026, 9, 20), CorporateActionKind.Dividend, amount: 1m);
        // Rows that could only get here through editing the database by hand.
        await factory.WithDbAsync(async db =>
        {
            var now = factory.Time.GetUtcNow();
            db.Transactions.Add(new Transaction
            {
                Id = Guid.CreateVersion7(), PortfolioId = portfolio, Type = TransactionType.Split, Date = new DateOnly(2026, 5, 14), Sequence = 90,
                Currency = "CAD", SplitFrom = 1, SplitTo = 2, CreatedAt = now, UpdatedAt = now,
            });
            db.Transactions.Add(new Transaction
            {
                Id = Guid.CreateVersion7(), PortfolioId = portfolio, Type = TransactionType.Dividend, Date = new DateOnly(2026, 9, 21), Sequence = 91,
                Currency = "CAD", Amount = 10m, CreatedAt = now, UpdatedAt = now,
            });
            await db.SaveChangesAsync(Ct);
        });

        var suggestions = await client.GetJsonAsync<List<SuggestionDto>>($"/api/portfolios/{portfolio}/suggestions");

        suggestions.Select(s => (s.Kind, s.Date.Month)).ShouldBe([(CorporateActionKind.Dividend, 9), (CorporateActionKind.Split, 5)]);
    }
}
