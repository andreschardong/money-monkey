namespace Folio.Api.Auth;

/// <summary>
/// The Android app builds allowed to use this server's passkeys and to open its sign-in links: a package name and
/// the SHA-256 fingerprints of the certificates it is signed with (debug and release). Configured as
/// <c>Auth:AndroidApps</c>, for example
/// <c>com.example.moneymonkey=AA:BB:...:FF,11:22:...:99</c>, several apps separated by semicolons.
/// </summary>
public sealed record AndroidApp(string PackageName, IReadOnlyList<string> Fingerprints)
{
    public static IReadOnlyList<AndroidApp> Parse(string? setting)
    {
        if (string.IsNullOrWhiteSpace(setting))
            return [];

        var apps = new List<AndroidApp>();
        foreach (var entry in setting.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var parts = entry.Split('=', 2, StringSplitOptions.TrimEntries);
            if (parts.Length != 2 || parts[0].Length == 0)
                throw new InvalidOperationException($"Auth:AndroidApps entry \"{entry}\" is not \"package=FINGERPRINT[,FINGERPRINT]\".");

            var fingerprints = parts[1].Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(Normalize)
                .ToList();
            apps.Add(new AndroidApp(parts[0], fingerprints));
        }

        return apps;
    }

    /// <summary>
    /// The origin Android reports for a passkey ceremony made by an app signed with this certificate:
    /// "android:apk-key-hash:" and the certificate's SHA-256 in unpadded base64url.
    /// </summary>
    public static string OriginOf(string fingerprint)
    {
        var bytes = Convert.FromHexString(Normalize(fingerprint).Replace(":", string.Empty, StringComparison.Ordinal));
        var base64 = Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        return $"android:apk-key-hash:{base64}";
    }

    /// <summary>Upper-case, colon-separated pairs, the form keytool prints and assetlinks.json expects.</summary>
    private static string Normalize(string fingerprint)
    {
        var hex = fingerprint.Replace(":", string.Empty, StringComparison.Ordinal).Trim().ToUpperInvariant();
        if (hex.Length != 64 || !hex.All(Uri.IsHexDigit))
            throw new InvalidOperationException($"\"{fingerprint}\" is not a SHA-256 certificate fingerprint (32 bytes in hex).");
        return string.Join(':', Enumerable.Range(0, 32).Select(i => hex.Substring(i * 2, 2)));
    }
}
