using System.Net.Http.Json;
using System.Text.RegularExpressions;
using System.Web;
using Folio.Api.Auth;
using Folio.Api.Data;
using Folio.Api.MarketData;
using Folio.Core;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Time.Testing;
using Testcontainers.PostgreSql;

namespace Folio.Api.Tests;

/// <summary>The real API on a throwaway Postgres, with market data from fakes and the clock fixed on a Friday evening.</summary>
public class FolioApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    public static readonly DateOnly Today = new(2026, 10, 9);

    private readonly PostgreSqlContainer _database = new PostgreSqlBuilder("postgres:17-alpine").Build();

    public FakeTimeProvider Time { get; } = new(new DateTimeOffset(2026, 10, 9, 22, 0, 0, TimeSpan.Zero));

    /// <summary>Who may use the app; empty means anyone, which the ordinary tests rely on.</summary>
    protected virtual string AllowedEmails => string.Empty;

    /// <summary>Settings a test can change while the app runs, such as the allowed email list.</summary>
    public MutableSettings Settings { get; } = new();

    public async ValueTask InitializeAsync() => await _database.StartAsync();

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        await _database.DisposeAsync();
    }

    public CapturingMailer Mailer => Services.GetRequiredService<CapturingMailer>();

    /// <summary>A client with a session: asks for an email link, reads it from the capturing mailer and uses it.</summary>
    public async Task<HttpClient> CreateSignedInClientAsync(string? email = null)
    {
        var client = CreateClient();
        email ??= $"test-{Guid.NewGuid():N}@example.com";
        (await client.PostAsJsonAsync("/api/auth/email-link", new { email })).EnsureSuccessStatusCode();
        var token = Mailer.LastTokenFor(email);
        (await client.PostAsJsonAsync("/api/auth/email-link/verify", new { token })).EnsureSuccessStatusCode();
        return client;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:Folio", _database.GetConnectionString());
        builder.UseSetting("MarketData:EnableScheduler", "false");
        builder.UseSetting("MarketData:RequestDelayMilliseconds", "0");
        builder.UseSetting("Auth:EmailsPerTenMinutes", "100000");
        builder.UseSetting("Auth:VerifiesPerTenMinutes", "100000");
        Settings.Set("Auth:AllowedEmails", AllowedEmails);
        builder.ConfigureAppConfiguration(config => config.Add(Settings));
        builder.UseSetting("Auth:PublicUrl", "http://localhost");
        builder.UseSetting("LogFile:Path", "");
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IMailer>();
            services.AddSingleton<CapturingMailer>();
            services.AddSingleton<IMailer>(sp => sp.GetRequiredService<CapturingMailer>());
            services.RemoveAll<IQuoteProvider>();
            services.AddSingleton<IQuoteProvider, FakeQuoteProvider>();
            services.RemoveAll<IFxProvider>();
            services.AddSingleton<IFxProvider, FakeFxProvider>();
            services.RemoveAll<IFallbackQuoteProvider>();
            services.AddSingleton<IFallbackQuoteProvider, NoFallback>();
            services.RemoveAll<TimeProvider>();
            services.AddSingleton<TimeProvider>(Time);
        });
    }
}

/// <summary>
/// Three securities with flat prices, each up 1 % on the last trading day. SPLT trades at 100 until a
/// 2-for-1 split on 2026-06-01 and at 50 afterwards, as an exchange would report it.
/// </summary>
public sealed class FakeQuoteProvider : IQuoteProvider
{
    public static readonly DateOnly SplitDate = new(2026, 6, 1);

    private static readonly Dictionary<string, SecurityInfo> Known = new(StringComparer.OrdinalIgnoreCase)
    {
        ["SHOP.TO"] = new("SHOP.TO", "Shopify Inc.", "CAD", "TSX", AssetType.Stock),
        ["AAPL"] = new("AAPL", "Apple Inc.", "USD", "NASDAQ", AssetType.Stock),
        ["SPLT"] = new("SPLT", "Splitting Corp.", "USD", "NYSE", AssetType.Stock),
        // Its exchange is closed on the last trading day: its newest close is the day before, which rose 10 %.
        ["HOLI.TO"] = new("HOLI.TO", "Holiday Ltd.", "CAD", "TSX", AssetType.Stock),
    };

