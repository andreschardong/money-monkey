using System.Net;
using Folio.Api.Data;
using Folio.Api.Endpoints;
using Folio.Core;
using Microsoft.EntityFrameworkCore;

namespace Folio.Api.Tests;

[Collection(FolioApiCollection.Name)]
public class PropertyEndpointTests(FolioApiFactory factory)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static readonly DateOnly Bought = new(2020, 6, 15);

    private async Task<(HttpClient Client, Guid Portfolio)> NewRealEstatePortfolioAsync()
    {
        var (client, _) = await factory.NewAccountAsync();
        return (client, await client.CreatePortfolioAsync("Homes", "CAD", kind: PortfolioKind.RealEstate));
    }

    private static Task<HttpResponseMessage> Add(HttpClient client, Guid portfolio, PropertyRequest request) =>
        client.PostJsonAsync($"/api/portfolios/{portfolio}/properties", request);

    [Fact]
    public async Task WhenAPropertyIsAdded_ShouldBuyOneUnitAtThePurchasePriceWithClosingCostsAsTheFee()
    {
        var (client, portfolio) = await NewRealEstatePortfolioAsync();

        var response = await Add(client, portfolio, new PropertyRequest("  Cottage ", "  12 Lake Road ", Bought, 400_000m, 12_000m, 520_000m));

        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        var buy = await response.ReadAsync<TransactionDto>();
        response.Headers.Location!.ToString().ShouldBe($"/api/portfolios/{portfolio}/transactions/{buy.Id}");
        (buy.Type, buy.Symbol, buy.SecurityName, buy.Quantity, buy.Price, buy.Fee, buy.Currency, buy.Date)
            .ShouldBe((TransactionType.Buy, "COTTAGE", "12 Lake Road", 1m, 400_000m, 12_000m, "CAD", Bought));
        var detail = await client.DetailAsync(portfolio);
        var holding = detail.Holdings.ShouldHaveSingleItem();
        (holding.AssetType, holding.Price, holding.CostBasis, holding.MarketValue).ShouldBe((AssetType.RealEstate, 520_000m, 412_000m, 520_000m));
    }

    [Fact]
    public async Task WhenNoValueTodayIsGiven_ShouldValueThePropertyAtItsPurchasePrice()
    {
        var (client, portfolio) = await NewRealEstatePortfolioAsync();

        await Add(client, portfolio, new PropertyRequest("Condo", null, Bought, 300_000m)).ReadAsync<TransactionDto>();

        var detail = await client.DetailAsync(portfolio);
        var holding = detail.Holdings.ShouldHaveSingleItem();
        (holding.Name, holding.Price, holding.PriceDate, holding.CostBasis).ShouldBe(("Condo", 300_000m, Bought, 300_000m));
    }

    [Fact]
    public async Task WhenThePortfolioIsNotRealEstate_ShouldExplainWhatToChange()
    {
        var (client, _) = await factory.NewAccountAsync();
        var portfolio = await client.CreatePortfolioAsync("Stocks");

        var response = await Add(client, portfolio, new PropertyRequest("Condo", null, Bought, 1m));

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "Properties go in a real-estate portfolio.");
    }

    [Fact]
    public async Task WhenThePortfolioDoesNotExist_ShouldFindNothing()
    {
        var (client, _) = await factory.NewAccountAsync();

        (await Add(client, Guid.NewGuid(), new PropertyRequest("Condo", null, Bought, 1m))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task WhenAViewerAddsAProperty_ShouldBeForbiddenButAnEditorMay()
    {
        var (owner, portfolio) = await NewRealEstatePortfolioAsync();
        var (viewer, viewerEmail) = await factory.NewAccountAsync();
        var (editor, editorEmail) = await factory.NewAccountAsync();
        await owner.ShareWithAsync(portfolio, viewerEmail, canEdit: false);
        await owner.ShareWithAsync(portfolio, editorEmail, canEdit: true);

        await (await Add(viewer, portfolio, new PropertyRequest("Condo", null, Bought, 1m))).ShouldBeProblemAsync(HttpStatusCode.Forbidden, "view only");
        (await Add(editor, portfolio, new PropertyRequest("Condo", null, Bought, 1m))).StatusCode.ShouldBe(HttpStatusCode.Created);
    }

    public static TheoryData<string, string?, string, decimal, decimal?, decimal?, string> InvalidProperties => new()
    {
        { "", null, "2020-06-15", 1m, null, null, "Enter a short name of up to 32 characters." },
        { "   ", null, "2020-06-15", 1m, null, null, "Enter a short name of up to 32 characters." },
        { new string('n', 33), null, "2020-06-15", 1m, null, null, "Enter a short name of up to 32 characters." },
        { "Home", new string('d', 201), "2020-06-15", 1m, null, null, "limited to 200 characters" },
        { "Home", null, "2026-10-10", 1m, null, null, "purchase date cannot be in the future" },
        { "Home", null, "2020-06-15", 0m, null, null, "purchase price must be greater than zero" },
        { "Home", null, "2020-06-15", -5m, null, null, "purchase price must be greater than zero" },
        { "Home", null, "2020-06-15", 1m, -1m, null, "Closing costs cannot be negative." },
        { "Home", null, "2020-06-15", 1m, null, 0m, "value today must be greater than zero" },
        { "Home", null, "1960-01-01", 1m, null, null, "The date is too far in the past." },
    };

    [Theory]
    [MemberData(nameof(InvalidProperties))]
    public async Task WhenAPropertyBreaksARule_ShouldRefuseItAndLeaveNoStraySecurity(
        string name, string? description, string date, decimal price, decimal? closing, decimal? value, string expected)
    {
        var (client, portfolio) = await NewRealEstatePortfolioAsync();

        var response = await Add(client, portfolio, new PropertyRequest(name, description, DateOnly.Parse(date), price, closing, value));

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, expected);
        (await client.GetJsonAsync<List<TransactionDto>>($"/api/portfolios/{portfolio}/transactions")).ShouldBeEmpty();
        var code = name.Trim().ToUpperInvariant();
        (await factory.WithDbAsync(db => db.Securities.IgnoreQueryFilters().CountAsync(s => s.Symbol == code && code.Length > 0, Ct))).ShouldBe(0);
    }

    [Fact]
    public async Task WhenTheNameIsAlreadyAHolding_ShouldRefuseTheDuplicate()
    {
        var (client, portfolio) = await NewRealEstatePortfolioAsync();
        await Add(client, portfolio, new PropertyRequest("Cabin", null, Bought, 1m)).ReadAsync<TransactionDto>();

        var response = await Add(client, portfolio, new PropertyRequest("cabin", null, Bought, 2m));

        await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, "You already have a holding called CABIN.");
    }

    [Fact]
    public async Task WhenTheNameIsAQuotedSymbol_ShouldRefuseItToo()
    {
        var (client, portfolio) = await NewRealEstatePortfolioAsync();
        await client.ResolveAsync("SHOP.TO");

        var response = await Add(client, portfolio, new PropertyRequest("Shop.To", null, Bought, 1m));

        await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, "SHOP.TO");
    }
}

