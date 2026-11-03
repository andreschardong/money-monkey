using System.Net;
using Folio.Api.Auth;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Folio.Api.Tests;

[Collection(FolioApiCollection.Name)]
public class WiringEdgeCaseTests(FolioApiFactory factory)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public void WhenKestrelIsConfigured_ShouldLimitRequestBodiesToTenMegabytes() =>
        factory.Services.GetRequiredService<IOptions<KestrelServerOptions>>().Value.Limits.MaxRequestBodySize.ShouldBe(10 * 1024 * 1024);

    [Fact]
    public void WhenQuoteAndRateClientsAreCreated_ShouldIntroduceThemselvesTheWayEachProviderExpects()
    {
        var clients = factory.Services.GetRequiredService<IHttpClientFactory>();

        var quotes = clients.CreateClient("IQuoteProvider");
        var rates = clients.CreateClient("IFxProvider");

        quotes.DefaultRequestHeaders.UserAgent.ToString().ShouldStartWith("Mozilla/5.0");
        quotes.DefaultRequestHeaders.Accept.ToString().ShouldBe("application/json");
        rates.DefaultRequestHeaders.UserAgent.ToString().ShouldBe("Folio/1.0");
        clients.CreateClient("IFallbackQuoteProvider").ShouldNotBeNull();
    }

    [Fact]
    public async Task WhenTheBrowserAbandonsARequest_ShouldEndItQuietlyWithoutAnError()
    {
        var (client, _) = await factory.NewAccountAsync();
        var searching = new TaskCompletionSource();
        factory.Quotes.BeforeSearch = async ct =>
        {
            searching.TrySetResult();
            await Task.Delay(Timeout.Infinite, ct);
        };
        var id = Guid.NewGuid().ToString("N");
        try
        {
            using var cancel = new CancellationTokenSource();
            using var request = new HttpRequestMessage(HttpMethod.Get, "/api/securities/search?q=apple");
            request.Headers.Add("X-Test-Request", id);
            var pending = client.SendAsync(request, cancel.Token);
            await searching.Task.WaitAsync(TimeSpan.FromSeconds(30), Ct);

            await cancel.CancelAsync();

            await Should.ThrowAsync<TaskCanceledException>(() => pending);
            await factory.Requests.WhenCompletedAsync(id);
        }
        finally
        {
            factory.Quotes.BeforeSearch = null;
        }
    }

    [Fact]
    public async Task WhenAServerErrorOccurs_ShouldAnswer500WithoutDetails()
    {
        var (client, _) = await factory.NewAccountAsync();
        factory.Quotes.SearchFailure = new InvalidOperationException("secret detail");
        try
        {
            var response = await client.GetResponseAsync("/api/securities/search?q=apple");

            response.StatusCode.ShouldBe(HttpStatusCode.InternalServerError);
            (await response.Content.ReadAsStringAsync(Ct)).ShouldNotContain("secret detail");
        }
        finally
        {
            factory.Quotes.SearchFailure = null;
        }
    }
}

/// <summary>Which origins a passkey ceremony may come from.</summary>
public class PasskeyOriginTests(AndroidAppFactory factory) : IClassFixture<AndroidAppFactory>
{
    private ValueTask<bool> Validate(string origin, bool crossOrigin = false, string scheme = "https", string host = "folio.test")
    {
        var http = new DefaultHttpContext();
        http.Request.Scheme = scheme;
        http.Request.Host = new HostString(host);
        var options = factory.Services.GetRequiredService<IOptions<IdentityPasskeyOptions>>().Value;
        return options.ValidateOrigin!(new PasskeyOriginValidationContext { HttpContext = http, Origin = origin, CrossOrigin = crossOrigin });
    }

    [Theory]
    [InlineData("http://localhost", true)]
    [InlineData("HTTP://LOCALHOST", true)]
    [InlineData("https://folio.test", true)]
    [InlineData("android:apk-key-hash:FG3pg8VzBlDY7rmVLzT8ZBagg0LmHb6oigSWsj_PROU", true)]
    [InlineData("https://evil.example", false)]
    [InlineData("android:apk-key-hash:somebody-else", false)]
    public async Task WhenAnOriginIsChecked_ShouldAcceptThePublicAddressTheRequestsOwnOriginAndTrustedApps(string origin, bool expected) =>
        (await Validate(origin)).ShouldBe(expected);

    [Fact]
    public async Task WhenTheCeremonyIsCrossOrigin_ShouldRefuseEvenAKnownOrigin() =>
        (await Validate("http://localhost", crossOrigin: true)).ShouldBeFalse();
}
