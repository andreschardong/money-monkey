using System.Net;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Options;
using MimeKit;

namespace Folio.Api.Auth;

public sealed class EmailOptions
{
    public const string Section = "Email";

    public string Host { get; set; } = "localhost";
    public int Port { get; set; } = 1025;

    /// <summary>None, Auto, SslOnConnect or StartTls; local Mailpit needs None.</summary>
    public SecureSocketOptions Security { get; set; } = SecureSocketOptions.Auto;

    public string? User { get; set; }
    public string? Password { get; set; }
    public string From { get; set; } = "Money Monkey <folio@localhost>";
}

public interface IMailer
{
    Task SendAsync(string to, string subject, string html, string text, CancellationToken ct);
}

/// <summary>Sends mail over SMTP: Mailpit on this PC, or any provider's SMTP server when configured.</summary>
public sealed class SmtpMailer(IOptions<EmailOptions> options, ILogger<SmtpMailer> logger) : IMailer
{
    public async Task SendAsync(string to, string subject, string html, string text, CancellationToken ct)
    {
        var settings = options.Value;
        var message = new MimeMessage();
        message.From.Add(MailboxAddress.Parse(settings.From));
        message.To.Add(MailboxAddress.Parse(to));
        message.Subject = subject;
        message.Body = new BodyBuilder { HtmlBody = html, TextBody = text }.ToMessageBody();

        using var client = new SmtpClient();
        await client.ConnectAsync(settings.Host, settings.Port, settings.Security, ct);
        if (!string.IsNullOrEmpty(settings.User))
            await client.AuthenticateAsync(settings.User, settings.Password ?? string.Empty, ct);
        await client.SendAsync(message, ct);
        await client.DisconnectAsync(true, ct);
        logger.LogInformation("Sent \"{Subject}\" to {Recipient}", subject, EmailMasking.Mask(to));
    }
}

/// <summary>The two emails Money Monkey sends, as HTML with a plain-text alternative.</summary>
public static class EmailTemplates
{
    public static (string Subject, string Html, string Text) Activation(string link, TimeSpan lifetime) => Build(
        "Activate your Money Monkey account",
        "Confirm your email to finish creating your Money Monkey account. You'll then add a passkey to sign in.",
        "Activate my account",
        link,
        $"The link works once and expires in {Describe(lifetime)}. If you didn't ask for an account, ignore this email.");

    public static (string Subject, string Html, string Text) SignIn(string link, TimeSpan lifetime) => Build(
        "Your Money Monkey sign-in link",
        "Use this link to sign in to Folio. You can add a passkey for this device afterwards.",
        "Sign in to Money Monkey",
        link,
        $"The link works once and expires in {Describe(lifetime)}. If you didn't ask to sign in, ignore this email.");

    private static (string, string, string) Build(string subject, string intro, string action, string link, string footer)
    {
        var safeLink = WebUtility.HtmlEncode(link);
        var html = $"""
            <!doctype html>
            <html lang="en-CA">
            <body style="margin:0;padding:32px 16px;background:#f2f4f5;font-family:Segoe UI,Arial,sans-serif;color:#172430">
              <div style="max-width:480px;margin:0 auto;padding:28px;background:#ffffff;border:1px solid #dce2e6;border-radius:14px">
                <p style="margin:0 0 20px;font-size:22px;font-weight:700;letter-spacing:-0.02em">Money Monkey</p>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.5">{WebUtility.HtmlEncode(intro)}</p>
                <p style="margin:0 0 24px">
                  <a href="{safeLink}" style="display:inline-block;padding:11px 20px;border-radius:999px;background:#1b5f9c;color:#ffffff;font-weight:600;text-decoration:none">{WebUtility.HtmlEncode(action)}</a>
                </p>
                <p style="margin:0 0 8px;font-size:13px;color:#4e5c68">Or paste this address into your browser:</p>
                <p style="margin:0 0 24px;font-size:13px;word-break:break-all"><a href="{safeLink}" style="color:#174f82">{safeLink}</a></p>
                <p style="margin:0;font-size:13px;color:#687582">{WebUtility.HtmlEncode(footer)}</p>
              </div>
            </body>
            </html>
            """;
        var text = $"{intro}\n\n{action}: {link}\n\n{footer}\n";
        return (subject, html, text);
    }

    private static string Describe(TimeSpan lifetime) =>
        lifetime.TotalHours >= 1 ? $"{lifetime.TotalHours:0} hours" : $"{lifetime.TotalMinutes:0} minutes";
}
