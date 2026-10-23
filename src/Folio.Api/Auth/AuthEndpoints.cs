using System.Net.Sockets;
using Folio.Api.Endpoints;
using MailKit;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Options;

namespace Folio.Api.Auth;

/// <summary>
/// PublicUrl is where Money Monkey is set up to be opened; passkeys work only at that address (or on localhost).
/// HideGains is the account's choice to see values and prices without any gain, loss or change figure.
/// </summary>
public sealed record MeDto(bool SignedIn, string? Email, int Passkeys, string? InboxUrl, string PublicUrl, bool HideGains = false);

public sealed record PreferencesRequest(bool HideGains);

public sealed record EmailLinkRequest(string Email);

public sealed record EmailLinkSentDto(string Email, string? InboxUrl);

/// <param name="ConfirmSwitch">Set when the person, already signed in elsewhere, chose to switch to the link's account.</param>
public sealed record VerifyEmailLinkRequest(string Token, bool ConfirmSwitch = false);

public sealed record PasskeyCredentialRequest(string Credential, string? Name);

public sealed record PasskeyDto(string Id, string Name, DateTimeOffset CreatedAt, bool BackedUp);

/// <summary>
/// Passwordless sign-in: a one-time email link activates the account (and works as a fallback later), and passkeys
/// are the everyday way in.
/// </summary>
public static class AuthEndpoints
{
    public const string EmailRateLimit = "email";
    public const string VerifyRateLimit = "verify";
    private const int MaxPasskeys = 10;

    public static void MapAuthEndpoints(this IEndpointRouteBuilder api)
    {
        var auth = api.MapGroup("/auth").WithTags("Sign-in").AllowAnonymous();
        auth.MapGet("/me", Me);
        auth.MapPost("/email-link", SendEmailLink).RequireRateLimiting(EmailRateLimit);
        auth.MapPost("/email-link/verify", VerifyEmailLink).RequireRateLimiting(VerifyRateLimit);
        auth.MapPost("/passkey/options", PasskeyRequestOptions);
        auth.MapPost("/passkey", PasskeySignIn);
        auth.MapPost("/sign-out", SignOut);

        var account = api.MapGroup("/account").WithTags("Account");
        account.MapGet("/passkeys", ListPasskeys);
        account.MapPost("/passkeys/options", PasskeyCreationOptions);
        account.MapPost("/passkeys", AddPasskey);
        account.MapDelete("/passkeys/{id}", RemovePasskey);
        account.MapPost("/sign-out-everywhere", SignOutEverywhere);
        account.MapPut("/preferences", SetPreferences);
    }

    private static async Task<MeDto> Me(HttpContext http, UserManager<AppUser> users, IOptions<AuthOptions> options)
    {
        var user = http.User.Identity?.IsAuthenticated == true ? await users.GetUserAsync(http.User) : null;
        return user is null
            ? new MeDto(false, null, 0, options.Value.InboxUrl, options.Value.PublicUrl)
            : await SignedInAsync(users, user, options.Value);
    }

    private static async Task<MeDto> SignedInAsync(UserManager<AppUser> users, AppUser user, AuthOptions options) =>
        new(true, user.Email, (await users.GetPasskeysAsync(user)).Count, options.InboxUrl, options.PublicUrl, user.HideGains);

    private static async Task<Results<Accepted<EmailLinkSentDto>, ProblemHttpResult>> SendEmailLink(
        EmailLinkRequest request, UserManager<AppUser> users, EmailLinkService links, IOptionsMonitor<AuthOptions> options,
        TimeProvider time, ILogger<EmailLinkService> logger, CancellationToken ct)
    {
        var email = request.Email?.Trim() ?? string.Empty;
        if (email.Length is 0 or > 254 || !MimeKit.MailboxAddress.TryParse(email, out var parsed) || parsed.Address != email || !email.Contains('@'))
            return Problems.BadRequest("Enter a valid email address.");

        // New or existing, an address off the list gets nothing, not even an email.
        if (!options.CurrentValue.IsAllowed(email))
            return NotInvited();

        var user = await users.FindByEmailAsync(email);
        if (user is null)
        {
            user = new AppUser { UserName = email, Email = email, CreatedAt = time.GetUtcNow() };
            var created = await users.CreateAsync(user);
            if (!created.Succeeded)
                return Problems.BadRequest(string.Join(" ", created.Errors.Select(e => e.Description)));
        }

        try
        {
            await links.SendAsync(user, ct);
        }
        catch (Exception ex) when (ex is SmtpCommandException or SmtpProtocolException or ServiceNotConnectedException
                                       or AuthenticationException or SslHandshakeException or SocketException or IOException)
        {
            logger.LogError(ex, "Could not send a sign-in email to {Email}", EmailMasking.Mask(email));
            return Problems.Unavailable("The email could not be sent. Check Money Monkey's mail settings and try again.", "Email not sent");
        }

        return TypedResults.Accepted((string?)null, new EmailLinkSentDto(email, options.CurrentValue.InboxUrl));
    }

