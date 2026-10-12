using System.Globalization;
using System.Reflection;

namespace Folio.Api.Endpoints;

/// <summary>Which build is running: the version from Directory.Build.props, the commit it was built from, and when.</summary>
public static class VersionEndpoints
{
    public static void MapVersionEndpoints(this IEndpointRouteBuilder api) =>
        api.MapGet("/version", (IConfiguration configuration) => AppVersion.Describe(configuration)).AllowAnonymous().WithTags("About");
}

public sealed record VersionDto(string Version, string? Commit, DateTimeOffset? BuiltAt);

public static class AppVersion
{
    /// <summary>
    /// The informational version is "1.2.3" locally and "1.2.3+abc1234" when the image was built with a
    /// SourceRevisionId; App:BuiltAt is set by the image build. Nothing here is secret: the commit is public.
    /// </summary>
    public static VersionDto Describe(IConfiguration configuration) =>
        Parse(typeof(AppVersion).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
                ?? typeof(AppVersion).Assembly.GetName().Version?.ToString(3)
                ?? "0.0.0",
            configuration["App:BuiltAt"]);

    /// <summary>Splits "1.2.3+sha" into the version and a 7-character commit; a missing or invalid build time is null.</summary>
    public static VersionDto Parse(string informational, string? builtAtSetting)
    {
        var plus = informational.IndexOf('+');
        var version = plus >= 0 ? informational[..plus] : informational;
        var commit = plus >= 0 ? informational[(plus + 1)..] : null;
        if (commit is { Length: > 7 })
            commit = commit[..7];

        DateTimeOffset? builtAt = DateTimeOffset.TryParse(builtAtSetting, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed)
            ? parsed
            : null;
        return new VersionDto(version, string.IsNullOrWhiteSpace(commit) ? null : commit, builtAt);
    }
}
