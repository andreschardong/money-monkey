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

    [Theory]
    [InlineData("1.2.3", null, "1.2.3", null)]
    [InlineData("1.2.3+abc1234", "", "1.2.3", "abc1234")]                                          // the deploy script's short SHA
    [InlineData("1.2.3+0123456789abcdef0123456789abcdef01234567", null, "1.2.3", "0123456")]     // CI's full SHA
    [InlineData("1.2.3+", "not a date", "1.2.3", null)]
    public void The_informational_version_splits_into_version_and_short_commit(string informational, string? builtAt, string version, string? commit)
    {
        var parsed = AppVersion.Parse(informational, builtAt);
        Assert.Equal(version, parsed.Version);
        Assert.Equal(commit, parsed.Commit);
        Assert.Null(parsed.BuiltAt);
    }

    [Fact]
    public void The_build_time_is_read_as_UTC()
    {
        var parsed = AppVersion.Parse("1.0.0", "2026-10-11T19:51:50Z");
        Assert.Equal(new DateTimeOffset(2026, 10, 11, 19, 51, 50, TimeSpan.Zero), parsed.BuiltAt);
    }
}