    private static async Task<Results<Ok<MeDto>, ProblemHttpResult>> VerifyEmailLink(
        VerifyEmailLinkRequest request, HttpContext http, EmailLinkService links, UserManager<AppUser> users,
        SignInManager<AppUser> signIn, IOptions<AuthOptions> options, CancellationToken ct)
    {
        const string expired = "This link has expired or was already used. Ask for a new one on the sign-in page.";
        var ownerId = await links.PeekOwnerAsync(request.Token, ct);
        if (ownerId is null)
            return Problems.BadRequest(expired);

        // A link opened while another account is signed in must not silently replace that session.
        var current = http.User.Identity?.IsAuthenticated == true ? await users.GetUserAsync(http.User) : null;
        if (current is not null && current.Id != ownerId && !request.ConfirmSwitch)
        {
            return TypedResults.Problem($"You're signed in as {current.Email}. This link belongs to a different account.",
                statusCode: StatusCodes.Status409Conflict, title: "Different account");
        }

        var user = await links.RedeemAsync(request.Token, ct);
        if (user is null)
            return Problems.BadRequest(expired);

        if (!user.EmailConfirmed)
        {
            user.EmailConfirmed = true;
            await users.UpdateAsync(user);
        }

        await signIn.SignInAsync(user, isPersistent: true, authenticationMethod: "email-link");
        return TypedResults.Ok(await SignedInAsync(users, user, options.Value));
    }

    private static async Task<ContentHttpResult> PasskeyRequestOptions(SignInManager<AppUser> signIn) =>
        // No user is given: passkeys are discoverable, so the browser offers the ones saved for this site.
        TypedResults.Content(await signIn.MakePasskeyRequestOptionsAsync(null), "application/json");

    private static ProblemHttpResult NotInvited() =>
        TypedResults.Problem("Money Monkey is private: only invited email addresses can sign in. " +
            "Ask the owner to add yours to the allowed list in the settings.",
            statusCode: StatusCodes.Status403Forbidden, title: "Not invited");

    private static async Task<Results<Ok<MeDto>, ProblemHttpResult>> PasskeySignIn(
        PasskeyCredentialRequest request, SignInManager<AppUser> signIn, UserManager<AppUser> users,
        IOptionsMonitor<AuthOptions> options, ILogger<EmailLinkService> logger)
    {
        var assertion = await signIn.PerformPasskeyAssertionAsync(request.Credential);
        if (!assertion.Succeeded)
        {
            logger.LogWarning("Passkey sign-in failed: {Reason}", assertion.Failure.Message);
            return TypedResults.Problem("Money Monkey doesn't recognize that passkey. Use \"Email me a link\" to sign in instead.",
                statusCode: StatusCodes.Status401Unauthorized, title: "Sign-in failed");
        }

        var user = assertion.User;
        if (!options.CurrentValue.IsAllowed(user.Email))
            return NotInvited();
        if (!await signIn.CanSignInAsync(user))
            return TypedResults.Problem("Activate your account with the link we emailed first.",
                statusCode: StatusCodes.Status403Forbidden, title: "Account not active");

        // The sign count and backup flags change with each use; storing them guards against cloned authenticators.
        await users.AddOrUpdatePasskeyAsync(user, assertion.Passkey);
        await signIn.SignInAsync(user, isPersistent: true, authenticationMethod: "passkey");
        return TypedResults.Ok(await SignedInAsync(users, user, options.CurrentValue));
    }

    private static async Task<NoContent> SignOut(SignInManager<AppUser> signIn)
    {
        await signIn.SignOutAsync();
        return TypedResults.NoContent();
    }

    private static async Task<Results<Ok<List<PasskeyDto>>, UnauthorizedHttpResult>> ListPasskeys(HttpContext http, UserManager<AppUser> users)
    {
        var user = await users.GetUserAsync(http.User);
        return user is null ? TypedResults.Unauthorized() : TypedResults.Ok(await PasskeysAsync(users, user));
    }

