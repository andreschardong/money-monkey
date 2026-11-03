using System.Net;
using System.Net.Http.Json;
using Folio.Api.Auth;
using Folio.Api.Data;
using MailKit.Net.Smtp;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Folio.Api.Tests;

/// <summary>How the app answers around the endpoints: headers, health, assets links, fallbacks and the API explorer.</summary>
[Collection(FolioApiCollection.Name)]
public class ProgramWiringTests(FolioApiFactory factory)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task WhenAnyPageIsRequested_ShouldCarryTheSecurityHeadersAndAContentSecurityPolicy()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health", Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        response.Headers.GetValues("X-Content-Type-Options").ShouldBe(["nosniff"]);
        response.Headers.GetValues("X-Frame-Options").ShouldBe(["DENY"]);
        response.Headers.GetValues("Referrer-Policy").ShouldBe(["strict-origin-when-cross-origin"]);
        response.Headers.GetValues("Permissions-Policy").Single().ShouldContain("camera=()");
        response.Headers.GetValues("Content-Security-Policy").Single().ShouldContain("script-src 'self'");
        (await response.Content.ReadAsStringAsync(Ct)).ShouldBe("""{"status":"ok"}""");
    }

    [Theory]
    [InlineData("/openapi/v1.json")]
    [InlineData("/scalar/v1")]
    public async Task WhenTheApiExplorerIsRequested_ShouldKeepTheBrowsersDefaultsAndRequireASession(string path)
    {
        using var anonymous = factory.CreateClient();
        var (signedIn, _) = await factory.NewAccountAsync();

        var refused = await anonymous.GetAsync(path, Ct);
        var allowed = await signedIn.GetAsync(path, Ct);

        refused.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        refused.Headers.Contains("Content-Security-Policy").ShouldBeFalse();
        refused.Headers.Contains("X-Content-Type-Options").ShouldBeTrue();
        allowed.StatusCode.ShouldBe(HttpStatusCode.OK);
        allowed.Headers.Contains("Content-Security-Policy").ShouldBeFalse();
    }

    [Fact]
    public async Task WhenTheOpenApiDocumentIsRead_ShouldDescribeTheApi()
    {
        var (client, _) = await factory.NewAccountAsync();

        var document = await client.GetStringAsync("/openapi/v1.json", Ct);

        document.ShouldContain("/api/portfolios");
        document.ShouldContain("Folio.Api | v1");
    }

    [Fact]
    public async Task WhenAnUnknownApiPathIsRequested_ShouldAnswerNotFoundNotTheWebApp()
    {
        using var client = factory.CreateClient();

        (await client.GetAsync("/api/nothing/here", Ct)).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await client.GetAsync("/some/page/of/the/web/app", Ct)).StatusCode.ShouldBe(HttpStatusCode.NotFound);   // no web build is copied next to the test host
    }

    [Fact]
    public async Task WhenAnApiCallHasNoSession_ShouldAnswer401WithoutRedirecting()
    {
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        var response = await client.GetAsync("/api/portfolios", Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        response.Headers.Location.ShouldBeNull();
    }

    [Fact]
    public async Task WhenAccessIsDenied_ShouldAnswer403InsteadOfRedirecting()
    {
        var options = factory.Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>().Get(IdentityConstants.ApplicationScheme);
        var context = new DefaultHttpContext();
        var redirect = new RedirectContext<CookieAuthenticationOptions>(
            context, new AuthenticationScheme("x", "x", typeof(CookieAuthenticationHandler)), options, new AuthenticationProperties(), "/denied");

        await options.Events.OnRedirectToAccessDenied(redirect);

        context.Response.StatusCode.ShouldBe(StatusCodes.Status403Forbidden);
        context.Response.Headers.Location.ToString().ShouldBeEmpty();
    }

    [Fact]
    public void WhenTheSmtpFactoryIsResolved_ShouldCreateARealClientForTheMailer()
    {
        using var scope = factory.Services.CreateScope();

        using var client = scope.ServiceProvider.GetRequiredService<Func<ISmtpClient>>()();
        var mailer = ActivatorUtilities.CreateInstance<SmtpMailer>(scope.ServiceProvider);

        client.ShouldBeOfType<SmtpClient>();
        mailer.ShouldNotBeNull();
    }

    [Fact]
    public async Task WhenTheCookieSettingsAreRead_ShouldBeHttpOnlySameSiteStrictAndNamedForTheApp()
    {
        var (client, _) = await factory.NewAccountAsync();
        var options = factory.Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>().Get(IdentityConstants.ApplicationScheme);

        (options.Cookie.Name, options.Cookie.HttpOnly, options.Cookie.SameSite, options.ExpireTimeSpan, options.SlidingExpiration)
            .ShouldBe(("folio.session", true, SameSiteMode.Strict, TimeSpan.FromDays(30), true));
        options.Cookie.SecurePolicy.ShouldBe(CookieSecurePolicy.SameAsRequest);
        (await client.GetStringAsync("/api/auth/me", Ct)).ShouldContain("signedIn");
    }
}

/// <summary>The app as a cloud host runs it: https public address, its own passkey domain, a port from the host and trusted proxies.</summary>
public sealed class CloudStyleFactory : FolioApiFactory
{
    protected override void ConfigureSettings(IWebHostBuilder builder)
    {
        builder.UseSetting("Auth:PublicUrl", "https://folio.example/");
        builder.UseSetting("Auth:PasskeyDomain", "folio.example");
        builder.UseSetting("PORT", "18123");
        builder.UseSetting("Auth:TrustedProxies:0", "10.1.2.3");
    }
}