[Collection(FolioApiCollection.Name)]
public class ShareEndpointTests(FolioApiFactory factory)
{
    [Fact]
    public async Task WhenTheOwnerListsShares_ShouldSeeThemSortedByEmail()
    {
        var (owner, _) = await factory.NewAccountAsync();
        var (_, zed) = await factory.NewAccountAsync("zed");
        var (_, abe) = await factory.NewAccountAsync("abe");
        var portfolio = await owner.CreatePortfolioAsync("Family");
        await owner.ShareWithAsync(portfolio, zed, canEdit: false);
        await owner.ShareWithAsync(portfolio, abe, canEdit: true);

        var shares = await owner.GetJsonAsync<List<ShareDto>>($"/api/portfolios/{portfolio}/shares");

        shares.Select(s => (s.Email, s.CanEdit)).ShouldBe([(abe, true), (zed, false)]);
    }

    [Fact]
    public async Task WhenTheSameAccountIsSharedAgain_ShouldChangeItsRightsWithoutDuplicating()
    {
        var (owner, _) = await factory.NewAccountAsync();
        var (guest, guestEmail) = await factory.NewAccountAsync();
        var portfolio = await owner.CreatePortfolioAsync("Toggle");

        (await owner.ShareWithAsync(portfolio, guestEmail, canEdit: false)).ShouldHaveSingleItem().CanEdit.ShouldBeFalse();
        (await owner.ShareWithAsync(portfolio, $" {guestEmail.ToUpperInvariant()} ", canEdit: true)).ShouldHaveSingleItem().CanEdit.ShouldBeTrue();

        (await guest.DetailAsync(portfolio)).Summary.Access.ShouldBe("Edit");
    }

