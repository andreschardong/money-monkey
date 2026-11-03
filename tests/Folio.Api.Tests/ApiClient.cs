using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Folio.Api.Data;
using Folio.Api.Endpoints;
using Folio.Core;
using Microsoft.Extensions.DependencyInjection;

namespace Folio.Api.Tests;

/// <summary>One app and one database shared by the endpoint test classes, which run one after the other.</summary>
[CollectionDefinition(Name)]
public sealed class FolioApiCollection : ICollectionFixture<FolioApiFactory>
{
    public const string Name = "Folio API";
}

/// <summary>Short calls against the running API, so tests read as what they check.</summary>
public static class ApiClient
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

    public static readonly DateOnly Today = FolioApiFactory.Today;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public static Task<HttpResponseMessage> GetResponseAsync(this HttpClient client, string url) => client.GetAsync(url, Ct);

    public static Task<HttpResponseMessage> PostJsonAsync(this HttpClient client, string url, object? body = null) =>
        client.PostAsJsonAsync(url, body ?? new { }, Json, Ct);

    public static Task<HttpResponseMessage> PutJsonAsync(this HttpClient client, string url, object body) =>
        client.PutAsJsonAsync(url, body, Json, Ct);

    public static Task<HttpResponseMessage> DeleteResponseAsync(this HttpClient client, string url) => client.DeleteAsync(url, Ct);

    /// <summary>Reads the body as <typeparamref name="T"/>, failing the test with the server's message when the call did not succeed.</summary>
    public static async Task<T> ReadAsync<T>(this HttpResponseMessage response)
    {
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(Ct)}");
        return (await response.Content.ReadFromJsonAsync<T>(Json, Ct))!;
    }

    public static async Task<T> ReadAsync<T>(this Task<HttpResponseMessage> response) => await (await response).ReadAsync<T>();

    public static async Task<T> GetJsonAsync<T>(this HttpClient client, string url) => await (await client.GetResponseAsync(url)).ReadAsync<T>();

    /// <summary>The problem text of an error response.</summary>
    public static async Task<string> DetailAsync(this HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(Ct));
        return document.RootElement.TryGetProperty("detail", out var detail) ? detail.GetString() ?? string.Empty : string.Empty;
    }

    public static async Task ShouldBeProblemAsync(this HttpResponseMessage response, HttpStatusCode status, string? detailContains = null)
    {
        response.StatusCode.ShouldBe(status);
        if (detailContains is not null)
            (await response.DetailAsync()).ShouldContain(detailContains);
    }

    public static async Task<Guid> CreatePortfolioAsync(
        this HttpClient client, string name = "Test", string currency = "CAD", string? country = null, PortfolioKind kind = PortfolioKind.Investment) =>
        (await (await client.PostJsonAsync("/api/portfolios", new CreatePortfolioRequest(name, currency, null, country, kind))).ReadAsync<PortfolioSummaryDto>()).Id;

    public static async Task<TransactionDto> AddAsync(this HttpClient client, Guid portfolio, TransactionRequest request) =>
        (await (await client.PostJsonAsync($"/api/portfolios/{portfolio}/transactions", request)).ReadAsync<List<TransactionDto>>()).Single();

    public static Task<TransactionDto> DepositAsync(this HttpClient client, Guid portfolio, decimal amount, string date = "2026-01-05", string? currency = null) =>
        client.AddAsync(portfolio, new TransactionRequest(TransactionType.Deposit, DateOnly.Parse(date), Amount: amount, Currency: currency));

    public static Task<TransactionDto> BuyAsync(this HttpClient client, Guid portfolio, string symbol, decimal quantity, decimal price, string date = "2026-02-02") =>
        client.AddAsync(portfolio, new TransactionRequest(TransactionType.Buy, DateOnly.Parse(date), Symbol: symbol, Quantity: quantity, Price: price));

    public static async Task<SecurityDto> ResolveAsync(this HttpClient client, string symbol, DateOnly? from = null) =>
        await (await client.PostJsonAsync("/api/securities", new ResolveSecurityRequest(symbol, from))).ReadAsync<SecurityDto>();

    public static Task<PortfolioDetailDto> DetailAsync(this HttpClient client, Guid portfolio) =>
        client.GetJsonAsync<PortfolioDetailDto>($"/api/portfolios/{portfolio}");

    /// <summary>Shares a portfolio and returns the share list; fails the test when it was refused.</summary>
    public static async Task<List<ShareDto>> ShareWithAsync(this HttpClient owner, Guid portfolio, string email, bool canEdit) =>
        await (await owner.PutJsonAsync($"/api/portfolios/{portfolio}/shares", new ShareRequest(email, canEdit))).ReadAsync<List<ShareDto>>();

    /// <summary>Runs work against the database as the app would, outside any request (so no account filters apply).</summary>
    public static async Task<T> WithDbAsync<T>(this FolioApiFactory factory, Func<FolioDbContext, Task<T>> work)
    {
        using var scope = factory.Services.CreateScope();
        return await work(scope.ServiceProvider.GetRequiredService<FolioDbContext>());
    }

    public static async Task WithDbAsync(this FolioApiFactory factory, Func<FolioDbContext, Task> work)
    {
        using var scope = factory.Services.CreateScope();
        await work(scope.ServiceProvider.GetRequiredService<FolioDbContext>());
    }

    /// <summary>A new account with a session, plus the address it signed in with.</summary>
    public static async Task<(HttpClient Client, string Email)> NewAccountAsync(this FolioApiFactory factory, string prefix = "user")
    {
        var email = $"{prefix}-{Guid.NewGuid():N}@example.com";
        return (await factory.CreateSignedInClientAsync(email), email);
    }
}
