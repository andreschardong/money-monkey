using System.Net;
using System.Net.Sockets;
using Folio.Api.Auth;
using Folio.Api.Endpoints;
using MailKit;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;

namespace Folio.Api.Tests;

[Collection(FolioApiCollection.Name)]
public class AccountEndpointTests(FolioApiFactory factory) : IDisposable
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public void Dispose()
    {
        factory.Identity.Reset();
        factory.Mailer.Failure = null;
        factory.Settings.Set("Auth:AllowedEmails", string.Empty);
        GC.SuppressFinalize(this);
    }

    private static string Credential => "{}";

    private Task<HttpResponseMessage> PasskeySignIn(HttpClient client) => client.PostJsonAsync("/api/auth/passkey", new PasskeyCredentialRequest(Credential, null));

    private Task<HttpResponseMessage> AddPasskey(HttpClient client, string? name = null) =>
        client.PostJsonAsync("/api/account/passkeys", new PasskeyCredentialRequest(Credential, name));

    [Fact]
    public async Task WhenThePasskeyIsNotRecognized_ShouldAnswer401AndPointToTheEmailLink()
    {
        factory.Identity.RejectPasskey = new PasskeyException("unknown credential");
        using var anonymous = factory.CreateClient();

        var response = await PasskeySignIn(anonymous);

        await response.ShouldBeProblemAsync(HttpStatusCode.Unauthorized, "Email me a link");
        (await anonymous.GetJsonAsync<MeDto>("/api/auth/me")).SignedIn.ShouldBeFalse();
    }

    [Fact]
    public async Task WhenThePasskeyBelongsToAnAddressOffTheList_ShouldNotSignItIn()
    {
        var (_, email) = await factory.NewAccountAsync();
        factory.Identity.AcceptPasskeyFor = (email, IdentityScript.NewPasskey());
        factory.Settings.Set("Auth:AllowedEmails", "someone-else@example.com");
        using var anonymous = factory.CreateClient();

        var response = await PasskeySignIn(anonymous);

        await response.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "only invited email addresses");
    }

    [Fact]
    public async Task WhenThePasskeyBelongsToAnAccountThatWasNeverActivated_ShouldAskForTheEmailLinkFirst()
    {
        var email = $"pending-{Guid.NewGuid():N}@example.com";
        using var anonymous = factory.CreateClient();
        (await anonymous.PostJsonAsync("/api/auth/email-link", new EmailLinkRequest(email))).EnsureSuccessStatusCode();
        factory.Identity.AcceptPasskeyFor = (email, IdentityScript.NewPasskey());

        var response = await PasskeySignIn(anonymous);

        await response.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "Activate your account");
    }

    [Fact]
    public async Task WhenThePasskeyIsAccepted_ShouldSignInAndRememberThePasskeyOnTheAccount()
    {
        var (first, email) = await factory.NewAccountAsync();
        var passkey = IdentityScript.NewPasskey();
        factory.Identity.AcceptPasskeyFor = (email, passkey);
        using var device = factory.CreateClient();

        var me = await (await PasskeySignIn(device)).ReadAsync<MeDto>();

        (me.SignedIn, me.Email, me.Passkeys).ShouldBe((true, email, 1));
        (await device.GetJsonAsync<MeDto>("/api/auth/me")).Email.ShouldBe(email);
        (await first.GetJsonAsync<List<PasskeyDto>>("/api/account/passkeys")).ShouldHaveSingleItem().Id.ShouldBe(WebEncoders.Base64UrlEncode(passkey.CredentialId));
    }

    [Fact]
    public async Task WhenPasskeysAreAdded_ShouldNameThemAndListThemOldestFirst()
    {
        var (client, _) = await factory.NewAccountAsync();
        var created = new DateTimeOffset(2026, 5, 1, 0, 0, 0, TimeSpan.Zero);
        var queue = new Queue<UserPasskeyInfo>(
        [
            IdentityScript.NewPasskey(created.AddDays(2)),
            IdentityScript.NewPasskey(created.AddDays(1)),
            IdentityScript.NewPasskey(created),
            IdentityScript.NewPasskey(created.AddDays(3)),
        ]);
        factory.Identity.Attestation = _ => PasskeyAttestationResult.Success(queue.Dequeue(), new PasskeyUserEntity { Id = "x", Name = "x", DisplayName = "x" });

        await AddPasskey(client).ReadAsync<List<PasskeyDto>>();
        await AddPasskey(client, "  Laptop  ").ReadAsync<List<PasskeyDto>>();
        await AddPasskey(client, "   ").ReadAsync<List<PasskeyDto>>();
        var list = await AddPasskey(client, new string('p', 80)).ReadAsync<List<PasskeyDto>>();

        list.Select(p => p.Name).ShouldBe(["Passkey 3", "Laptop", "Passkey 1", new string('p', 60)]);
        list.Select(p => p.CreatedAt).ShouldBe(list.Select(p => p.CreatedAt).Order());
        list.ShouldAllBe(p => !p.BackedUp);
    }

    [Fact]
    public async Task WhenTheAuthenticatorResponseIsRejected_ShouldExplainWhyNothingWasAdded()
    {
        var (client, _) = await factory.NewAccountAsync();
        factory.Identity.Attestation = _ => PasskeyAttestationResult.Fail(new PasskeyException("bad signature"));

        var response = await AddPasskey(client);

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "The passkey could not be added: bad signature");
        (await client.GetJsonAsync<List<PasskeyDto>>("/api/account/passkeys")).ShouldBeEmpty();
    }

    [Fact]
    public async Task WhenTheAccountAlreadyHasTenPasskeys_ShouldRefuseAnotherUntilOneIsRemoved()
    {
        var (client, _) = await factory.NewAccountAsync();
        factory.Identity.Attestation = _ => PasskeyAttestationResult.Success(IdentityScript.NewPasskey(), new PasskeyUserEntity { Id = "x", Name = "x", DisplayName = "x" });
        PasskeyDto last = null!;
        for (var i = 0; i < 10; i++)
            last = (await AddPasskey(client).ReadAsync<List<PasskeyDto>>()).Last();

        await (await AddPasskey(client)).ShouldBeProblemAsync(HttpStatusCode.BadRequest, "up to 10 passkeys");
        (await client.DeleteResponseAsync($"/api/account/passkeys/{last.Id}")).EnsureSuccessStatusCode();

        (await AddPasskey(client)).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task WhenThePasskeyCannotBeStored_ShouldReportTheStoresReason()
    {
        var (client, email) = await factory.NewAccountAsync();
        factory.Identity.Attestation = _ => PasskeyAttestationResult.Success(IdentityScript.NewPasskey(), new PasskeyUserEntity { Id = "x", Name = "x", DisplayName = "x" });
        factory.Identity.FailPasskeySaveFor = email;

        var response = await AddPasskey(client);

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "The passkey could not be stored.");
    }

    [Fact]
    public async Task WhenAPasskeyIsRemoved_ShouldLeaveTheOthersAndKeepThisSessionSignedIn()
    {
        var (client, _) = await factory.NewAccountAsync();
        factory.Identity.Attestation = _ => PasskeyAttestationResult.Success(IdentityScript.NewPasskey(), new PasskeyUserEntity { Id = "x", Name = "x", DisplayName = "x" });
        var added = await AddPasskey(client).ReadAsync<List<PasskeyDto>>();
        var both = await AddPasskey(client).ReadAsync<List<PasskeyDto>>();

        var remaining = await client.DeleteResponseAsync($"/api/account/passkeys/{added[0].Id}").ReadAsync<List<PasskeyDto>>();

        remaining.Select(p => p.Id).ShouldBe([both.Single(p => p.Id != added[0].Id).Id]);
        (await client.GetJsonAsync<MeDto>("/api/auth/me")).Passkeys.ShouldBe(1);
    }

    [Theory]
    [InlineData("not base64 !!")]
    [InlineData("AAAA")]
    public async Task WhenRemovingAPasskeyThatDoesNotExistOrIsMalformed_ShouldFindNothing(string id)
    {
        var (client, _) = await factory.NewAccountAsync();

        (await client.DeleteResponseAsync($"/api/account/passkeys/{Uri.EscapeDataString(id)}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task WhenTheStoreRefusesToRemoveAPasskey_ShouldAnswerNotFound()
    {
        var (client, email) = await factory.NewAccountAsync();
        factory.Identity.Attestation = _ => PasskeyAttestationResult.Success(IdentityScript.NewPasskey(), new PasskeyUserEntity { Id = "x", Name = "x", DisplayName = "x" });
        var added = (await AddPasskey(client).ReadAsync<List<PasskeyDto>>()).Single();
        factory.Identity.FailPasskeyRemoveFor = email;

        (await client.DeleteResponseAsync($"/api/account/passkeys/{added.Id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await client.GetJsonAsync<List<PasskeyDto>>("/api/account/passkeys")).Count.ShouldBe(1);
    }

    [Fact]
    public async Task WhenTheAccountIsDeletedUnderAValidSession_ShouldAnswer401EverywhereAndReportSignedOut()
    {
        var (client, email) = await factory.NewAccountAsync();
        await factory.WithDbAsync(db => db.Users.Where(u => u.Email == email).ExecuteDeleteAsync(Ct));

        (await client.GetJsonAsync<MeDto>("/api/auth/me")).SignedIn.ShouldBeFalse();
        (await client.GetResponseAsync("/api/account/passkeys")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await client.PostJsonAsync("/api/account/passkeys/options")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await AddPasskey(client)).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await client.DeleteResponseAsync("/api/account/passkeys/AAAA")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await client.PostJsonAsync("/api/account/sign-out-everywhere")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await client.PutJsonAsync("/api/account/preferences", new PreferencesRequest(true))).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task WhenThePreferenceCannotBeSaved_ShouldReportTheStoresReason()
    {
        var (client, email) = await factory.NewAccountAsync();
        factory.Identity.FailUpdateFor = email;

        var response = await client.PutJsonAsync("/api/account/preferences", new PreferencesRequest(true));

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "The account could not be saved.");
        (await client.GetJsonAsync<MeDto>("/api/auth/me")).HideGains.ShouldBeFalse();
    }

    [Fact]
    public async Task WhenTheAccountCannotBeCreated_ShouldReportTheStoresReasonAndSendNothing()
    {
        var email = $"broken-{Guid.NewGuid():N}@example.com";
        factory.Identity.FailCreateFor = email;
        using var anonymous = factory.CreateClient();

        var response = await anonymous.PostJsonAsync("/api/auth/email-link", new EmailLinkRequest(email));

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "The account could not be created.");
        factory.Mailer.Sent.ShouldNotContain(m => m.To == email);
    }

    public static TheoryData<Exception> MailFailures => new()
    {
        new SmtpCommandException(SmtpErrorCode.MessageNotAccepted, SmtpStatusCode.MailboxUnavailable, "refused"),
        new SmtpProtocolException("protocol"),
        new ServiceNotConnectedException("not connected"),
        new MailKit.Security.AuthenticationException("bad credentials"),
        new SslHandshakeException("tls"),
        new SocketException(),
        new IOException("closed"),
    };

    [Theory]
    [MemberData(nameof(MailFailures))]
    public async Task WhenTheMailServerFails_ShouldAnswerBadGatewayWithoutExposingTheError(Exception failure)
    {
        var email = $"mail-{Guid.NewGuid():N}@example.com";
        factory.Mailer.Failure = failure;
        using var anonymous = factory.CreateClient();

        var response = await anonymous.PostJsonAsync("/api/auth/email-link", new EmailLinkRequest(email));

        await response.ShouldBeProblemAsync(HttpStatusCode.BadGateway, "The email could not be sent.");
        (await response.Content.ReadAsStringAsync(Ct)).ShouldNotContain(failure.Message);
    }

    [Fact]
    public async Task WhenAnUnexpectedErrorOccursWhileSending_ShouldNotBeHiddenAsAMailProblem()
    {
        var email = $"mail-{Guid.NewGuid():N}@example.com";
        factory.Mailer.Failure = new InvalidOperationException("bug");
        using var anonymous = factory.CreateClient();

        var response = await anonymous.PostJsonAsync("/api/auth/email-link", new EmailLinkRequest(email));

        response.StatusCode.ShouldBe(HttpStatusCode.InternalServerError);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not-a-real-token")]
    public async Task WhenTheLinkIsMissingOrUnknown_ShouldSayItExpired(string token)
    {
        using var anonymous = factory.CreateClient();

        var response = await anonymous.PostJsonAsync("/api/auth/email-link/verify", new VerifyEmailLinkRequest(token));

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "expired or was already used");
    }

    [Fact]
    public async Task WhenALinkIsOpenedByTheAccountAlreadySignedIn_ShouldJustRefreshTheSession()
    {
        var (client, email) = await factory.NewAccountAsync();
        (await client.PostJsonAsync("/api/auth/email-link", new EmailLinkRequest(email))).EnsureSuccessStatusCode();
        var token = factory.Mailer.LastTokenFor(email);

        var me = await client.PostJsonAsync("/api/auth/email-link/verify", new VerifyEmailLinkRequest(token)).ReadAsync<MeDto>();

        me.Email.ShouldBe(email);
    }

    [Fact]
    public async Task WhenALinkIsOpenedWhileSignedInAsSomeoneElseAndSwitchIsConfirmed_ShouldSwitchAccounts()
    {
        var (client, firstEmail) = await factory.NewAccountAsync();
        var otherEmail = $"other-{Guid.NewGuid():N}@example.com";
        using var other = factory.CreateClient();
        (await other.PostJsonAsync("/api/auth/email-link", new EmailLinkRequest(otherEmail))).EnsureSuccessStatusCode();
        var token = factory.Mailer.LastTokenFor(otherEmail);

        var me = await client.PostJsonAsync("/api/auth/email-link/verify", new VerifyEmailLinkRequest(token, ConfirmSwitch: true)).ReadAsync<MeDto>();

        me.Email.ShouldBe(otherEmail);
        (await client.GetJsonAsync<MeDto>("/api/auth/me")).Email.ShouldBe(otherEmail);
        firstEmail.ShouldNotBe(otherEmail);
    }
}
