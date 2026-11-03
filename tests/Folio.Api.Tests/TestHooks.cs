using System.Collections.Concurrent;
using System.Data.Common;
using System.Security.Claims;
using Folio.Api.Auth;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Options;

namespace Folio.Api.Tests;

/// <summary>Runs a test's code just before the app sends an update or delete to the database, to stage a race.</summary>
public sealed class CommandHook : DbCommandInterceptor
{
    public Func<DbCommand, Task>? BeforeNonQuery { get; set; }

    /// <summary>Runs before a command that reads rows, which is also how inserts are sent.</summary>
    public Func<DbCommand, Task>? BeforeReader { get; set; }

    public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
        DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
    {
        if (BeforeReader is { } hook)
            await hook(command);
        return result;
    }

    public override async ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
        DbCommand command, CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        if (BeforeNonQuery is { } hook)
            await hook(command);
        return result;
    }
}

/// <summary>Remembers when a request has been completely handled, logging included, so a test can wait for it.</summary>
public sealed class RequestTracker
{
    private readonly ConcurrentDictionary<string, TaskCompletionSource> _done = new(StringComparer.Ordinal);

    public void Completed(string id) => Source(id).TrySetResult();

    public Task WhenCompletedAsync(string id) => Source(id).Task.WaitAsync(TimeSpan.FromSeconds(30));

    private TaskCompletionSource Source(string id) => _done.GetOrAdd(id, _ => new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously));
}

/// <summary>
/// Lets a test send requests whose signed-in user has no identity at all (<c>X-Test-Principal: NoIdentity</c>) or has
/// no user id (<c>NoUserId</c>), which the cookie never produces, and tells the <see cref="RequestTracker"/> when a
/// request (<c>X-Test-Request: id</c>) is finished.
/// </summary>
public sealed class TestPipelineFilter(RequestTracker tracker) : IStartupFilter
{
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
    {
        app.Use(async (context, pipeline) =>
        {
            switch (context.Request.Headers["X-Test-Principal"].ToString())
            {
                case "NoIdentity":
                    context.User = new ClaimsPrincipal();
                    break;
                case "NoUserId":
                    context.User = new ClaimsPrincipal(new ClaimsIdentity("Test"));
                    break;
            }

            var id = context.Request.Headers["X-Test-Request"].ToString();
            try
            {
                await pipeline();
            }
            finally
            {
                if (id.Length > 0)
                    tracker.Completed(id);
            }
        });
        next(app);
    };
}

/// <summary>Signs people in without the email claim when the script says so, as an older cookie would have been.</summary>
public sealed class ScriptedClaimsFactory(UserManager<AppUser> userManager, IOptions<IdentityOptions> options, IdentityScript script)
    : UserClaimsPrincipalFactory<AppUser>(userManager, options)
{
    protected override async Task<ClaimsIdentity> GenerateClaimsAsync(AppUser user)
    {
        var identity = await base.GenerateClaimsAsync(user);
        if (script.OmitEmailClaim)
        {
            foreach (var claim in identity.FindAll(ClaimTypes.Email).ToList())
                identity.RemoveClaim(claim);
        }

        return identity;
    }
}
