using System.Security.Claims;
using Microsoft.AspNetCore.Identity;

namespace Folio.Api.Auth;

/// <summary>A Money Monkey account. There is no password: people sign in with a passkey or a one-time email link.</summary>
public sealed class AppUser : IdentityUser
{
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>Values and prices only: no gains, losses or day changes anywhere. Saved here so every device agrees.</summary>
    public bool HideGains { get; set; }
}

public enum EmailLinkPurpose
{
    /// <summary>The first link to a new address; using it confirms the email.</summary>
    Activate,

    /// <summary>A one-time sign-in for an active account, e.g. on a new device or after losing a passkey.</summary>
    SignIn,
}

/// <summary>
/// A link sent by email. Only a SHA-256 hash of its token is stored; it works once and expires.
/// </summary>
public sealed class EmailLink
{
    public Guid Id { get; set; }
    public required string UserId { get; set; }
    public EmailLinkPurpose Purpose { get; set; }
    public required string TokenHash { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? UsedAt { get; set; }
}

public sealed class AuthOptions
{
    public const string Section = "Auth";

    /// <summary>Where the web app is reached; email links point here.</summary>
    public string PublicUrl { get; set; } = "http://localhost:8090";

    /// <summary>The passkey relying party ID: the host name people use (without scheme or port).</summary>
    public string PasskeyDomain { get; set; } = "localhost";

    /// <summary>Optional link to a local mailbox (Mailpit) shown after an email is sent.</summary>
    public string? InboxUrl { get; set; }

    public TimeSpan ActivationLinkLifetime { get; set; } = TimeSpan.FromHours(24);
    public TimeSpan SignInLinkLifetime { get; set; } = TimeSpan.FromMinutes(15);

    /// <summary>Emails a single client address may trigger per ten minutes.</summary>
    public int EmailsPerTenMinutes { get; set; } = 5;

    /// <summary>Link verifications a single client address may attempt per ten minutes.</summary>
    public int VerifiesPerTenMinutes { get; set; } = 30;

    /// <summary>
    /// Who may use Money Monkey, as a comma- or semicolon-separated list of email addresses. Empty means anyone.
    /// The API checks it on every request, every sign-in link request and every passkey sign-in, so an
    /// address taken off the list is locked out at its next request.
    /// </summary>
    public string AllowedEmails { get; set; } = string.Empty;

    /// <summary>Android app builds trusted for passkeys and sign-in links; see <see cref="AndroidApp"/>. Empty means none.</summary>
    public string AndroidApps { get; set; } = string.Empty;

    public IReadOnlyList<string> AllowedEmailList =>
        AllowedEmails.Split([',', ';', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    public bool IsAllowed(string? email) =>
        AllowedEmailList.Count == 0 || AllowedEmailList.Any(a => string.Equals(a, email, StringComparison.OrdinalIgnoreCase));
}

public static class EmailMasking
{
    /// <summary>"andre@example.com" becomes "a***@example.com", enough to follow a log without storing addresses.</summary>
    public static string Mask(string email)
    {
        var at = email.IndexOf('@');
        return at <= 0 ? "***" : $"{email[0]}***{email[at..]}";
    }
}

/// <summary>The signed-in user for the current request, or none (background jobs, anonymous calls).</summary>
public interface ICurrentUser
{
    string? Id { get; }
}

public sealed class HttpCurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    public string? Id => accessor.HttpContext?.User.FindFirstValue(ClaimTypes.NameIdentifier);
}
