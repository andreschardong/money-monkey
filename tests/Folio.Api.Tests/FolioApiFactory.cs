using System.Net.Http.Json;
using System.Text.RegularExpressions;
using System.Web;
using Folio.Api.Auth;
using Folio.Api.Data;
using Folio.Api.MarketData;
using Folio.Core;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
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

    public CountingFakeTimeProvider Time { get; } = new(new DateTimeOffset(2026, 10, 9, 22, 0, 0, TimeSpan.Zero));

    /// <summary>Who may use the app; empty means anyone, which the ordinary tests rely on.</summary>
    protected virtual string AllowedEmails => string.Empty;

    /// <summary>Trusted Android app builds (read at start-up); none for the ordinary tests.</summary>
    protected virtual string AndroidApps => string.Empty;

    /// <summary>Whether the daily refresh worker runs; off for the ordinary tests so nothing refreshes behind their back.</summary>
    protected virtual bool EnableScheduler => false;

    /// <summary>A place for a derived factory to add settings after the standard ones.</summary>
    protected virtual void ConfigureSettings(IWebHostBuilder builder)
    {
    }

    /// <summary>A place for a derived factory to replace services after the standard fakes.</summary>
    protected virtual void ConfigureFakes(IServiceCollection services)
    {
    }

    /// <summary>Settings a test can change while the app runs, such as the allowed email list.</summary>
    public MutableSettings Settings { get; } = new();

    public async ValueTask InitializeAsync() => await _database.StartAsync();

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        await _database.DisposeAsync();
    }

    public CapturingMailer Mailer => Services.GetRequiredService<CapturingMailer>();

    /// <summary>The fake quote source; tests can make symbols fail or block.</summary>
    public FakeQuoteProvider Quotes => Services.GetRequiredService<FakeQuoteProvider>();

    /// <summary>The fake exchange-rate source; tests can make it fail or block.</summary>
    public FakeFxProvider Fx => Services.GetRequiredService<FakeFxProvider>();

    /// <summary>The fake second quote source, not configured unless a test turns it on.</summary>
    public ControllableFallback Fallback => Services.GetRequiredService<ControllableFallback>();

    /// <summary>Scripted passkey ceremonies and account-store failures; empty unless a test fills it in.</summary>
    public IdentityScript Identity => Services.GetRequiredService<IdentityScript>();

    /// <summary>Runs code just before the app updates or deletes in the database.</summary>
    public CommandHook Commands => Services.GetRequiredService<CommandHook>();

    /// <summary>Tells when a request tagged with an <c>X-Test-Request</c> header has been fully handled.</summary>
    public RequestTracker Requests => Services.GetRequiredService<RequestTracker>();

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

    /// <summary>Wraps the app's database options so every context also reports its commands to the <see cref="CommandHook"/>.</summary>
    private static void ObserveDatabaseCommands(IServiceCollection services)
    {
        var original = services.Single(d => d.ServiceType == typeof(DbContextOptions<FolioDbContext>));
        services.Remove(original);
        services.Add(ServiceDescriptor.Describe(
            typeof(DbContextOptions<FolioDbContext>),
            sp => new DbContextOptionsBuilder<FolioDbContext>((DbContextOptions<FolioDbContext>)original.ImplementationFactory!(sp))
                .AddInterceptors(sp.GetRequiredService<CommandHook>())
                .Options,
            original.Lifetime));
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:Folio", _database.GetConnectionString());
        builder.UseSetting("MarketData:EnableScheduler", EnableScheduler ? "true" : "false");
        builder.UseSetting("MarketData:RequestDelayMilliseconds", "0");
        builder.UseSetting("Auth:EmailsPerTenMinutes", "100000");
        builder.UseSetting("Auth:VerifiesPerTenMinutes", "100000");
        Settings.Set("Auth:AllowedEmails", AllowedEmails);
        builder.ConfigureAppConfiguration(config => config.Add(Settings));
        builder.UseSetting("Auth:PublicUrl", "http://localhost");
        builder.UseSetting("Auth:AndroidApps", AndroidApps);
        builder.UseSetting("LogFile:Path", "");
        ConfigureSettings(builder);
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IMailer>();
            services.AddSingleton<CapturingMailer>();
            services.AddSingleton<IMailer>(sp => sp.GetRequiredService<CapturingMailer>());
            services.RemoveAll<IQuoteProvider>();
            services.AddSingleton<FakeQuoteProvider>();
            services.AddSingleton<IQuoteProvider>(sp => sp.GetRequiredService<FakeQuoteProvider>());
            services.RemoveAll<IFxProvider>();
            services.AddSingleton<FakeFxProvider>();
            services.AddSingleton<IFxProvider>(sp => sp.GetRequiredService<FakeFxProvider>());
            services.RemoveAll<IFallbackQuoteProvider>();
            services.AddSingleton<IdentityScript>();
            services.AddSingleton<CommandHook>();

            services.AddSingleton<RequestTracker>();
            ObserveDatabaseCommands(services);
            services.AddTransient<IStartupFilter, TestPipelineFilter>();
            services.RemoveAll<IUserClaimsPrincipalFactory<AppUser>>();
            services.AddScoped<IUserClaimsPrincipalFactory<AppUser>>(sp => ActivatorUtilities.CreateInstance<ScriptedClaimsFactory>(sp));
            services.RemoveAll<SignInManager<AppUser>>();
            services.AddScoped<SignInManager<AppUser>>(sp => ActivatorUtilities.CreateInstance<ScriptedSignInManager>(sp));
            services.RemoveAll<UserManager<AppUser>>();
            services.AddScoped<UserManager<AppUser>>(sp => ActivatorUtilities.CreateInstance<ScriptedUserManager>(sp));
            services.AddSingleton<ControllableFallback>();
            services.AddSingleton<IFallbackQuoteProvider>(sp => sp.GetRequiredService<ControllableFallback>());
            services.RemoveAll<TimeProvider>();
            services.AddSingleton<TimeProvider>(Time);
            ConfigureFakes(services);
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
        ["ODDCUR"] = new("ODDCUR", "Odd Currency Corp.", "XXX", "NYSE", AssetType.Stock),
        ["APPLE"] = new("AAPL", "Apple Inc.", "USD", "NASDAQ", AssetType.Stock),
        ["ALIASSRC"] = new("ALIASDST", "Alias Destination", "CAD", "TSX", AssetType.Stock),
        ["RACEX"] = new("RACEX", "Race Company", "CAD", "TSX", AssetType.Stock),
        ["HISTX"] = new("HISTX", "History Test Inc.", "CAD", "TSX", AssetType.Stock),
        ["FAILX"] = new("FAILX", "Failing Test Inc.", "CAD", "TSX", AssetType.Stock),
        ["PRICEX"] = new("PRICEX", "Price Test Inc.", "CAD", "TSX", AssetType.Stock),
        ["NOEXCH"] = new("NOEXCH", "No Exchange Inc.", "CAD", null, AssetType.Stock),
        ["LONGNAME"] = new("LONGNAME", new string('N', 250), "CAD", new string('E', 50), AssetType.Stock),
        ["DIVX"] = new("DIVX", "Dividend Payer Inc.", "CAD", "TSX", AssetType.Stock),
        ["NOSTART"] = new("NOSTART", "No Start Inc.", "CAD", "TSX", AssetType.Stock),
        ["A-SYMBOL-THAT-IS-FAR-TOO-LONG-FOR-THE-DATABASE"] = new("A-SYMBOL-THAT-IS-FAR-TOO-LONG-FOR-THE-DATABASE", "Long Symbol Inc.", "CAD", "TSX", AssetType.Stock),
        ["READERX"] = new("READERX", "Reader Test Inc.", "CAD", "TSX", AssetType.Stock),
        ["IMPORTX"] = new("IMPORTX", "Import Test Inc.", "CAD", "TSX", AssetType.Stock),
        ["STATX"] = new("STATX", "Status Test Inc.", "CAD", "TSX", AssetType.Stock),
        ["REFRX"] = new("REFRX", "Refresh Test X", "CAD", "TSX", AssetType.Stock),
        ["REFRY"] = new("REFRY", "Refresh Test Y", "CAD", "TSX", AssetType.Stock),
        ["EMPTYX"] = new("EMPTYX", "No Bars Inc.", "CAD", "TSX", AssetType.Stock),
        ["NULNAME"] = new("NULNAME", "Bad\0Name", "CAD", "TSX", AssetType.Stock),
    };

    /// <summary>Symbols that fail with the given exception, as a provider outage would.</summary>
    public System.Collections.Concurrent.ConcurrentDictionary<string, Exception> Failures { get; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>When set, every search fails with it.</summary>
    public Exception? SearchFailure { get; set; }

    /// <summary>Runs before a search is answered with the request's cancellation token, so a test can hold or abandon it.</summary>
    public Func<CancellationToken, Task>? BeforeSearch { get; set; }

    /// <summary>Runs before a history is answered, so a test can hold a request or change the database at that moment.</summary>
    public Func<string, Task>? BeforeHistory { get; set; }

    /// <summary>Like <see cref="BeforeHistory"/> but given the request's cancellation token, so a test can abandon the request while it waits.</summary>
    public Func<string, CancellationToken, Task>? WhileHistory { get; set; }

    public static decimal Close(string symbol, DateOnly date)
    {
        var price = symbol.ToUpperInvariant() switch
        {
            "SHOP.TO" => 100m,
            "AAPL" or "APPLE" => 200m,
            "HOLI.TO" => date >= FolioApiFactory.Today.AddDays(-1) ? 55m : 50m,
            _ => date >= SplitDate ? 50m : 100m,
        };
        return date == FolioApiFactory.Today ? price * 1.01m : price;
    }

    public async Task<IReadOnlyList<SymbolMatch>> SearchAsync(string query, CancellationToken ct)
    {
        if (BeforeSearch is { } hook)
            await hook(ct);
        return SearchFailure is { } failure ? throw failure : Matches(query);
    }

    private static IReadOnlyList<SymbolMatch> Matches(string query) =>
        Known.Values
            .Where(s => s.Symbol.Contains(query, StringComparison.OrdinalIgnoreCase) || s.Name.Contains(query, StringComparison.OrdinalIgnoreCase))
            .DistinctBy(s => s.Symbol)
            .Select(s => new SymbolMatch(s.Symbol, s.Name, s.Exchange, s.AssetType))
            .ToList();

    public async Task<PriceHistory> GetHistoryAsync(string symbol, DateOnly from, DateOnly to, CancellationToken ct)
    {
        if (BeforeHistory is { } hook)
            await hook(symbol);
        if (WhileHistory is { } gate)
            await gate(symbol, ct);
        if (Failures.TryGetValue(symbol, out var failure))
            throw failure;
        if (!Known.TryGetValue(symbol, out var info))
            throw new SymbolNotFoundException(symbol);

        var bars = new List<PricePoint>();
        for (var day = from; day <= to; day = day.AddDays(1))
        {
            var holiday = info.Symbol == "HOLI.TO" && day == FolioApiFactory.Today;
            if (info.Symbol != "EMPTYX" && day.DayOfWeek is not (DayOfWeek.Saturday or DayOfWeek.Sunday) && !holiday)
                bars.Add(new PricePoint(day, Close(symbol, day)));
        }

        var splits = info.Symbol == "SPLT" && SplitDate >= from && SplitDate <= to ? new[] { new SplitInfo(SplitDate, 2m, 1m) } : [];
        var dividends = info.Symbol == "DIVX"
            ? new[] { new DividendInfo(new DateOnly(2026, 9, 15), 0.5m), new DividendInfo(new DateOnly(2026, 9, 16), 0.25m) }.Where(d => d.Date >= from && d.Date <= to).ToList()
            : [];
        return new PriceHistory(info, bars, splits, dividends);
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

    /// <summary>When set, every request fails with it.</summary>
    public Exception? Failure { get; set; }

    /// <summary>Runs before rates are answered, so a test can hold a refresh in progress.</summary>
    public Func<Task>? BeforeRates { get; set; }

    /// <summary>Like <see cref="BeforeRates"/> but given the request's cancellation token, so a test can abandon the request while it waits.</summary>
    public Func<CancellationToken, Task>? WhileRates { get; set; }

    public async Task<IReadOnlyList<FxObservation>> GetCadRatesAsync(IReadOnlyCollection<string> currencies, DateOnly from, DateOnly to, CancellationToken ct)
    {
        if (BeforeRates is { } hook)
            await hook();
        if (WhileRates is { } gate)
            await gate(ct);
        if (Failure is { } failure)
            throw failure;
        var observations = new List<FxObservation>();
        for (var day = from; day <= to; day = day.AddDays(1))
        {
            if (day.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday)
                continue;
            foreach (var currency in currencies.Where(c => CadPerUnit(c, day) > 0))
                observations.Add(new FxObservation(currency, day, CadPerUnit(currency, day), "Fake"));
        }

        return observations;
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

    /// <summary>When set, sending fails with it, as an unreachable mail server would.</summary>
    public Exception? Failure { get; set; }

    public Task SendAsync(string to, string subject, string html, string text, CancellationToken ct)
    {
        if (Failure is { } failure)
            return Task.FromException(failure);
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

/// <summary>A second quote source that is off until a test configures it.</summary>
public sealed class ControllableFallback : IFallbackQuoteProvider
{
    public bool IsConfigured { get; set; }

    /// <summary>What it answers for every symbol; null means it has no quote.</summary>
    public PricePoint? Latest { get; set; }

    public Exception? Failure { get; set; }

    public List<string> Calls { get; } = [];

    public Task<PricePoint?> GetLatestAsync(string symbol, string currency, CancellationToken ct)
    {
        lock (Calls)
            Calls.Add(symbol);
        return Failure is { } failure ? Task.FromException<PricePoint?>(failure) : Task.FromResult(Latest);
    }
}

public sealed class NoFallback : IFallbackQuoteProvider
{
    public bool IsConfigured => false;

    public Task<PricePoint?> GetLatestAsync(string symbol, string currency, CancellationToken ct) => Task.FromResult<PricePoint?>(null);
}