    [Fact]
    public async Task WhenTheAddressHasNoActivatedAccount_ShouldRefuseToShare()
    {
        var (owner, _) = await factory.NewAccountAsync();
        var portfolio = await owner.CreatePortfolioAsync("Nobody");
        // Asking for a link creates the account but it stays inactive until the link is used.
        var pending = $"pending-{Guid.NewGuid():N}@example.com";
        (await factory.CreateClient().PostJsonAsync("/api/auth/email-link", new { email = pending })).EnsureSuccessStatusCode();

        foreach (var email in new[] { pending, "   ", string.Empty })
        {
            await (await owner.PutJsonAsync($"/api/portfolios/{portfolio}/shares", new ShareRequest(email, false)))
                .ShouldBeProblemAsync(HttpStatusCode.BadRequest, "No active Folio account uses that email.");
        }
    }

    [Fact]
    public async Task WhenAStrangerOrUnknownPortfolioIsInvolved_ShouldNotAllowSharingAtAll()
    {
        var (owner, _) = await factory.NewAccountAsync();
        var (stranger, strangerEmail) = await factory.NewAccountAsync();
        var portfolio = await owner.CreatePortfolioAsync("Mine");
        var url = $"/api/portfolios/{portfolio}/shares";

        (await stranger.GetResponseAsync(url)).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await stranger.PutJsonAsync(url, new ShareRequest(strangerEmail, true))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await stranger.DeleteResponseAsync($"{url}?email={Uri.EscapeDataString(strangerEmail)}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await owner.GetResponseAsync($"/api/portfolios/{Guid.NewGuid()}/shares")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task WhenAnEditorTriesToManageSharing_ShouldBeForbidden()
    {
        var (owner, _) = await factory.NewAccountAsync();
        var (editor, editorEmail) = await factory.NewAccountAsync();
        var portfolio = await owner.CreatePortfolioAsync("Managed");
        await owner.ShareWithAsync(portfolio, editorEmail, canEdit: true);
        var url = $"/api/portfolios/{portfolio}/shares";

        await (await editor.DeleteResponseAsync($"{url}?email={Uri.EscapeDataString(editorEmail)}")).ShouldBeProblemAsync(HttpStatusCode.Forbidden, "change sharing");
        (await owner.GetJsonAsync<List<ShareDto>>(url)).ShouldHaveSingleItem();
    }

    [Fact]
    public async Task WhenUnsharingSomeoneUnknownOrNotShared_ShouldChangeNothing()
    {
        var (owner, _) = await factory.NewAccountAsync();
        var (_, guestEmail) = await factory.NewAccountAsync();
        var (_, otherEmail) = await factory.NewAccountAsync();
        var portfolio = await owner.CreatePortfolioAsync("Unshare");
        await owner.ShareWithAsync(portfolio, guestEmail, canEdit: false);
        var url = $"/api/portfolios/{portfolio}/shares";

        var afterUnknown = await (await owner.DeleteResponseAsync($"{url}?email=nobody%40example.com")).ReadAsync<List<ShareDto>>();
        var afterOther = await (await owner.DeleteResponseAsync($"{url}?email={Uri.EscapeDataString(otherEmail)}")).ReadAsync<List<ShareDto>>();

        afterUnknown.ShouldHaveSingleItem().Email.ShouldBe(guestEmail);
        afterOther.ShouldHaveSingleItem().Email.ShouldBe(guestEmail);
    }
}
