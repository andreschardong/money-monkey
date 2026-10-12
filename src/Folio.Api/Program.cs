using System.Net;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.HttpOverrides;
using Folio.Api.Auth;
using Folio.Api.Data;
using Folio.Api.Endpoints;
using Folio.Api.MarketData;
using Folio.Api.Portfolios;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Options;
using Scalar.AspNetCore;
using Serilog;
using Serilog.Events;

var builder = WebApplication.CreateBuilder(args);

// Nothing legitimate posts more than a few megabytes (an import of thousands of transactions is well under).
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 10 * 1024 * 1024);

// Hosts such as Railway and Render say which port to listen on through PORT.
if (Environment.GetEnvironmentVariable("PORT") is { Length: > 0 } port && string.IsNullOrEmpty(builder.Configuration["ASPNETCORE_URLS"]))
    builder.WebHost.UseUrls($"http://*:{port}");

// Logging: Serilog to the console, plus daily files when LogFile:Path is set (logs/ next to docker-compose.yml).
builder.Services.AddSerilog((services, logger) =>
{
    logger.ReadFrom.Configuration(builder.Configuration)
        .ReadFrom.Services(services)
        .Enrich.FromLogContext()
        .WriteTo.Console(outputTemplate: "[{Timestamp:HH:mm:ss} {Level:u3}] {SourceContext}: {Message:lj}{NewLine}{Exception}");

    if (builder.Configuration["LogFile:Path"] is { Length: > 0 } path)
    {
        logger.WriteTo.File(path, rollingInterval: RollingInterval.Day, retainedFileCountLimit: 14,
            outputTemplate: "{Timestamp:yyyy-MM-dd HH:mm:ss.fff zzz} [{Level:u3}] {SourceContext}: {Message:lj}{NewLine}{Exception}");
    }
});

builder.Services.Configure<MarketDataOptions>(builder.Configuration.GetSection(MarketDataOptions.Section));
builder.Services.Configure<AuthOptions>(builder.Configuration.GetSection(AuthOptions.Section));
builder.Services.Configure<EmailOptions>(builder.Configuration.GetSection(EmailOptions.Section));

builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUser, HttpCurrentUser>();
builder.Services.AddDbContext<FolioDbContext>((services, options) => options
    // DATABASE_URL (the form cloud hosts hand out) wins over the appsettings default when both are present.
    .UseNpgsql(DatabaseUrl.ToConnectionString(
        Environment.GetEnvironmentVariable("DATABASE_URL") is { Length: > 0 } databaseUrl ? databaseUrl
        : services.GetRequiredService<IConfiguration>().GetConnectionString("Folio")
        ?? throw new InvalidOperationException("Set ConnectionStrings:Folio (or DATABASE_URL) to the PostgreSQL connection.")))
    .UseSnakeCaseNamingConvention()
    // Transactions and suggestions are reached through an already-checked portfolio, so the portfolio filter suffices.
    .ConfigureWarnings(w => w.Ignore(CoreEventId.PossibleIncorrectRequiredNavigationWithQueryFilterInteractionWarning)));

// Accounts: passkeys and one-time email links, no passwords. Sessions survive restarts because the
// cookie encryption keys live in the database.
builder.Services.AddIdentityCore<AppUser>(options =>
    {
        options.Stores.SchemaVersion = IdentitySchemaVersions.Version3;
        options.SignIn.RequireConfirmedEmail = true;
        options.User.RequireUniqueEmail = true;
        options.User.AllowedUserNameCharacters = string.Empty;
    })
    .AddEntityFrameworkStores<FolioDbContext>()
    .AddSignInManager();