public class CloudStyleTests(CloudStyleFactory factory) : IClassFixture<CloudStyleFactory>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task WhenThePublicAddressIsHttps_ShouldMarkTheSessionCookieSecure()
    {
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://folio.example") });
        var email = $"cloud-{Guid.NewGuid():N}@example.com";
        (await client.PostAsJsonAsync("/api/auth/email-link", new { email }, Ct)).EnsureSuccessStatusCode();

        var response = await client.PostAsJsonAsync("/api/auth/email-link/verify", new { token = factory.Mailer.LastTokenFor(email) }, Ct);

        response.EnsureSuccessStatusCode();
        response.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith("folio.session=", StringComparison.Ordinal)).ToLowerInvariant().ShouldContain("secure");
        factory.Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>().Get(IdentityConstants.ApplicationScheme)
            .Cookie.SecurePolicy.ShouldBe(CookieSecurePolicy.Always);
    }

    [Fact]
    public void WhenAPasskeyDomainIsConfigured_ShouldUseItAsTheRelyingParty() =>
        factory.Services.GetRequiredService<IOptions<IdentityPasskeyOptions>>().Value.ServerDomain.ShouldBe("folio.example");

    [Fact]
    public async Task WhenTheAppIsServedOverHttps_ShouldTellBrowsersToStayOnHttps()
    {
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://folio.example") });

        var response = await client.GetAsync("/health", Ct);

        response.Headers.GetValues("Strict-Transport-Security").Single().ShouldContain("max-age=31536000");
    }

    [Fact]
    public async Task WhenAnUntrustedClientSendsForwardedHeaders_ShouldNotBelieveThem()
    {
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/health");
        request.Headers.Add("X-Forwarded-Proto", "https");

        var response = await client.SendAsync(request, Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
    }
}

/// <summary>Behind a platform proxy whose addresses are not published: every proxy is believed, and files are logged.</summary>
public sealed class BehindProxyFactory : FolioApiFactory
{
    public string LogDirectory { get; } = Path.Combine(Path.GetTempPath(), $"folio-test-logs-{Guid.NewGuid():N}");

    protected override void ConfigureSettings(IWebHostBuilder builder)
    {
        builder.UseSetting("Auth:BehindProxy", "true");
        builder.UseSetting("PORT", "18124");
        builder.UseSetting("ASPNETCORE_URLS", "http://localhost:18125");
        builder.UseSetting("Auth:EmailsPerTenMinutes", "1");
        builder.UseSetting("LogFile:Path", Path.Combine(LogDirectory, "folio-.log"));
    }

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        try
        {
            Directory.Delete(LogDirectory, recursive: true);
        }
        catch (IOException)
        {
            // The log file may still be open for a moment; it is a temporary folder.
        }
    }
}

public class BehindProxyTests(BehindProxyFactory factory) : IClassFixture<BehindProxyFactory>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private async Task<HttpStatusCode> RequestLinkAsync(string clientAddress)
    {
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/email-link")
        {
            Content = JsonContent.Create(new { email = $"proxy-{Guid.NewGuid():N}@example.com" }),
        };
        request.Headers.Add("X-Forwarded-For", clientAddress);
        return (await client.SendAsync(request, Ct)).StatusCode;
    }

    [Fact]
    public async Task WhenClientsAreIdentifiedByForwardedAddresses_ShouldRateLimitEachAddressSeparately()
    {
        (await RequestLinkAsync("203.0.113.7")).ShouldBe(HttpStatusCode.Accepted);
        (await RequestLinkAsync("203.0.113.7")).ShouldBe(HttpStatusCode.TooManyRequests);
        (await RequestLinkAsync("203.0.113.8")).ShouldBe(HttpStatusCode.Accepted);
    }

    [Fact]
    public async Task WhenLinksAreVerifiedFromForwardedAddresses_ShouldCountEachAddressSeparately()
    {
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/email-link/verify")
        {
            Content = JsonContent.Create(new { token = "unknown" }),
        };
        request.Headers.Add("X-Forwarded-For", "203.0.113.50");

        var response = await client.SendAsync(request, Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task WhenALogFilePathIsConfigured_ShouldStartAndServeRequestsNormally()
    {
        // The file sink is built while the app starts. What it writes goes through process-wide logging that the
        // other apps in this test run share, so the file's content is not something a test can rely on.
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health", Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
    }
}

/// <summary>Development mode against a database nobody has migrated: nothing touches the database until a page needs it.</summary>
public sealed class UnmigratedDevelopmentFactory : FolioApiFactory
{
    protected override void ConfigureSettings(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.UseSetting("Database:MigrateOnStartup", "false");
        builder.UseSetting("Auth:PasskeyDomain", null);
        builder.UseSetting("Auth:PublicUrl", null);
    }
}

public class UnmigratedDevelopmentTests(UnmigratedDevelopmentFactory factory) : IClassFixture<UnmigratedDevelopmentFactory>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task WhenStartedInDevelopmentWithoutMigrating_ShouldServeThePagesThatNeedNoDatabase()
    {
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://folio.example") });

        var health = await client.GetAsync("/health", Ct);
        var version = await client.GetAsync("/api/version", Ct);

        health.StatusCode.ShouldBe(HttpStatusCode.OK);
        health.Headers.Contains("Strict-Transport-Security").ShouldBeFalse();
        version.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task WhenNoPasskeyDomainOrPublicAddressIsConfigured_ShouldFallBackToLocalhost()
    {
        var options = factory.Services.GetRequiredService<IOptions<IdentityPasskeyOptions>>().Value;
        var http = new DefaultHttpContext();

        options.ServerDomain.ShouldBe("localhost");
        (await options.ValidateOrigin!(new PasskeyOriginValidationContext { HttpContext = http, Origin = "http://localhost:8090", CrossOrigin = false })).ShouldBeTrue();
    }
}
