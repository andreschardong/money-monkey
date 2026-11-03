using System.Net;
using System.Text;

namespace Folio.Api.Tests;

/// <summary>Request bodies with missing pieces, as a hand-written client might send them.</summary>
[Collection(FolioApiCollection.Name)]
public class NullBodyTests(FolioApiFactory factory)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static Task<HttpResponseMessage> PostRaw(HttpClient client, string url, string json) =>
        client.PostAsync(url, new StringContent(json, Encoding.UTF8, "application/json"), Ct);

    private static Task<HttpResponseMessage> PutRaw(HttpClient client, string url, string json) =>
        client.PutAsync(url, new StringContent(json, Encoding.UTF8, "application/json"), Ct);

    [Fact]
    public async Task WhenAPropertyHasNoName_ShouldAskForOne()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Homes", kind: Data.PortfolioKind.RealEstate);

        var response = await PostRaw(client, $"/api/portfolios/{portfolio}/properties", """{"name":null,"purchaseDate":"2020-06-15","purchasePrice":1}""");

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "Enter a short name of up to 32 characters.");
    }

    [Fact]
    public async Task WhenSharingWithoutAnEmail_ShouldSayThereIsNoAccountForIt()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Alone");

        var response = await PutRaw(client, $"/api/portfolios/{portfolio}/shares", """{"email":null,"canEdit":true}""");

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "No active Folio account uses that email.");
    }

    [Fact]
    public async Task WhenAPortfolioInTheFileHasNoTransactionsOrCashList_ShouldImportItEmpty()
    {
        var (client, _) = await factory.NewAccountAsync();

        var response = await PostRaw(client, "/api/import",
            """{"exportedAt":"2026-10-09T00:00:00Z","portfolios":[{"id":"00000000-0000-0000-0000-000000000001","name":"Bare","baseCurrency":"CAD","transactions":null,"cashBalances":null}]}""");

        response.EnsureSuccessStatusCode();
        (await client.GetJsonAsync<List<Folio.Api.Endpoints.PortfolioSummaryDto>>("/api/portfolios")).ShouldHaveSingleItem().Name.ShouldBe("Bare");
    }
}