builder.Services.Configure<IdentityPasskeyOptions>(options =>
{
    options.ServerDomain = builder.Configuration["Auth:PasskeyDomain"] ?? "localhost";
    options.UserVerificationRequirement = "required";
    options.ResidentKeyRequirement = "required";
    options.AuthenticatorTimeout = TimeSpan.FromMinutes(3);
});
builder.Services.AddAuthentication(IdentityConstants.ApplicationScheme).AddIdentityCookies();
// Removing a passkey or signing out everywhere changes the security stamp; sessions re-check it this often.
builder.Services.Configure<SecurityStampValidatorOptions>(options => options.ValidationInterval = TimeSpan.FromMinutes(5));
var publicUrl = builder.Configuration["Auth:PublicUrl"] ?? "http://localhost:8090";
// A passkey ceremony carries the page's origin; behind a TLS-terminating proxy the request itself may say
// http, so the public address is the origin of record (the request's own origin stays fine for development).
// The Android app's passkey ceremonies carry "android:apk-key-hash:<certificate hash>" as their origin.
var androidApps = AndroidApp.Parse(builder.Configuration["Auth:AndroidApps"]);
var androidOrigins = androidApps.SelectMany(a => a.Fingerprints).Select(AndroidApp.OriginOf).ToHashSet(StringComparer.Ordinal);
builder.Services.Configure<IdentityPasskeyOptions>(options => options.ValidateOrigin = context =>
{
    var allowed = new Uri(publicUrl).GetLeftPart(UriPartial.Authority);
    var request = context.HttpContext.Request;
    var own = $"{request.Scheme}://{request.Host}";
    var ok = !context.CrossOrigin &&
        (string.Equals(context.Origin, allowed, StringComparison.OrdinalIgnoreCase) ||
         string.Equals(context.Origin, own, StringComparison.OrdinalIgnoreCase) ||
         androidOrigins.Contains(context.Origin));
    return ValueTask.FromResult(ok);
});
builder.Services.ConfigureApplicationCookie(options =>
{
    options.Cookie.Name = "folio.session";
    options.Cookie.HttpOnly = true;
    options.Cookie.SameSite = SameSiteMode.Strict;
    options.Cookie.SecurePolicy = publicUrl.StartsWith("https", StringComparison.OrdinalIgnoreCase)
        ? CookieSecurePolicy.Always
        : CookieSecurePolicy.SameAsRequest;
    options.ExpireTimeSpan = TimeSpan.FromDays(30);
    options.SlidingExpiration = true;

    // The allowed email list is checked on every request (after the usual security-stamp check), so an
    // address taken off the list is signed out at its next request, not just kept from signing up.
    options.Events.OnValidatePrincipal = async context =>
    {
        await SecurityStampValidator.ValidatePrincipalAsync(context);
        if (context.Principal is null)
            return;

        var allowed = context.HttpContext.RequestServices.GetRequiredService<IOptionsMonitor<AuthOptions>>().CurrentValue;
        var email = context.Principal.FindFirstValue(ClaimTypes.Email) ?? context.Principal.Identity?.Name;
        if (!allowed.IsAllowed(email))
        {
            context.RejectPrincipal();
            await context.HttpContext.SignOutAsync(IdentityConstants.ApplicationScheme);
        }
    };

    // An API answers 401/403; the Angular app decides where to send the person.
    options.Events.OnRedirectToLogin = context =>
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return Task.CompletedTask;
    };
    options.Events.OnRedirectToAccessDenied = context =>
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        return Task.CompletedTask;
    };
});
builder.Services.AddAuthorization();
builder.Services.AddDataProtection().SetApplicationName("Folio").PersistKeysToDbContext<FolioDbContext>();

builder.Services.AddSingleton<IMailer, SmtpMailer>();
builder.Services.AddScoped<EmailLinkService>();
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy(AuthEndpoints.EmailRateLimit, http => RateLimitPartition.GetFixedWindowLimiter(
        http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = http.RequestServices.GetRequiredService<IOptions<AuthOptions>>().Value.EmailsPerTenMinutes,
            Window = TimeSpan.FromMinutes(10),
        }));
    options.AddPolicy(AuthEndpoints.VerifyRateLimit, http => RateLimitPartition.GetFixedWindowLimiter(
        http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = http.RequestServices.GetRequiredService<IOptions<AuthOptions>>().Value.VerifiesPerTenMinutes,
            Window = TimeSpan.FromMinutes(10),
        }));
});

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<MarketClock>();

// Yahoo rejects requests that don't look like a browser.
const string browserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
builder.Services.AddHttpClient<IQuoteProvider, YahooFinanceClient>(http =>
    {
        http.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", browserAgent);
        http.DefaultRequestHeaders.TryAddWithoutValidation("Accept", "application/json");
    })
    .AddStandardResilienceHandler();
