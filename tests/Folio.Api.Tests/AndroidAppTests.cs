using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Folio.Api.Auth;

namespace Folio.Api.Tests;

public class AndroidAppTests
{
    private const string Fingerprint = "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5";

    [Fact]
    public void A_setting_lists_apps_and_their_certificate_fingerprints()
    {
        var apps = AndroidApp.Parse($" com.example.mm = {Fingerprint.ToLowerInvariant()} , {Fingerprint.Replace(":", "")} ; org.other=" + Fingerprint);
        Assert.Equal(["com.example.mm", "org.other"], apps.Select(a => a.PackageName));
        Assert.Equal([Fingerprint, Fingerprint], apps[0].Fingerprints);
        Assert.Empty(AndroidApp.Parse(""));
        Assert.Throws<InvalidOperationException>(() => AndroidApp.Parse("com.example.mm=not-a-fingerprint"));
    }

    [Fact]
    public void The_passkey_origin_is_the_certificate_hash_in_unpadded_base64url()
    {
        // The documented example: this certificate fingerprint gives this origin.
        Assert.Equal("android:apk-key-hash:FG3pg8VzBlDY7rmVLzT8ZBagg0LmHb6oigSWsj_PROU", AndroidApp.OriginOf(Fingerprint));
    }
}

public class AssetLinksTests(AndroidAppFactory factory) : IClassFixture<AndroidAppFactory>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Asset_links_name_the_app_for_links_and_passkeys_without_signing_in()
    {
        using var anonymous = factory.CreateClient();
        var response = await anonymous.GetAsync("/.well-known/assetlinks.json", Ct);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);

        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(Ct));
        var statement = Assert.Single(json.RootElement.EnumerateArray());
        Assert.Equal(["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
            statement.GetProperty("relation").EnumerateArray().Select(r => r.GetString()));
        var target = statement.GetProperty("target");
        Assert.Equal("android_app", target.GetProperty("namespace").GetString());
        Assert.Equal(AndroidAppFactory.Package, target.GetProperty("package_name").GetString());
        Assert.Equal(AndroidAppFactory.Fingerprint, target.GetProperty("sha256_cert_fingerprints")[0].GetString());
    }
}

/// <summary>The app with one Android app trusted.</summary>
public sealed class AndroidAppFactory : FolioApiFactory
{
    public const string Package = "com.example.moneymonkey";
    public const string Fingerprint = "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5";

    protected override string AndroidApps => $"{Package}={Fingerprint}";
}
