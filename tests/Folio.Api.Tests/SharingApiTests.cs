using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Folio.Api.Data;
using Folio.Api.Endpoints;
using Folio.Core;

namespace Folio.Api.Tests;

public class SharingApiTests(FolioApiFactory factory) : IClassFixture<FolioApiFactory>
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task A_shared_portfolio_shows_up_for_the_other_account_and_is_editable_only_when_allowed()
    {
        var ownerEmail = $"owner-{Guid.NewGuid():N}@example.com";
        var wifeEmail = $"wife-{Guid.NewGuid():N}@example.com";
        using var owner = await factory.CreateSignedInClientAsync(ownerEmail);
        using var wife = await factory.CreateSignedInClientAsync(wifeEmail);
        var portfolio = await CreatePortfolioAsync(owner, "Joint TFSA");
        await AddAsync(owner, portfolio, new TransactionRequest(TransactionType.Deposit, new DateOnly(2026, 1, 5), Amount: 1_000m));

        // Until it is shared, the other account can't see it or guess its id.
        Assert.Equal(HttpStatusCode.NotFound, (await wife.GetAsync($"/api/portfolios/{portfolio}", Ct)).StatusCode);
        Assert.DoesNotContain(await ListAsync(wife), p => p.Id == portfolio);

        // Shared to view: visible, marked as someone else's, and read-only.
        var shares = await ShareAsync(owner, portfolio, wifeEmail.ToUpperInvariant(), canEdit: false);
        var share = Assert.Single(shares);
        Assert.Equal(wifeEmail, share.Email);
        Assert.False(share.CanEdit);

        var seen = Assert.Single(await ListAsync(wife), p => p.Id == portfolio);
        Assert.Equal("View", seen.Access);
        Assert.Equal(ownerEmail, seen.OwnerEmail);
        var detail = (await wife.GetFromJsonAsync<PortfolioDetailDto>($"/api/portfolios/{portfolio}", Json, Ct))!;
        Assert.Equal(1_000m, detail.Summary.NetContributions);
        Assert.Equal("View", detail.Summary.Access);
        var mine = Assert.Single(await ListAsync(owner), p => p.Id == portfolio);
        Assert.Equal("Owner", mine.Access);
        Assert.Equal(1, mine.SharedWith);

        var deposit = new TransactionRequest(TransactionType.Deposit, new DateOnly(2026, 2, 2), Amount: 50m);
        Assert.Equal(HttpStatusCode.Forbidden, (await wife.PostAsJsonAsync($"/api/portfolios/{portfolio}/transactions", deposit, Json, Ct)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await wife.PutAsJsonAsync($"/api/portfolios/{portfolio}/cash", new SetCashRequest("CAD", 10m, null, null), Json, Ct)).StatusCode);

        // Nobody but the owner manages, renames or deletes it, whatever their share says.
        Assert.Equal(HttpStatusCode.Forbidden, (await wife.PutAsJsonAsync($"/api/portfolios/{portfolio}/shares", new ShareRequest(ownerEmail, true), Json, Ct)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await wife.GetAsync($"/api/portfolios/{portfolio}/shares", Ct)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await wife.PutAsJsonAsync($"/api/portfolios/{portfolio}", new UpdatePortfolioRequest("Mine now", "CAD", null), Json, Ct)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await wife.DeleteAsync($"/api/portfolios/{portfolio}", Ct)).StatusCode);

        // Shared to edit: transactions and cash go in, the rest stays the owner's.
        Assert.True(Assert.Single(await ShareAsync(owner, portfolio, wifeEmail, canEdit: true)).CanEdit);
        (await wife.PostAsJsonAsync($"/api/portfolios/{portfolio}/transactions", deposit, Json, Ct)).EnsureSuccessStatusCode();
        (await wife.PutAsJsonAsync($"/api/portfolios/{portfolio}/cash", new SetCashRequest("CAD", 10m, null, null), Json, Ct)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden, (await wife.DeleteAsync($"/api/portfolios/{portfolio}", Ct)).StatusCode);
        detail = (await owner.GetFromJsonAsync<PortfolioDetailDto>($"/api/portfolios/{portfolio}", Json, Ct))!;
        Assert.Equal(1_050m, detail.Summary.NetContributions);

        // The export is the account's own data; what others shared is theirs to export.
        var export = (await wife.GetFromJsonAsync<ExportDto>("/api/export", Json, Ct))!;
        Assert.DoesNotContain(export.Portfolios, p => p.Id == portfolio);

        // Unsharing hides it again.
        var remaining = await owner.DeleteAsync($"/api/portfolios/{portfolio}/shares?email={Uri.EscapeDataString(wifeEmail)}", Ct);
        remaining.EnsureSuccessStatusCode();
        Assert.Empty((await remaining.Content.ReadFromJsonAsync<List<ShareDto>>(Json, Ct))!);
        Assert.Equal(HttpStatusCode.NotFound, (await wife.GetAsync($"/api/portfolios/{portfolio}", Ct)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await wife.PostAsJsonAsync($"/api/portfolios/{portfolio}/transactions", deposit, Json, Ct)).StatusCode);
    }

    [Fact]
    public async Task Sharing_needs_an_activated_account_other_than_your_own()
    {
        var ownerEmail = $"owner-{Guid.NewGuid():N}@example.com";
        using var owner = await factory.CreateSignedInClientAsync(ownerEmail);
        var portfolio = await CreatePortfolioAsync(owner, "Solo");

        var unknown = await owner.PutAsJsonAsync($"/api/portfolios/{portfolio}/shares", new ShareRequest("nobody@example.com", false), Json, Ct);
        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
        Assert.Contains("sign up", await unknown.Content.ReadAsStringAsync(Ct));

        var self = await owner.PutAsJsonAsync($"/api/portfolios/{portfolio}/shares", new ShareRequest(ownerEmail, false), Json, Ct);
        Assert.Equal(HttpStatusCode.BadRequest, self.StatusCode);
    }

    [Fact]
    public async Task A_shared_portfolio_brings_along_the_owners_manual_securities_without_handing_over_their_prices()
    {
        using var owner = await factory.CreateSignedInClientAsync();
        var wifeEmail = $"wife-{Guid.NewGuid():N}@example.com";
        using var wife = await factory.CreateSignedInClientAsync(wifeEmail);
        var portfolio = await CreatePortfolioAsync(owner, "With a GIC");
        var created = await owner.PostAsJsonAsync("/api/securities/manual",
            new ManualSecurityRequest("GIC-2027", "2-year GIC", "CAD", AssetType.Other, 1m, new DateOnly(2026, 9, 1)), Json, Ct);
        created.EnsureSuccessStatusCode();
        var gic = (await created.Content.ReadFromJsonAsync<SecurityDto>(Json, Ct))!;
        await AddAsync(owner, portfolio, new TransactionRequest(TransactionType.Buy, new DateOnly(2026, 9, 1), SecurityId: gic.Id, Quantity: 5_000, Price: 1m));
        await ShareAsync(owner, portfolio, wifeEmail, canEdit: false);

        // She sees the holding and its security, which only the owner's account could see before.
        var detail = (await wife.GetFromJsonAsync<PortfolioDetailDto>($"/api/portfolios/{portfolio}", Json, Ct))!;
        Assert.Equal("GIC-2027", Assert.Single(detail.Holdings).Symbol);
        (await wife.GetAsync($"/api/securities/{gic.Id}", Ct)).EnsureSuccessStatusCode();

        // Its price stays the owner's to set.
        var price = new ManualPriceRequest(new DateOnly(2026, 10, 1), 1.01m);
        Assert.Equal(HttpStatusCode.Forbidden, (await wife.PostAsJsonAsync($"/api/securities/{gic.Id}/prices", price, Json, Ct)).StatusCode);
        (await owner.PostAsJsonAsync($"/api/securities/{gic.Id}/prices", price, Json, Ct)).EnsureSuccessStatusCode();

        // Her own GIC with the same symbol is still hers to create.
        var hers = await wife.PostAsJsonAsync("/api/securities/manual",
            new ManualSecurityRequest("GIC-2027", "Her GIC", "CAD", AssetType.Other, 1m, new DateOnly(2026, 9, 1)), Json, Ct);
        hers.EnsureSuccessStatusCode();
    }

    private static async Task<Guid> CreatePortfolioAsync(HttpClient client, string name)
    {
        var response = await client.PostAsJsonAsync("/api/portfolios", new CreatePortfolioRequest(name, "CAD", null), Json, Ct);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<PortfolioSummaryDto>(Json, Ct))!.Id;
    }

    private static async Task AddAsync(HttpClient client, Guid portfolio, TransactionRequest request)
    {
        var response = await client.PostAsJsonAsync($"/api/portfolios/{portfolio}/transactions", request, Json, Ct);
        if (!response.IsSuccessStatusCode)
            Assert.Fail($"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(Ct)}");
    }

    private static async Task<List<ShareDto>> ShareAsync(HttpClient client, Guid portfolio, string email, bool canEdit)
    {
        var response = await client.PutAsJsonAsync($"/api/portfolios/{portfolio}/shares", new ShareRequest(email, canEdit), Json, Ct);
        if (!response.IsSuccessStatusCode)
            Assert.Fail($"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(Ct)}");
        return (await response.Content.ReadFromJsonAsync<List<ShareDto>>(Json, Ct))!;
    }

    private static async Task<List<PortfolioSummaryDto>> ListAsync(HttpClient client) =>
        (await client.GetFromJsonAsync<List<PortfolioSummaryDto>>("/api/portfolios", Json, Ct))!;
}