    public static decimal Close(string symbol, DateOnly date)
    {
        var price = symbol.ToUpperInvariant() switch
        {
            "SHOP.TO" => 100m,
            "AAPL" => 200m,
            "HOLI.TO" => date >= FolioApiFactory.Today.AddDays(-1) ? 55m : 50m,
            _ => date >= SplitDate ? 50m : 100m,
        };
        return date == FolioApiFactory.Today ? price * 1.01m : price;
    }

    public Task<IReadOnlyList<SymbolMatch>> SearchAsync(string query, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<SymbolMatch>>(Known.Values
            .Where(s => s.Symbol.Contains(query, StringComparison.OrdinalIgnoreCase) || s.Name.Contains(query, StringComparison.OrdinalIgnoreCase))
            .Select(s => new SymbolMatch(s.Symbol, s.Name, s.Exchange, s.AssetType))
            .ToList());

    public Task<PriceHistory> GetHistoryAsync(string symbol, DateOnly from, DateOnly to, CancellationToken ct)
    {
        if (!Known.TryGetValue(symbol, out var info))
            throw new SymbolNotFoundException(symbol);

        var bars = new List<PricePoint>();
        for (var day = from; day <= to; day = day.AddDays(1))
        {
            var holiday = info.Symbol == "HOLI.TO" && day == FolioApiFactory.Today;
            if (day.DayOfWeek is not (DayOfWeek.Saturday or DayOfWeek.Sunday) && !holiday)
                bars.Add(new PricePoint(day, Close(symbol, day)));
        }

        var splits = info.Symbol == "SPLT" && SplitDate >= from && SplitDate <= to ? new[] { new SplitInfo(SplitDate, 2m, 1m) } : [];
        return Task.FromResult(new PriceHistory(info, bars, splits, []));
    }
}

/// <summary>USD at 1.30 CAD before 2026 and 1.40 CAD from then on; EUR at 1.50 CAD throughout.</summary>
public sealed class FakeFxProvider : IFxProvider
{
    public static decimal CadPerUnit(string currency, DateOnly day) => currency switch
    {
        "USD" => day < new DateOnly(2026, 1, 1) ? 1.30m : 1.40m,
        "EUR" => 1.50m,
        _ => 0m,
    };

    public Task<IReadOnlyList<FxObservation>> GetCadRatesAsync(IReadOnlyCollection<string> currencies, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var observations = new List<FxObservation>();
        for (var day = from; day <= to; day = day.AddDays(1))
        {
            if (day.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday)
                continue;
            foreach (var currency in currencies.Where(c => CadPerUnit(c, day) > 0))
                observations.Add(new FxObservation(currency, day, CadPerUnit(currency, day), "Fake"));
        }

        return Task.FromResult<IReadOnlyList<FxObservation>>(observations);
    }
}

/// <summary>An in-memory configuration source whose values can change after the app has started.</summary>
public sealed class MutableSettings : ConfigurationProvider, IConfigurationSource
{
    public IConfigurationProvider Build(IConfigurationBuilder builder) => this;

    public override void Set(string key, string? value)
    {
        base.Set(key, value);
        OnReload();
    }
}

/// <summary>The app with sign-in limited to two addresses.</summary>
public sealed class RestrictedFolioApiFactory : FolioApiFactory
{
    public const string Invited = "invited@example.com";

    protected override string AllowedEmails => $" {Invited} , other@example.com ";
}

/// <summary>Keeps every email instead of sending it, so tests can read the links.</summary>
public sealed class CapturingMailer : IMailer
{
    private readonly List<(string To, string Subject, string Text)> _sent = [];

    public IReadOnlyList<(string To, string Subject, string Text)> Sent
    {
        get
        {
            lock (_sent)
                return _sent.ToList();
        }
    }

    public Task SendAsync(string to, string subject, string html, string text, CancellationToken ct)
    {
        lock (_sent)
            _sent.Add((to, subject, text));
        return Task.CompletedTask;
    }

    public string LastTokenFor(string email)
    {
        var text = Sent.Last(m => m.To == email).Text;
        var link = Regex.Match(text, @"https?://\S+").Value;
        return HttpUtility.ParseQueryString(new Uri(link).Query)["token"] ?? throw new InvalidOperationException("No token in the email.");
    }
}

public sealed class NoFallback : IFallbackQuoteProvider
{
    public bool IsConfigured => false;

    public Task<PricePoint?> GetLatestAsync(string symbol, string currency, CancellationToken ct) => Task.FromResult<PricePoint?>(null);
}
