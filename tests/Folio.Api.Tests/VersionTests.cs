using System.Net.Http.Json;
using System.Text.RegularExpressions;
using Folio.Api.Endpoints;

namespace Folio.Api.Tests;

public class VersionTests(FolioApiFactory factory) : IClassFixture<FolioApiFactory>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task The_version_is_public_and_matches_the_build()
    {
        using var anonymous = factory.CreateClient();
        var version = await anonymous.GetFromJsonAsync<VersionDto>("/api/version", Ct);
        Assert.NotNull(version);
        Assert.Matches(new Regex(@"^\d+\.\d+\.\d+$"), version.Version);
        Assert.Equal(typeof(Program).Assembly.GetName().Version?.ToString(3), version.Version);
    }
}
