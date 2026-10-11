using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Folio.Api.Endpoints;

namespace Folio.Api.Tests;

/// <summary>A browser tells the server where a request came from; one from another site must not change anything.</summary>
public class CsrfTests(FolioApiFactory factory) : IClassFixture<FolioApiFactory>
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Theory]
    [InlineData("cross-site")]
    [InlineData("same-site")]
    public async Task A_write_from_another_site_is_refused_even_with_a_valid_session(string site)
    {
        using var client = await factory.CreateSignedInClientAsync();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/portfolios")
        {
            Content = JsonContent.Create(new CreatePortfolioRequest("Forged", "CAD", null), options: Json),
        };
        request.Headers.Add("Sec-Fetch-Site", site);

        var response = await client.SendAsync(request, Ct);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Empty((await client.GetFromJsonAsync<List<PortfolioSummaryDto>>("/api/portfolios", Json, Ct))!);
    }

    [Fact]
    public async Task Reads_from_anywhere_and_writes_from_folio_itself_go_through()
    {
        using var client = await factory.CreateSignedInClientAsync();
        using var read = new HttpRequestMessage(HttpMethod.Get, "/api/portfolios");
        read.Headers.Add("Sec-Fetch-Site", "cross-site");
        (await client.SendAsync(read, Ct)).EnsureSuccessStatusCode();

        using var write = new HttpRequestMessage(HttpMethod.Post, "/api/portfolios")
        {
            Content = JsonContent.Create(new CreatePortfolioRequest("Mine", "CAD", null), options: Json),
        };
        write.Headers.Add("Sec-Fetch-Site", "same-origin");
        (await client.SendAsync(write, Ct)).EnsureSuccessStatusCode();
    }
}
