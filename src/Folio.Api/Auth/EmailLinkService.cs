using System.Security.Cryptography;
using System.Text;
using Folio.Api.Data;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Folio.Api.Auth;

/// <summary>Issues and redeems the one-time links that activate an account or sign someone in.</summary>
public sealed class EmailLinkService(FolioDbContext db, IMailer mailer, IOptions<AuthOptions> options, TimeProvider time)
{
    /// <summary>Emails an activation link (new account) or a sign-in link (active account).</summary>
    public async Task SendAsync(AppUser user, CancellationToken ct)
    {
        var purpose = user.EmailConfirmed ? EmailLinkPurpose.SignIn : EmailLinkPurpose.Activate;
        var lifetime = purpose == EmailLinkPurpose.Activate ? options.Value.ActivationLinkLifetime : options.Value.SignInLinkLifetime;
        var token = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        var now = time.GetUtcNow();

        // Only the newest link works, and old rows don't pile up.
        await db.EmailLinks.Where(l => l.UserId == user.Id && l.UsedAt == null)
            .ExecuteUpdateAsync(set => set.SetProperty(l => l.UsedAt, now), ct);
        await db.EmailLinks.Where(l => l.ExpiresAt < now.AddDays(-7)).ExecuteDeleteAsync(ct);

        db.EmailLinks.Add(new EmailLink
        {
            Id = Guid.CreateVersion7(),
            UserId = user.Id,
            Purpose = purpose,
            TokenHash = Hash(token),
            CreatedAt = now,
            ExpiresAt = now + lifetime,
        });
        await db.SaveChangesAsync(ct);

        var link = $"{options.Value.PublicUrl.TrimEnd('/')}/email-link?token={token}";
        var (subject, html, text) = purpose == EmailLinkPurpose.Activate
            ? EmailTemplates.Activation(link, lifetime)
            : EmailTemplates.SignIn(link, lifetime);
        await mailer.SendAsync(user.Email!, subject, html, text, ct);
    }

    /// <summary>The account a still-valid link belongs to, without using the link up.</summary>
    public async Task<string?> PeekOwnerAsync(string token, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(token))
            return null;
        var hash = Hash(token);
        var now = time.GetUtcNow();
        return await db.EmailLinks.AsNoTracking()
            .Where(l => l.TokenHash == hash && l.UsedAt == null && l.ExpiresAt >= now)
            .Select(l => l.UserId)
            .SingleOrDefaultAsync(ct);
    }

    /// <summary>Uses a link once. Returns null when it is unknown, expired or already used.</summary>
    public async Task<AppUser?> RedeemAsync(string token, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(token))
            return null;

        var hash = Hash(token);
        var now = time.GetUtcNow();
        var link = await db.EmailLinks.AsNoTracking().SingleOrDefaultAsync(l => l.TokenHash == hash, ct);
        if (link is null || link.UsedAt is not null || link.ExpiresAt < now)
            return null;

        // Marking it used in one conditional statement keeps two quick clicks from both signing in.
        var claimed = await db.EmailLinks
            .Where(l => l.Id == link.Id && l.UsedAt == null)
            .ExecuteUpdateAsync(set => set.SetProperty(l => l.UsedAt, now), ct);
        if (claimed == 0)
            return null;

        // Any other outstanding link for the account is retired along with it.
        await db.EmailLinks.Where(l => l.UserId == link.UserId && l.UsedAt == null)
            .ExecuteUpdateAsync(set => set.SetProperty(l => l.UsedAt, now), ct);
        return await db.Users.SingleOrDefaultAsync(u => u.Id == link.UserId, ct);
    }

    private static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}
