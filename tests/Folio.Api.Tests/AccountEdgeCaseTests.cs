using System.Net;
using System.Net.Http.Json;
using Folio.Api.Auth;
using Folio.Api.Endpoints;
using Folio.Core;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Folio.Api.Tests;

[Collection(FolioApiCollection.Name)]
public class AccountEdgeCaseTests(FolioApiFactory factory) : IDisposable
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public void Dispose()
    {
        factory.Identity.Reset();
        factory.Commands.BeforeNonQuery = null;
        factory.Settings.Set("Auth:AllowedEmails", string.Empty);
        GC.SuppressFinalize(this);
    }

    private Task<HttpResponseMessage> SendWithAsync(HttpClient client, HttpMethod method, string url, string principal, object? body = null)
    {
        var request = new HttpRequestMessage(method, url);
        request.Headers.Add("X-Test-Principal", principal);
        if (body is not null)
            request.Content = JsonContent.Create(body, options: ApiClient.Json);
        return client.SendAsync(request, Ct);
    }

    [Theory]
    [InlineData("""{"email":null}""")]
    [InlineData("{}")]
    public async Task WhenNoEmailIsGiven_ShouldAskForAValidOne(string body)
    {
        using var anonymous = factory.CreateClient();
        using var content = new StringContent(body, System.Text.Encoding.UTF8, "application/json");

        var response = await anonymous.PostAsync("/api/auth/email-link", content, Ct);

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "Enter a valid email address.");
    }

    [Fact]
    public async Task WhenALinkIsUsedElsewhereBetweenCheckingAndRedeeming_ShouldAnswerThatItExpired()
    {
        var (_, email) = await factory.NewAccountAsync();
        using var device = factory.CreateClient();
        (await device.PostJsonAsync("/api/auth/email-link", new EmailLinkRequest(email))).EnsureSuccessStatusCode();
        var token = factory.Mailer.LastTokenFor(email);
        var connectionString = factory.Services.GetRequiredService<IConfiguration>().GetConnectionString("Folio")!;
        var intervened = false;
        factory.Commands.BeforeNonQuery = async command =>
        {
            if (intervened || !command.CommandText.Contains("UPDATE email_links", StringComparison.Ordinal))
                return;
            intervened = true;
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync(Ct);
            await using var rival = new NpgsqlCommand("UPDATE email_links SET used_at = now() WHERE used_at IS NULL", connection);
            await rival.ExecuteNonQueryAsync(Ct);
        };

        var response = await device.PostJsonAsync("/api/auth/email-link/verify", new VerifyEmailLinkRequest(token));

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "expired or was already used");
        intervened.ShouldBeTrue();
        (await device.GetJsonAsync<MeDto>("/api/auth/me")).SignedIn.ShouldBeFalse();
    }

    [Fact]
    public async Task WhenTheRequestCarriesNoIdentityAtAll_ShouldBeTreatedAsSignedOutAndStillAcceptALink()
    {
        var (_, email) = await factory.NewAccountAsync();
        using var device = factory.CreateClient();
        (await device.PostJsonAsync("/api/auth/email-link", new EmailLinkRequest(email))).EnsureSuccessStatusCode();
        var token = factory.Mailer.LastTokenFor(email);

        var me = await (await SendWithAsync(device, HttpMethod.Get, "/api/auth/me", "NoIdentity")).ReadAsync<MeDto>();
        var verified = await (await SendWithAsync(device, HttpMethod.Post, "/api/auth/email-link/verify", "NoIdentity", new VerifyEmailLinkRequest(token))).ReadAsync<MeDto>();

        me.SignedIn.ShouldBeFalse();
        (verified.SignedIn, verified.Email).ShouldBe((true, email));
    }

    [Fact]
    public async Task WhenTheSignedInUserHasNoIdentifier_ShouldRefuseToImportForThem()
    {
        using var client = factory.CreateClient();
        var file = new ExportDto(DateTimeOffset.UtcNow, [new ExportPortfolioDto(Guid.NewGuid(), "P", "CAD", null, DateTimeOffset.UtcNow, [], [])]);

        var response = await SendWithAsync(client, HttpMethod.Post, "/api/import", "NoUserId", file);

        await response.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "Sign in to import.");
    }

    [Fact]
    public async Task WhenTheSessionCookieCarriesNoEmailClaim_ShouldStillLockOutAnAddressRemovedFromTheList()
    {
        factory.Identity.OmitEmailClaim = true;
        var (client, email) = await factory.NewAccountAsync();
        factory.Identity.OmitEmailClaim = false;

        (await client.GetResponseAsync("/api/portfolios")).StatusCode.ShouldBe(HttpStatusCode.OK);
        factory.Settings.Set("Auth:AllowedEmails", "someone-else@example.com");

        (await client.GetResponseAsync("/api/portfolios")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        email.ShouldNotBeNullOrEmpty();
    }
}
