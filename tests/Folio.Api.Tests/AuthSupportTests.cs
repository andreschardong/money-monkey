using Folio.Api.Auth;

namespace Folio.Api.Tests;

public class AuthSupportTests
{
    [Theory]
    [InlineData("andre@example.com", "a***@example.com")]
    [InlineData("@example.com", "***")]
    [InlineData("no-at-sign", "***")]
    [InlineData("", "***")]
    public void WhenEmailIsMasked_ShouldKeepOnlyTheFirstLetterAndTheDomain(string email, string expected) =>
        EmailMasking.Mask(email).ShouldBe(expected);

    [Fact]
    public void WhenActivationEmailIsBuilt_ShouldCarryTheLinkInHtmlAndText()
    {
        var (subject, html, text) = EmailTemplates.Activation("https://folio.example/email-link?token=a&b=<c>", TimeSpan.FromHours(24));

        subject.ShouldBe("Activate your Money Monkey account");
        html.ShouldContain("href=\"https://folio.example/email-link?token=a&amp;b=&lt;c&gt;\"");
        html.ShouldContain("Activate my account");
        html.ShouldContain("expires in 24 hours");
        text.ShouldContain("Activate my account: https://folio.example/email-link?token=a&b=<c>");
        text.ShouldContain("expires in 24 hours");
    }

    [Fact]
    public void WhenSignInEmailIsBuilt_ShouldSayWhenTheLinkExpires()
    {
        var (subject, html, text) = EmailTemplates.SignIn("https://folio.example/x", TimeSpan.FromMinutes(15));

        subject.ShouldBe("Your Money Monkey sign-in link");
        html.ShouldContain("Sign in to Money Monkey");
        html.ShouldContain("expires in 15 minutes");
        text.ShouldContain("Sign in to Money Monkey: https://folio.example/x");
        text.ShouldContain("If you didn't ask to sign in, ignore this email.");
    }

    [Fact]
    public void WhenEmailListIsEmpty_ShouldAllowAnyone()
    {
        var options = new AuthOptions { AllowedEmails = " " };

        options.AllowedEmailList.ShouldBeEmpty();
        options.IsAllowed("anyone@example.com").ShouldBeTrue();
        options.IsAllowed(null).ShouldBeTrue();
    }

    [Fact]
    public void WhenEmailListIsSet_ShouldAllowOnlyListedAddressesIgnoringCase()
    {
        var options = new AuthOptions { AllowedEmails = "a@example.com; B@example.com,\n c@example.com " };

        options.AllowedEmailList.ShouldBe(["a@example.com", "B@example.com", "c@example.com"]);
        options.IsAllowed("b@EXAMPLE.com").ShouldBeTrue();
        options.IsAllowed("d@example.com").ShouldBeFalse();
        options.IsAllowed(null).ShouldBeFalse();
    }

    [Fact]
    public void WhenAndroidSettingIsBlank_ShouldListNoApps()
    {
        AndroidApp.Parse(null).ShouldBeEmpty();
        AndroidApp.Parse("  ").ShouldBeEmpty();
    }

    [Fact]
    public void WhenAndroidSettingListsAppsAndFingerprints_ShouldNormalizeThem()
    {
        var lower = new string('a', 64);
        var upper = string.Join(':', Enumerable.Repeat("BB", 32));

        var apps = AndroidApp.Parse($"com.example.one={lower}, {upper} ; com.example.two = {upper};");

        apps.Select(a => a.PackageName).ShouldBe(["com.example.one", "com.example.two"]);
        apps[0].Fingerprints.ShouldBe([string.Join(':', Enumerable.Repeat("AA", 32)), upper]);
        apps[1].Fingerprints.ShouldBe([upper]);
    }

    [Theory]
    [InlineData("com.example.only")]
    [InlineData("=AA")]
    public void WhenAndroidEntryIsMalformed_ShouldSayWhichEntryIsWrong(string entry)
    {
        var ex = Should.Throw<InvalidOperationException>(() => AndroidApp.Parse(entry));

        ex.Message.ShouldContain($"\"{entry}\"");
    }

    [Theory]
    [InlineData("com.example=zz")]
    [InlineData("com.example=AA:BB")]
    public void WhenFingerprintIsNotSha256_ShouldReject(string entry) =>
        Should.Throw<InvalidOperationException>(() => AndroidApp.Parse(entry)).Message.ShouldContain("is not a SHA-256 certificate fingerprint");

    [Fact]
    public void WhenFingerprintHasTheRightLengthButNotHex_ShouldReject() =>
        Should.Throw<InvalidOperationException>(() => AndroidApp.Parse($"com.example={new string('z', 64)}"))
            .Message.ShouldContain("is not a SHA-256 certificate fingerprint");

    [Fact]
    public void WhenOriginIsDerivedFromAFingerprint_ShouldUseUnpaddedBase64Url()
    {
        // 0xFB 0xFF bytes encode with "+" and "/" in standard base64.
        var fingerprint = string.Join(':', Enumerable.Repeat("FB", 32).Select((b, i) => i % 2 == 0 ? b : "FF"));

        var origin = AndroidApp.OriginOf(fingerprint);

        origin.ShouldStartWith("android:apk-key-hash:");
        origin.ShouldNotContain("=");
        origin.ShouldNotContain("+");
        origin.ShouldNotContain("/");
        origin.ShouldContain("-");
        origin.ShouldContain("_");
    }
}
