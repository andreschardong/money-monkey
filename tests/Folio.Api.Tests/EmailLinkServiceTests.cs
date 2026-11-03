using System.Data.Common;
using System.Security.Cryptography;
using System.Text;
using Folio.Api.Auth;
using Folio.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Npgsql;
using NSubstitute;

namespace Folio.Api.Tests;

[Collection(FolioApiCollection.Name)]
public class EmailLinkServiceTests(FolioApiFactory factory)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    private async Task<(string UserId, string Email)> NewUserAsync()
    {
        var (_, email) = await factory.NewAccountAsync();
        var id = await factory.WithDbAsync(db => db.Users.Where(u => u.Email == email).Select(u => u.Id).SingleAsync(Ct));
        return (id, email);
    }

    private async Task<Guid> SeedLinkAsync(string userId, string token, TimeSpan expiresIn, bool used = false)
    {
        var now = factory.Time.GetUtcNow();
        var link = new EmailLink
        {
            Id = Guid.CreateVersion7(), UserId = userId, Purpose = EmailLinkPurpose.SignIn, TokenHash = Hash(token),
            CreatedAt = now.AddDays(-30), ExpiresAt = now + expiresIn, UsedAt = used ? now.AddMinutes(-1) : null,
        };
        await factory.WithDbAsync(async db =>
        {
            db.EmailLinks.Add(link);
            await db.SaveChangesAsync(Ct);
        });
        return link.Id;
    }

    private async Task<T> WithServiceAsync<T>(Func<EmailLinkService, Task<T>> work)
    {
        using var scope = factory.Services.CreateScope();
        return await work(scope.ServiceProvider.GetRequiredService<EmailLinkService>());
    }

    [Theory]
    [InlineData("")]
    [InlineData("  ")]
    public async Task WhenTheTokenIsBlank_ShouldNeitherPeekNorRedeem(string token)
    {
        (await WithServiceAsync(s => s.PeekOwnerAsync(token, Ct))).ShouldBeNull();
        (await WithServiceAsync(s => s.RedeemAsync(token, Ct))).ShouldBeNull();
    }

    [Fact]
    public async Task WhenALinkIsUnknownExpiredOrUsed_ShouldNotBePeekedOrRedeemed()
    {
        var (userId, _) = await NewUserAsync();
        var token = $"expired-{Guid.NewGuid():N}";
        var used = $"used-{Guid.NewGuid():N}";
        await SeedLinkAsync(userId, token, TimeSpan.FromMinutes(-5));
        await SeedLinkAsync(userId, used, TimeSpan.FromMinutes(5), used: true);

        foreach (var candidate in new[] { "unknown-token", token, used })
        {
            (await WithServiceAsync(s => s.PeekOwnerAsync(candidate, Ct))).ShouldBeNull(candidate);
            (await WithServiceAsync(s => s.RedeemAsync(candidate, Ct))).ShouldBeNull(candidate);
        }
    }

    [Fact]
    public async Task WhenALinkIsValid_ShouldBePeekedWithoutUsingItAndRedeemedExactlyOnce()
    {
        var (userId, email) = await NewUserAsync();
        var token = $"valid-{Guid.NewGuid():N}";
        var sibling = $"sibling-{Guid.NewGuid():N}";
        await SeedLinkAsync(userId, token, TimeSpan.FromMinutes(5));
        await SeedLinkAsync(userId, sibling, TimeSpan.FromMinutes(5));

        (await WithServiceAsync(s => s.PeekOwnerAsync(token, Ct))).ShouldBe(userId);
        (await WithServiceAsync(s => s.PeekOwnerAsync(token, Ct))).ShouldBe(userId);

        var user = await WithServiceAsync(s => s.RedeemAsync(token, Ct));
        user.ShouldNotBeNull().Email.ShouldBe(email);
        (await WithServiceAsync(s => s.RedeemAsync(token, Ct))).ShouldBeNull();
        (await WithServiceAsync(s => s.PeekOwnerAsync(sibling, Ct))).ShouldBeNull();
    }

    [Fact]
    public async Task WhenTheLinkIsUsedByAnotherRequestBetweenReadingAndClaiming_ShouldNotRedeemItTwice()
    {
        var (userId, _) = await NewUserAsync();
        var token = $"race-{Guid.NewGuid():N}";
        var linkId = await SeedLinkAsync(userId, token, TimeSpan.FromMinutes(5));
        var connectionString = factory.Services.GetRequiredService<IConfiguration>().GetConnectionString("Folio")!;
        var interceptor = new ClaimFirstInterceptor(connectionString, linkId);
        var options = new DbContextOptionsBuilder<FolioDbContext>().UseNpgsql(connectionString).UseSnakeCaseNamingConvention().AddInterceptors(interceptor).Options;
        await using var db = new FolioDbContext(options, Substitute.For<ICurrentUser>());
        var service = new EmailLinkService(db, Substitute.For<IMailer>(), Options.Create(new AuthOptions()), factory.Time);

        var redeemed = await service.RedeemAsync(token, Ct);

        redeemed.ShouldBeNull();
        interceptor.Intervened.ShouldBeTrue();
    }

    [Fact]
    public async Task WhenALinkIsSent_ShouldRetireOlderLinksAndDeleteLinksExpiredForAWeek()
    {
        var (userId, email) = await NewUserAsync();
        var ancient = $"ancient-{Guid.NewGuid():N}";
        var older = $"older-{Guid.NewGuid():N}";
        await SeedLinkAsync(userId, ancient, TimeSpan.FromDays(-8));
        await SeedLinkAsync(userId, older, TimeSpan.FromMinutes(5));
        var user = await factory.WithDbAsync(db => db.Users.SingleAsync(u => u.Id == userId, Ct));

        await WithServiceAsync(async s =>
        {
            await s.SendAsync(user, Ct);
            return 0;
        });

        (await WithServiceAsync(s => s.PeekOwnerAsync(older, Ct))).ShouldBeNull();
        (await factory.WithDbAsync(db => db.EmailLinks.CountAsync(l => l.TokenHash == Hash(ancient), Ct))).ShouldBe(0);
        (await factory.WithDbAsync(db => db.EmailLinks.CountAsync(l => l.TokenHash == Hash(older), Ct))).ShouldBe(1);
        var token = factory.Mailer.LastTokenFor(email);
        (await WithServiceAsync(s => s.PeekOwnerAsync(token, Ct))).ShouldBe(userId);
    }

    [Fact]
    public async Task WhenAnAccountIsNewAndWhenItIsActive_ShouldSendTheMatchingEmail()
    {
        var email = $"fresh-{Guid.NewGuid():N}@example.com";
        using var anonymous = factory.CreateClient();
        (await anonymous.PostJsonAsync("/api/auth/email-link", new EmailLinkRequest(email))).EnsureSuccessStatusCode();
        var activation = factory.Mailer.Sent.Last(m => m.To == email);
        activation.Subject.ShouldBe("Activate your Money Monkey account");
        activation.Text.ShouldContain("expires in 24 hours");

        var token = factory.Mailer.LastTokenFor(email);
        (await anonymous.PostJsonAsync("/api/auth/email-link/verify", new VerifyEmailLinkRequest(token))).EnsureSuccessStatusCode();
        (await anonymous.PostJsonAsync("/api/auth/email-link", new EmailLinkRequest(email))).EnsureSuccessStatusCode();

        var signIn = factory.Mailer.Sent.Last(m => m.To == email);
        signIn.Subject.ShouldBe("Your Money Monkey sign-in link");
        signIn.Text.ShouldContain("expires in 15 minutes");
    }

    /// <summary>Marks the link as used on a separate connection just before the first update of an email link.</summary>
    private sealed class ClaimFirstInterceptor(string connectionString, Guid linkId) : DbCommandInterceptor
    {
        public bool Intervened { get; private set; }

        public override async ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (!Intervened && command.CommandText.Contains("UPDATE email_links", StringComparison.Ordinal))
            {
                Intervened = true;
                await using var connection = new NpgsqlConnection(connectionString);
                await connection.OpenAsync(cancellationToken);
                await using var rival = new NpgsqlCommand("UPDATE email_links SET used_at = now() WHERE id = @id", connection);
                rival.Parameters.AddWithValue("id", linkId);
                await rival.ExecuteNonQueryAsync(cancellationToken);
            }

            return result;
        }
    }
}
