using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Folio.Api.Auth;
using Folio.Api.Data;
using Folio.Api.Endpoints;

namespace Folio.Api.Tests;

public class AuthApiTests(FolioApiFactory factory) : IClassFixture<FolioApiFactory>
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Without_a_session_the_api_answers_401_and_me_says_signed_out()
    {
        using var client = factory.CreateClient();

        var me = await client.GetFromJsonAsync<MeDto>("/api/auth/me", Json, Ct);
        Assert.False(me!.SignedIn);

        var response = await client.GetAsync("/api/portfolios", Ct);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task A_new_email_gets_an_activation_link_that_signs_in_once()
    {
        using var client = factory.CreateClient();
        var email = $"new-{Guid.NewGuid():N}@example.com";

        var sent = await client.PostAsJsonAsync("/api/auth/email-link", new { email }, Ct);
        Assert.Equal(HttpStatusCode.Accepted, sent.StatusCode);
        var mail = factory.Mailer.Sent.Last(m => m.To == email);
        Assert.Equal("Activate your Money Monkey account", mail.Subject);

        var token = factory.Mailer.LastTokenFor(email);
        var verified = await client.PostAsJsonAsync("/api/auth/email-link/verify", new { token }, Ct);
        verified.EnsureSuccessStatusCode();
        var me = await verified.Content.ReadFromJsonAsync<MeDto>(Json, Ct);
        Assert.True(me!.SignedIn);
        Assert.Equal(email, me.Email);
        Assert.Equal(0, me.Passkeys);

        // The same link cannot be used twice.
        using var other = factory.CreateClient();
        var again = await other.PostAsJsonAsync("/api/auth/email-link/verify", new { token }, Ct);
        Assert.Equal(HttpStatusCode.BadRequest, again.StatusCode);

        // An active account gets a sign-in link next time.
        (await client.PostAsJsonAsync("/api/auth/email-link", new { email }, Ct)).EnsureSuccessStatusCode();
        Assert.Equal("Your Money Monkey sign-in link", factory.Mailer.Sent.Last(m => m.To == email).Subject);
    }

    [Fact]
    public async Task Portfolios_belong_to_the_account_that_created_them()
    {
        using var alice = await factory.CreateSignedInClientAsync();
        using var bob = await factory.CreateSignedInClientAsync();

        var created = await alice.PostAsJsonAsync("/api/portfolios", new CreatePortfolioRequest("Alice's TFSA", "CAD", null), Ct);
        created.EnsureSuccessStatusCode();
        var portfolio = await created.Content.ReadFromJsonAsync<PortfolioSummaryDto>(Json, Ct);

        var bobsList = await bob.GetFromJsonAsync<List<PortfolioSummaryDto>>("/api/portfolios", Json, Ct);
        Assert.DoesNotContain(bobsList!, p => p.Id == portfolio!.Id);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync($"/api/portfolios/{portfolio!.Id}", Ct)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.DeleteAsync($"/api/portfolios/{portfolio.Id}", Ct)).StatusCode);

        var alicesList = await alice.GetFromJsonAsync<List<PortfolioSummaryDto>>("/api/portfolios", Json, Ct);
        Assert.Contains(alicesList!, p => p.Id == portfolio.Id);
    }

    [Fact]
    public async Task Manually_priced_securities_are_private_to_their_account()
    {
        using var alice = await factory.CreateSignedInClientAsync();
        using var bob = await factory.CreateSignedInClientAsync();

        var created = await alice.PostAsJsonAsync("/api/securities/manual",
            new ManualSecurityRequest("GIC-A", "Alice's GIC", "CAD", AssetType.Other, 1m, null), Json, Ct);
        created.EnsureSuccessStatusCode();
        var gic = await created.Content.ReadFromJsonAsync<SecurityDto>(Json, Ct);

        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync($"/api/securities/{gic!.Id}", Ct)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await bob.PostAsJsonAsync($"/api/securities/{gic.Id}/prices", new ManualPriceRequest(new DateOnly(2026, 10, 1), 2m), Json, Ct)).StatusCode);
        var bobsSearch = await bob.GetFromJsonAsync<List<SymbolMatchDto>>("/api/securities/search?q=GIC-A", Json, Ct);
        Assert.DoesNotContain(bobsSearch!, m => m.SecurityId == gic.Id);
        var bobsList = await bob.GetFromJsonAsync<List<SecurityDto>>("/api/securities", Json, Ct);
        Assert.DoesNotContain(bobsList!, s => s.Id == gic.Id);

        // The same code is free for Bob's own.
        var bobs = await bob.PostAsJsonAsync("/api/securities/manual",
            new ManualSecurityRequest("GIC-A", "Bob's GIC", "CAD", AssetType.Other, 1m, null), Json, Ct);
        bobs.EnsureSuccessStatusCode();

        // And Alice still sees only hers.
        var alicesList = await alice.GetFromJsonAsync<List<SecurityDto>>("/api/securities", Json, Ct);
        Assert.Single(alicesList!, s => s.Symbol == "GIC-A" && s.Name == "Alice's GIC");
    }

    [Fact]
    public async Task Signing_out_ends_the_session()
    {
        using var client = await factory.CreateSignedInClientAsync();
        Assert.True((await client.GetFromJsonAsync<MeDto>("/api/auth/me", Json, Ct))!.SignedIn);

        (await client.PostAsync("/api/auth/sign-out", null, Ct)).EnsureSuccessStatusCode();

        Assert.False((await client.GetFromJsonAsync<MeDto>("/api/auth/me", Json, Ct))!.SignedIn);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/portfolios", Ct)).StatusCode);
    }

    [Fact]
    public async Task A_newer_link_retires_the_older_one()
    {
        using var client = factory.CreateClient();
        var email = $"twice-{Guid.NewGuid():N}@example.com";
        (await client.PostAsJsonAsync("/api/auth/email-link", new { email }, Ct)).EnsureSuccessStatusCode();
        var first = factory.Mailer.LastTokenFor(email);
        (await client.PostAsJsonAsync("/api/auth/email-link", new { email }, Ct)).EnsureSuccessStatusCode();
        var second = factory.Mailer.LastTokenFor(email);

        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/auth/email-link/verify", new { token = first }, Ct)).StatusCode);
        (await client.PostAsJsonAsync("/api/auth/email-link/verify", new { token = second }, Ct)).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task A_link_for_another_account_asks_before_switching()
    {
        using var client = await factory.CreateSignedInClientAsync();
        var other = $"other-{Guid.NewGuid():N}@example.com";
        (await client.PostAsJsonAsync("/api/auth/email-link", new { email = other }, Ct)).EnsureSuccessStatusCode();
        var token = factory.Mailer.LastTokenFor(other);

        var refused = await client.PostAsJsonAsync("/api/auth/email-link/verify", new { token }, Ct);
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);

        // Refusing did not use the link up; confirming switches the session to the other account.
        var switched = await client.PostAsJsonAsync("/api/auth/email-link/verify", new { token, confirmSwitch = true }, Ct);
        switched.EnsureSuccessStatusCode();
        Assert.Equal(other, (await switched.Content.ReadFromJsonAsync<MeDto>(Json, Ct))!.Email);
    }

    [Fact]
    public async Task Removing_an_unknown_passkey_is_404()
    {
        using var client = await factory.CreateSignedInClientAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await client.DeleteAsync("/api/account/passkeys/AAAAAAAAAAAAAAAAAAAAAA", Ct)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.DeleteAsync("/api/account/passkeys/not%20base64!", Ct)).StatusCode);
    }

    [Fact]
    public async Task Signing_out_everywhere_ends_the_other_devices_session_too()
    {
        var email = $"devices-{Guid.NewGuid():N}@example.com";
        using var laptop = await factory.CreateSignedInClientAsync(email);
        using var phone = await factory.CreateSignedInClientAsync(email);
        (await phone.GetAsync("/api/portfolios", Ct)).EnsureSuccessStatusCode();

        (await laptop.PostAsync("/api/account/sign-out-everywhere", null, Ct)).EnsureSuccessStatusCode();

        // The phone's cookie is re-validated against the security stamp once the validation interval has passed.
        factory.Time.Advance(TimeSpan.FromMinutes(6));
        Assert.Equal(HttpStatusCode.Unauthorized, (await phone.GetAsync("/api/portfolios", Ct)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await laptop.GetAsync("/api/portfolios", Ct)).StatusCode);
    }

    [Fact]
    public async Task Hiding_gains_is_saved_on_the_account_so_every_device_agrees()
    {
        var email = $"prefs-{Guid.NewGuid():N}@example.com";
        using var laptop = await factory.CreateSignedInClientAsync(email);
        Assert.False((await laptop.GetFromJsonAsync<MeDto>("/api/auth/me", Json, Ct))!.HideGains);

        var saved = await laptop.PutAsJsonAsync("/api/account/preferences", new PreferencesRequest(true), Json, Ct);
        saved.EnsureSuccessStatusCode();
        Assert.True((await saved.Content.ReadFromJsonAsync<MeDto>(Json, Ct))!.HideGains);

        // Another device signing in to the same account sees the choice, and may change it back.
        using var phone = await factory.CreateSignedInClientAsync(email);
        Assert.True((await phone.GetFromJsonAsync<MeDto>("/api/auth/me", Json, Ct))!.HideGains);
        (await phone.PutAsJsonAsync("/api/account/preferences", new PreferencesRequest(false), Json, Ct)).EnsureSuccessStatusCode();
        Assert.False((await laptop.GetFromJsonAsync<MeDto>("/api/auth/me", Json, Ct))!.HideGains);

        using var anonymous = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await anonymous.PutAsJsonAsync("/api/account/preferences", new PreferencesRequest(true), Json, Ct)).StatusCode);
    }

    [Fact]
    public async Task Transactions_and_suggestions_of_another_account_are_out_of_reach()
    {
        using var alice = await factory.CreateSignedInClientAsync();
        using var bob = await factory.CreateSignedInClientAsync();
        var created = await alice.PostAsJsonAsync("/api/portfolios", new CreatePortfolioRequest("Alice", "CAD", null), Json, Ct);
        var portfolio = (await created.Content.ReadFromJsonAsync<PortfolioSummaryDto>(Json, Ct))!.Id;
        var added = await alice.PostAsJsonAsync($"/api/portfolios/{portfolio}/transactions",
            new TransactionRequest(Core.TransactionType.Deposit, new DateOnly(2026, 9, 1), Amount: 100m), Json, Ct);
        added.EnsureSuccessStatusCode();
        var transaction = (await added.Content.ReadFromJsonAsync<List<TransactionDto>>(Json, Ct))![0].Id;

        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync($"/api/portfolios/{portfolio}/transactions", Ct)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.DeleteAsync($"/api/portfolios/{portfolio}/transactions/{transaction}", Ct)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync($"/api/portfolios/{portfolio}/suggestions", Ct)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync($"/api/portfolios/{portfolio}/history?range=1Y", Ct)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.PostAsJsonAsync($"/api/portfolios/{portfolio}/transactions",
            new TransactionRequest(Core.TransactionType.Deposit, new DateOnly(2026, 9, 2), Amount: 1m), Json, Ct)).StatusCode);
        (await alice.GetAsync($"/api/portfolios/{portfolio}/transactions", Ct)).EnsureSuccessStatusCode();
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-an-email")]
    [InlineData("Bob <bob@example.com>")]
    public async Task A_bad_email_address_is_rejected(string email)
    {
        using var client = factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/auth/email-link", new { email }, Ct);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Passkey_options_are_available_to_a_signed_in_account_only()
    {
        using var anonymous = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsync("/api/account/passkeys/options", null, Ct)).StatusCode);

        using var client = await factory.CreateSignedInClientAsync();
        var response = await client.PostAsync("/api/account/passkeys/options", null, Ct);
        response.EnsureSuccessStatusCode();
        using var options = JsonDocument.Parse(await response.Content.ReadAsStringAsync(Ct));
        Assert.Equal("localhost", options.RootElement.GetProperty("rp").GetProperty("id").GetString());
        Assert.Equal("required", options.RootElement.GetProperty("authenticatorSelection").GetProperty("residentKey").GetString());

        // Sign-in options need no account: the browser offers whichever passkeys it holds for this site.
        var request = await anonymous.PostAsync("/api/auth/passkey/options", null, Ct);
        request.EnsureSuccessStatusCode();
        using var requestOptions = JsonDocument.Parse(await request.Content.ReadAsStringAsync(Ct));
        Assert.False(string.IsNullOrEmpty(requestOptions.RootElement.GetProperty("challenge").GetString()));
    }
}
