using System.Globalization;
using System.Web;

namespace Folio.Api.Data;

/// <summary>
/// Hosts such as Railway, Neon, Render and Heroku hand out the database as a URL
/// (postgresql://user:password@host:5432/name?sslmode=require), which Npgsql does not read.
/// This turns it into the key-value form; anything already in that form passes through.
/// </summary>
public static class DatabaseUrl
{
    public static string ToConnectionString(string value)
    {
        value = value.Trim();
        if (!value.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase) &&
            !value.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase))
            return value;

        var uri = new Uri(value);
        var parts = new List<string> { $"Host={uri.Host}" };
        if (uri.Port > 0)
            parts.Add($"Port={uri.Port.ToString(CultureInfo.InvariantCulture)}");

        var database = uri.AbsolutePath.Trim('/');
        if (database.Length > 0)
            parts.Add($"Database={Uri.UnescapeDataString(database)}");

        var userInfo = uri.UserInfo.Split(':', 2);
        if (userInfo[0].Length > 0)
            parts.Add($"Username={Uri.UnescapeDataString(userInfo[0])}");
        if (userInfo.Length > 1)
            parts.Add($"Password={Quote(Uri.UnescapeDataString(userInfo[1]))}");

        // libpq's query options, in the names Npgsql uses; anything else (e.g. Neon's channel_binding) is dropped
        // rather than passed through, because an unknown keyword would stop the app from starting.
        var query = HttpUtility.ParseQueryString(uri.Query);
        foreach (var key in query.AllKeys)
        {
            if (key is null || query[key] is not { Length: > 0 } option)
                continue;
            var keyword = key.ToLowerInvariant() switch
            {
                "sslmode" => "SSL Mode",
                "channel_binding" => "Channel Binding",
                "application_name" => "Application Name",
                "connect_timeout" => "Timeout",
                "options" => "Options",
                _ => null,
            };
            if (keyword is not null)
                parts.Add($"{keyword}={Quote(keyword is "SSL Mode" ? SslMode(option) : keyword is "Channel Binding" ? Capitalize(option) : option)}");
        }

        return string.Join(';', parts);
    }

    /// <summary>
    /// libpq's sslmode names in Npgsql's spelling. "require" only encrypts in libpq; here it becomes VerifyFull,
    /// which also checks the server's certificate, because a cloud database deserves that and Neon, Railway and
    /// friends present publicly trusted certificates. Use "verify-ca" to skip the host-name check.
    /// </summary>
    private static string SslMode(string value) => value.ToLowerInvariant() switch
    {
        "disable" => "Disable",
        "allow" => "Allow",
        "prefer" => "Prefer",
        "require" => "VerifyFull",
        "verify-ca" => "VerifyCA",
        "verify-full" => "VerifyFull",
        _ => "VerifyFull",
    };

    /// <summary>Npgsql quotes values with single quotes, doubling any quote inside.</summary>
    private static string Quote(string value) =>
        value.IndexOfAny([';', '\'', ' ']) >= 0 ? $"'{value.Replace("'", "''")}'" : value;

    private static string Capitalize(string value) =>
        value.Length == 0 ? value : char.ToUpperInvariant(value[0]) + value[1..].ToLowerInvariant();
}
