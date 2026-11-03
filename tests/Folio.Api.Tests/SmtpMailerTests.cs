using Folio.Api.Auth;
using MailKit;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MimeKit;
using NSubstitute;

namespace Folio.Api.Tests;

public class SmtpMailerTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static (SmtpMailer Mailer, ISmtpClient Client, ListLogger<SmtpMailer> Log) Create(EmailOptions options)
    {
        var client = Substitute.For<ISmtpClient>();
        var log = new ListLogger<SmtpMailer>();
        return (new SmtpMailer(Options.Create(options), log, () => client), client, log);
    }

    [Fact]
    public async Task WhenMailIsSent_ShouldConnectSendAndDisconnectWithTheConfiguredServer()
    {
        var options = new EmailOptions { Host = "smtp.example.com", Port = 587, Security = SecureSocketOptions.StartTls, From = "Money Monkey <hello@example.com>" };
        var (mailer, client, log) = Create(options);
        MimeMessage? sent = null;
        await client.SendAsync(Arg.Do<MimeMessage>(m => sent = m), Arg.Any<CancellationToken>(), Arg.Any<ITransferProgress>());

        await mailer.SendAsync("andre@example.com", "Hello", "<p>Hi</p>", "Hi", Ct);

        await client.Received(1).ConnectAsync("smtp.example.com", 587, SecureSocketOptions.StartTls, Ct);
        await client.Received(1).SendAsync(Arg.Any<MimeMessage>(), Ct, Arg.Any<ITransferProgress>());
        await client.Received(1).DisconnectAsync(true, Ct);
        client.Received(1).Dispose();
        sent.ShouldNotBeNull();
        sent.From.Mailboxes.Single().Address.ShouldBe("hello@example.com");
        sent.From.Mailboxes.Single().Name.ShouldBe("Money Monkey");
        sent.To.Mailboxes.Single().Address.ShouldBe("andre@example.com");
        sent.Subject.ShouldBe("Hello");
        sent.HtmlBody.ShouldBe("<p>Hi</p>");
        sent.TextBody.ShouldBe("Hi");
        var entry = log.Entries.ShouldHaveSingleItem();
        entry.Level.ShouldBe(LogLevel.Information);
        entry.Message.ShouldBe("Sent \"Hello\" to a***@example.com");
    }

    [Fact]
    public async Task WhenNoUserIsConfigured_ShouldNotAuthenticate()
    {
        var (mailer, client, _) = Create(new EmailOptions { User = null });

        await mailer.SendAsync("a@example.com", "s", "h", "t", Ct);

        await client.DidNotReceive().AuthenticateAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task WhenUserAndPasswordAreConfigured_ShouldAuthenticateBeforeSending()
    {
        var (mailer, client, _) = Create(new EmailOptions { User = "folio", Password = "s3cret" });

        await mailer.SendAsync("a@example.com", "s", "h", "t", Ct);

        NSubstitute.Received.InOrder(() =>
        {
            client.ConnectAsync(Arg.Any<string>(), Arg.Any<int>(), Arg.Any<SecureSocketOptions>(), Arg.Any<CancellationToken>());
            client.AuthenticateAsync("folio", "s3cret", Ct);
            client.SendAsync(Arg.Any<MimeMessage>(), Arg.Any<CancellationToken>(), Arg.Any<ITransferProgress>());
        });
    }

    [Fact]
    public async Task WhenUserHasNoPassword_ShouldAuthenticateWithAnEmptyOne()
    {
        var (mailer, client, _) = Create(new EmailOptions { User = "folio", Password = null });

        await mailer.SendAsync("a@example.com", "s", "h", "t", Ct);

        await client.Received(1).AuthenticateAsync("folio", string.Empty, Ct);
    }

    [Fact]
    public async Task WhenTheServerRefusesTheMessage_ShouldNotLogItAsSent()
    {
        var (mailer, client, log) = Create(new EmailOptions());
        client.SendAsync(Arg.Any<MimeMessage>(), Arg.Any<CancellationToken>(), Arg.Any<ITransferProgress>())
            .Returns<Task<string>>(_ => throw new SmtpProtocolException("refused"));

        await Should.ThrowAsync<SmtpProtocolException>(() => mailer.SendAsync("a@example.com", "s", "h", "t", Ct));

        log.Entries.ShouldBeEmpty();
        client.Received(1).Dispose();
    }
}