builder.Services.AddHttpClient<IFallbackQuoteProvider, AlphaVantageClient>().AddStandardResilienceHandler();
builder.Services.AddHttpClient<IFxProvider, FxRateClient>(http => http.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", "Folio/1.0"))
    .AddStandardResilienceHandler();

builder.Services.AddScoped<MarketDataService>();
builder.Services.AddScoped<PortfolioAccess>();
builder.Services.AddScoped<PortfolioCalculator>();
builder.Services.AddScoped<TransactionWriter>();
builder.Services.AddScoped<SuggestionService>();
builder.Services.AddSingleton<RefreshCoordinator>();
builder.Services.AddHostedService<DailyRefreshWorker>();

builder.Services.AddHsts(options => options.MaxAge = TimeSpan.FromDays(365));
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<MarketDataExceptionHandler>();
builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddOpenApi();

var app = builder.Build();

if (app.Configuration.GetValue("Database:MigrateOnStartup", true))
{
    await using var scope = app.Services.CreateAsyncScope();
    await scope.ServiceProvider.GetRequiredService<FolioDbContext>().Database.MigrateAsync();
}

// Behind a reverse proxy (cloud), client addresses and the https scheme arrive in forwarded headers. Only
// proxies listed in Auth:TrustedProxies are believed, so a client can't spoof its address past the rate limiter.
// Auth:BehindProxy=true believes any proxy: for hosts such as Railway, Cloud Run or Fly, where the app is
// only reachable through the platform's own proxy and its addresses are not published.
var trustedProxies = app.Configuration.GetSection("Auth:TrustedProxies").Get<string[]>() ?? [];
var behindProxy = app.Configuration.GetValue("Auth:BehindProxy", false);
if (trustedProxies.Length > 0 || behindProxy)
{
    var forwarded = new ForwardedHeadersOptions { ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto };
    if (behindProxy)
    {
        forwarded.KnownIPNetworks.Clear();
        forwarded.KnownProxies.Clear();
    }
    foreach (var proxy in trustedProxies)
        forwarded.KnownProxies.Add(IPAddress.Parse(proxy));
    app.UseForwardedHeaders(forwarded);
}

// Browsers remember to use https for a year once they have seen the site over https (never set over plain http,
// so development on localhost is unaffected).
if (!app.Environment.IsDevelopment())
    app.UseHsts();

// Security headers on every response. The content security policy allows only the app's own files: scripts,
// styles (Angular Material sets styles inline, hence 'unsafe-inline' for styles only), fonts and the API, and
// it cannot be framed. The API explorer loads its viewer from a CDN, so it keeps the browser's defaults.
app.Use(async (context, next) =>
{
    var headers = context.Response.Headers;
    headers["X-Content-Type-Options"] = "nosniff";
    headers["X-Frame-Options"] = "DENY";
    headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=(), usb=()";
    if (!context.Request.Path.StartsWithSegments("/scalar") && !context.Request.Path.StartsWithSegments("/openapi"))
    {
        headers["Content-Security-Policy"] =
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
            "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
    }
    await next();
});

// Forgery guard for browsers: a call that changes something must come from Money Monkey's own origin. Browsers send
// Sec-Fetch-Site on every request; a page on another site, or another subdomain of the same domain, is refused
// even though the cookie rules alone might let the session through. Clients that are not browsers (tests,
// scripts) send no such header and carry no browser session, so they are unaffected.
app.Use(async (context, next) =>
{
    var method = context.Request.Method;
    var unsafeMethod = !HttpMethods.IsGet(method) && !HttpMethods.IsHead(method) && !HttpMethods.IsOptions(method);
    if (unsafeMethod && context.Request.Path.StartsWithSegments("/api") &&
        context.Request.Headers.TryGetValue("Sec-Fetch-Site", out var site) && site != "same-origin" && site != "none")
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await context.Response.WriteAsJsonAsync(new { title = "Blocked", status = 403, detail = "Requests that change something must come from Money Monkey itself." });
        return;
    }

    await next();
});

// Request logging sits outside the exception handler, so a handled problem is logged with the status the
// client received, and a request the browser cancelled (499) is not an error.
app.UseSerilogRequestLogging(options =>
{
    options.GetLevel = (http, _, error) =>
        http.Response.StatusCode == 499 ? LogEventLevel.Debug
        : error is not null || http.Response.StatusCode >= 500 ? LogEventLevel.Error
        : http.Request.Path.StartsWithSegments("/api") ? LogEventLevel.Information
        : LogEventLevel.Debug;
});
app.UseExceptionHandler();
app.UseStatusCodePages();

// The Angular build is copied into wwwroot in the container image; in development `ng serve` hosts it.
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

// The API explorer is for signed-in users; it describes endpoints that need a session anyway.
app.MapOpenApi().RequireAuthorization();
app.MapScalarApiReference(options => options.WithTitle("Money Monkey API")).RequireAuthorization();

// Everything under /api needs a signed-in account except the sign-in endpoints and the version.
var api = app.MapGroup("/api").RequireAuthorization();
api.MapVersionEndpoints();
api.MapAuthEndpoints();
api.MapOverviewEndpoints();
api.MapAssetEndpoints();
api.MapExportEndpoints();
api.MapImportEndpoints();
api.MapShareEndpoints();
api.MapPortfolioEndpoints();
api.MapTransactionEndpoints();
api.MapSecurityEndpoints();
api.MapMarketEndpoints();

app.MapGet("/health", () => TypedResults.Ok(new { status = "ok" })).ExcludeFromDescription();
// Digital Asset Links: lets the Android app use this site's passkeys and open its sign-in links.
app.MapGet("/.well-known/assetlinks.json", () => TypedResults.Json(androidApps.Select(a => new
    {
        relation = new[] { "delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds" },
        target = new { @namespace = "android_app", package_name = a.PackageName, sha256_cert_fingerprints = a.Fingerprints },
    })))
    .AllowAnonymous()
    .ExcludeFromDescription();
app.MapFallback("/api/{**path}", () => TypedResults.NotFound()).ExcludeFromDescription();
app.MapFallbackToFile("index.html");

app.Run();

public partial class Program;
