using System.Net;
using System.Net.Http.Json;
using Folio.Api.Auth;

namespace Folio.Api.Tests;

/// <summary>With Auth:AllowedEmails set, only the listed addresses can create an account or keep using one.</summary>
public class RegistrationTests(RestrictedFolioApiFactory factory) : IClassFixture<RestrictedFolioApiFactory>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task An_address_that_is_not_on_the_list_cannot_create_an_account()
    {
        using var client = factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/auth/email-link", new { email = "stranger@example.com" }, Ct);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Contains("invited", await response.Content.ReadAsStringAsync(Ct));
        Assert.DoesNotContain(factory.Mailer.Sent, m => m.To == "stranger@example.com");
    }

    [Fact]
    public async Task A_listed_address_signs_up_whatever_its_case_and_keeps_signing_in()
    {
        using var client = factory.CreateClient();
        var email = RestrictedFolioApiFactory.Invited.ToUpperInvariant();
        (await client.PostAsJsonAsync("/api/auth/email-link", new { email }, Ct)).EnsureSuccessStatusCode();
        var token = factory.Mailer.LastTokenFor(email);   // the address as typed
        (await client.PostAsJsonAsync("/api/auth/email-link/verify", new { token }, Ct)).EnsureSuccessStatusCode();
        (await client.GetAsync("/api/portfolios", Ct)).EnsureSuccessStatusCode();

        // A second link for the now-existing account works as before.
        (await client.PostAsJsonAsync("/api/auth/email-link", new { email = RestrictedFolioApiFactory.Invited }, Ct)).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Taking_an_address_off_the_list_locks_that_account_out_at_its_next_request()
    {
        const string email = "other@example.com";
        using var client = await factory.CreateSignedInClientAsync(email);
        (await client.GetAsync("/api/portfolios", Ct)).EnsureSuccessStatusCode();

        factory.Settings.Set("Auth:AllowedEmails", RestrictedFolioApiFactory.Invited);
        try
        {
            // The session is rejected, and a new link is refused too.
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/portfolios", Ct)).StatusCode);
            var link = await client.PostAsJsonAsync("/api/auth/email-link", new { email }, Ct);
            Assert.Equal(HttpStatusCode.Forbidden, link.StatusCode);
            Assert.Contains("invited", await link.Content.ReadAsStringAsync(Ct));
        }
        finally
        {
            factory.Settings.Set("Auth:AllowedEmails", $" {RestrictedFolioApiFactory.Invited} , {email} ");
        }

        // Back on the list, a fresh sign-in works again.
        using var again = await factory.CreateSignedInClientAsync(email);
        (await again.GetAsync("/api/portfolios", Ct)).EnsureSuccessStatusCode();
    }

    [Theory]
    [InlineData("", "anyone@example.com", true)]
    [InlineData("a@example.com, b@example.com", "B@Example.com", true)]
    [InlineData("a@example.com;b@example.com", "c@example.com", false)]
    [InlineData(" a@example.com \n b@example.com ", "a@example.com", true)]
    public void The_list_accepts_commas_semicolons_and_newlines(string list, string email, bool expected)
    {
        var options = new AuthOptions { AllowedEmails = list };
        Assert.Equal(expected, options.IsAllowed(email));
    }
}