    private static async Task<Results<ContentHttpResult, UnauthorizedHttpResult>> PasskeyCreationOptions(
        HttpContext http, UserManager<AppUser> users, SignInManager<AppUser> signIn)
    {
        var user = await users.GetUserAsync(http.User);
        if (user is null)
            return TypedResults.Unauthorized();

        var options = await signIn.MakePasskeyCreationOptionsAsync(new PasskeyUserEntity
        {
            Id = await users.GetUserIdAsync(user),
            Name = user.Email!,
            DisplayName = user.Email!,
        });
        return TypedResults.Content(options, "application/json");
    }

    private static async Task<Results<Ok<List<PasskeyDto>>, UnauthorizedHttpResult, ProblemHttpResult>> AddPasskey(
        PasskeyCredentialRequest request, HttpContext http, UserManager<AppUser> users, SignInManager<AppUser> signIn)
    {
        var user = await users.GetUserAsync(http.User);
        if (user is null)
            return TypedResults.Unauthorized();

        var existing = await users.GetPasskeysAsync(user);
        if (existing.Count >= MaxPasskeys)
            return Problems.BadRequest($"An account can have up to {MaxPasskeys} passkeys. Remove one first.");

        var attestation = await signIn.PerformPasskeyAttestationAsync(request.Credential);
        if (!attestation.Succeeded)
            return Problems.BadRequest($"The passkey could not be added: {attestation.Failure.Message}");

        var passkey = attestation.Passkey;
        var name = request.Name?.Trim();
        passkey.Name = string.IsNullOrEmpty(name) ? $"Passkey {existing.Count + 1}" : name.Length > 60 ? name[..60] : name;
        var saved = await users.AddOrUpdatePasskeyAsync(user, passkey);
        if (!saved.Succeeded)
            return Problems.BadRequest(string.Join(" ", saved.Errors.Select(e => e.Description)));

        return TypedResults.Ok(await PasskeysAsync(users, user));
    }

    private static async Task<Results<Ok<List<PasskeyDto>>, UnauthorizedHttpResult, NotFound>> RemovePasskey(
        string id, HttpContext http, UserManager<AppUser> users, SignInManager<AppUser> signIn)
    {
        var user = await users.GetUserAsync(http.User);
        if (user is null)
            return TypedResults.Unauthorized();

        byte[] credentialId;
        try
        {
            credentialId = WebEncoders.Base64UrlDecode(id);
        }
        catch (FormatException)
        {
            return TypedResults.NotFound();
        }

        if (await users.GetPasskeyAsync(user, credentialId) is null)
            return TypedResults.NotFound();

        var removed = await users.RemovePasskeyAsync(user, credentialId);
        if (!removed.Succeeded)
            return TypedResults.NotFound();

        // The device that held the passkey may still be signed in: a new security stamp ends every other session.
        await users.UpdateSecurityStampAsync(user);
        await signIn.RefreshSignInAsync(user);
        return TypedResults.Ok(await PasskeysAsync(users, user));
    }

    /// <summary>Ends the session on every device, this one included.</summary>
    private static async Task<Results<NoContent, UnauthorizedHttpResult>> SignOutEverywhere(
        HttpContext http, UserManager<AppUser> users, SignInManager<AppUser> signIn)
    {
        var user = await users.GetUserAsync(http.User);
        if (user is null)
            return TypedResults.Unauthorized();

        await users.UpdateSecurityStampAsync(user);
        await signIn.SignOutAsync();
        return TypedResults.NoContent();
    }

    /// <summary>Display choices live on the account rather than in one browser, so the phone and the PC agree.</summary>
    private static async Task<Results<Ok<MeDto>, UnauthorizedHttpResult, ProblemHttpResult>> SetPreferences(
        PreferencesRequest request, HttpContext http, UserManager<AppUser> users, IOptions<AuthOptions> options)
    {
        var user = await users.GetUserAsync(http.User);
        if (user is null)
            return TypedResults.Unauthorized();

        user.HideGains = request.HideGains;
        var saved = await users.UpdateAsync(user);
        if (!saved.Succeeded)
            return Problems.BadRequest(string.Join(" ", saved.Errors.Select(e => e.Description)));

        return TypedResults.Ok(await SignedInAsync(users, user, options.Value));
    }

    private static async Task<List<PasskeyDto>> PasskeysAsync(UserManager<AppUser> users, AppUser user) =>
        (await users.GetPasskeysAsync(user))
            .OrderBy(p => p.CreatedAt)
            .Select(p => new PasskeyDto(WebEncoders.Base64UrlEncode(p.CredentialId), p.Name ?? "Passkey", p.CreatedAt, p.IsBackedUp))
            .ToList();
}
