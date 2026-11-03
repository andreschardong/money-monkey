using Folio.Api.Auth;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Folio.Api.Tests;

/// <summary>
/// What a test wants the account system to do instead of its normal behaviour: a passkey ceremony needs a browser's
/// authenticator, so the outcome of one is scripted here, and so are the store failures that cannot be provoked otherwise.
/// Everything is off by default and the normal code runs.
/// </summary>
public sealed class IdentityScript
{
    /// <summary>When set, a passkey sign-in is accepted for this account (loaded by the request's own account store) with this passkey.</summary>
    public (string Email, UserPasskeyInfo Passkey)? AcceptPasskeyFor { get; set; }

    /// <summary>When set, a passkey sign-in is rejected with this error.</summary>
    public PasskeyException? RejectPasskey { get; set; }

    public Func<string, PasskeyAttestationResult>? Attestation { get; set; }

    /// <summary>When true, new sessions are signed in without an email claim.</summary>
    public bool OmitEmailClaim { get; set; }

    public string? FailCreateFor { get; set; }

    public string? FailUpdateFor { get; set; }

    public string? FailPasskeySaveFor { get; set; }

    public string? FailPasskeyRemoveFor { get; set; }

    public void Reset()
    {
        AcceptPasskeyFor = null;
        RejectPasskey = null;
        Attestation = null;
        OmitEmailClaim = false;
        FailCreateFor = FailUpdateFor = FailPasskeySaveFor = FailPasskeyRemoveFor = null;
    }

    public static UserPasskeyInfo NewPasskey(DateTimeOffset? createdAt = null) => new(
        Guid.NewGuid().ToByteArray(), [1, 2, 3], createdAt ?? DateTimeOffset.UnixEpoch, 0, [], true, true, false, [], []);
}

public sealed class ScriptedSignInManager(
    UserManager<AppUser> userManager,
    IHttpContextAccessor contextAccessor,
    IUserClaimsPrincipalFactory<AppUser> claimsFactory,
    IOptions<IdentityOptions> optionsAccessor,
    ILogger<SignInManager<AppUser>> logger,
    IAuthenticationSchemeProvider schemes,
    IUserConfirmation<AppUser> confirmation,
    IdentityScript script)
    : SignInManager<AppUser>(userManager, contextAccessor, claimsFactory, optionsAccessor, logger, schemes, confirmation)
{
    public override async Task<PasskeyAssertionResult<AppUser>> PerformPasskeyAssertionAsync(string credentialJson)
    {
        if (script.RejectPasskey is { } rejection)
            return PasskeyAssertionResult.Fail<AppUser>(rejection);
        if (script.AcceptPasskeyFor is { } accepted)
            return PasskeyAssertionResult.Success(accepted.Passkey, (await UserManager.FindByEmailAsync(accepted.Email))!);
        return await base.PerformPasskeyAssertionAsync(credentialJson);
    }

    public override Task<PasskeyAttestationResult> PerformPasskeyAttestationAsync(string credentialJson) =>
        script.Attestation is { } attestation ? Task.FromResult(attestation(credentialJson)) : base.PerformPasskeyAttestationAsync(credentialJson);
}

public sealed class ScriptedUserManager(
    IUserStore<AppUser> store,
    IOptions<IdentityOptions> optionsAccessor,
    IPasswordHasher<AppUser> passwordHasher,
    IEnumerable<IUserValidator<AppUser>> userValidators,
    IEnumerable<IPasswordValidator<AppUser>> passwordValidators,
    ILookupNormalizer keyNormalizer,
    IdentityErrorDescriber errors,
    IServiceProvider services,
    ILogger<UserManager<AppUser>> logger,
    IdentityScript script)
    : UserManager<AppUser>(store, optionsAccessor, passwordHasher, userValidators, passwordValidators, keyNormalizer, errors, services, logger)
{
    private static IdentityResult Failed(string description) => IdentityResult.Failed(new IdentityError { Description = description });

    public override Task<IdentityResult> CreateAsync(AppUser user) =>
        user.Email == script.FailCreateFor ? Task.FromResult(Failed("The account could not be created.")) : base.CreateAsync(user);

    public override Task<IdentityResult> UpdateAsync(AppUser user) =>
        user.Email == script.FailUpdateFor ? Task.FromResult(Failed("The account could not be saved.")) : base.UpdateAsync(user);

    public override Task<IdentityResult> AddOrUpdatePasskeyAsync(AppUser user, UserPasskeyInfo passkey) =>
        user.Email == script.FailPasskeySaveFor ? Task.FromResult(Failed("The passkey could not be stored.")) : base.AddOrUpdatePasskeyAsync(user, passkey);

    public override Task<IdentityResult> RemovePasskeyAsync(AppUser user, byte[] credentialId) =>
        user.Email == script.FailPasskeyRemoveFor ? Task.FromResult(Failed("The passkey could not be removed.")) : base.RemovePasskeyAsync(user, credentialId);
}
