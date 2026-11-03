using System.Text.Json;
using Folio.Api.Data;
using Folio.Api.Endpoints;
using Folio.Api.MarketData;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Http;
using NSubstitute;
using Polly.CircuitBreaker;
using Polly.Timeout;

namespace Folio.Api.Tests;

public class MarketDataSupportTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Theory]
    [InlineData("TOR", null, "TSX")]
    [InlineData("tor", null, "TSX")]
    [InlineData("NMS", "NasdaqGS", "NASDAQ")]
    [InlineData("XYZ", "Somewhere", "Somewhere")]
    [InlineData("XYZ", null, "XYZ")]
    [InlineData(null, "Somewhere", "Somewhere")]
    [InlineData(null, null, null)]
    public void WhenExchangeCodeIsLookedUp_ShouldPreferTheFriendlyNameThenTheFallbackThenTheCode(string? code, string? fallback, string? expected) =>
        Exchanges.Name(code, fallback).ShouldBe(expected);

    [Theory]
    [InlineData("equity", AssetType.Stock)]
    [InlineData("ETF", AssetType.Etf)]
    [InlineData("MutualFund", AssetType.Fund)]
    [InlineData("CRYPTOCURRENCY", AssetType.Crypto)]
    [InlineData("INDEX", AssetType.Other)]
    [InlineData(null, AssetType.Other)]
    public void WhenInstrumentTypeIsMapped_ShouldGiveTheAssetType(string? yahooType, AssetType expected) =>
        Exchanges.AssetTypeOf(yahooType).ShouldBe(expected);

    [Theory]
    [InlineData("equity", true)]
    [InlineData("ETF", true)]
    [InlineData("MUTUALFUND", true)]
    [InlineData("cryptocurrency", true)]
    [InlineData("INDEX", false)]
    [InlineData("CURRENCY", false)]
    [InlineData(null, false)]
    public void WhenInstrumentTypeIsChecked_ShouldBeHoldableOnlyForSecuritiesAndCrypto(string? yahooType, bool expected) =>
        Exchanges.IsHoldable(yahooType).ShouldBe(expected);

    public static TheoryData<Exception, bool> Failures => new()
    {
        { new MarketDataException("x"), true },
        { new SymbolNotFoundException("x"), true },
        { new HttpRequestException("x"), true },
        { new JsonException("x"), true },
        { new TimeoutException(), true },
        { new TimeoutRejectedException("x"), true },
        { new BrokenCircuitException(), true },
        { new TaskCanceledException("x", new TimeoutException()), true },
        { new TaskCanceledException("x"), false },
        { new InvalidOperationException("x"), false },
        { new NullReferenceException(), false },
    };

    [Theory]
    [MemberData(nameof(Failures))]
    public void WhenFailureIsClassified_ShouldBeTransientOnlyForNetworkAndProviderFailures(Exception ex, bool expected) =>
        MarketDataErrors.IsTransient(ex).ShouldBe(expected);

    private static (MarketDataExceptionHandler Handler, IProblemDetailsService Problems, DefaultHttpContext Context) CreateHandler(bool written = true)
    {
        var problems = Substitute.For<IProblemDetailsService>();
        problems.TryWriteAsync(Arg.Any<ProblemDetailsContext>()).Returns(new ValueTask<bool>(written));
        return (new MarketDataExceptionHandler(problems), problems, new DefaultHttpContext());
    }

    [Fact]
    public async Task WhenTheBrowserCancelsTheRequest_ShouldAnswer499WithoutAProblemBody()
    {
        var (handler, problems, context) = CreateHandler();
        using var aborted = new CancellationTokenSource();
        await aborted.CancelAsync();
        context.RequestAborted = aborted.Token;

        var handled = await handler.TryHandleAsync(context, new OperationCanceledException(), Ct);

        handled.ShouldBeTrue();
        context.Response.StatusCode.ShouldBe(499);
        await problems.DidNotReceiveWithAnyArgs().TryWriteAsync(default!);
    }

    [Fact]
    public async Task WhenCancellationDidNotComeFromTheBrowser_ShouldLeaveItUnhandled()
    {
        var (handler, _, context) = CreateHandler();

        (await handler.TryHandleAsync(context, new OperationCanceledException(), Ct)).ShouldBeFalse();
    }

    [Fact]
    public async Task WhenSymbolIsUnknown_ShouldAnswer404WithTheProvidersMessage()
    {
        var (handler, problems, context) = CreateHandler();
        ProblemDetailsContext? seen = null;
        problems.TryWriteAsync(Arg.Do<ProblemDetailsContext>(c => seen = c)).Returns(new ValueTask<bool>(true));

        var handled = await handler.TryHandleAsync(context, new SymbolNotFoundException("ZZZ"), Ct);

        handled.ShouldBeTrue();
        context.Response.StatusCode.ShouldBe(404);
        seen.ShouldNotBeNull();
        seen.ProblemDetails.Status.ShouldBe(404);
        seen.ProblemDetails.Title.ShouldBe("Symbol not found");
        seen.ProblemDetails.Detail!.ShouldContain("ZZZ");
    }

    [Fact]
    public async Task WhenProviderIsUnreachable_ShouldAnswer502WithAFriendlyMessage()
    {
        var (handler, problems, context) = CreateHandler();
        ProblemDetailsContext? seen = null;
        problems.TryWriteAsync(Arg.Do<ProblemDetailsContext>(c => seen = c)).Returns(new ValueTask<bool>(true));

        var handled = await handler.TryHandleAsync(context, new HttpRequestException("boom"), Ct);

        handled.ShouldBeTrue();
        context.Response.StatusCode.ShouldBe(502);
        seen!.ProblemDetails.Title.ShouldBe("Market data unavailable");
        seen.ProblemDetails.Detail.ShouldBe("The quote provider could not be reached. Check your internet connection and try again.");
    }

    [Fact]
    public async Task WhenProblemCannotBeWritten_ShouldReportItAsUnhandled()
    {
        var (handler, _, context) = CreateHandler(written: false);

        (await handler.TryHandleAsync(context, new TimeoutException(), Ct)).ShouldBeFalse();
    }

    [Fact]
    public async Task WhenFailureIsABug_ShouldLeaveItToTheDefaultHandler()
    {
        var (handler, problems, context) = CreateHandler();

        (await handler.TryHandleAsync(context, new InvalidOperationException("bug"), Ct)).ShouldBeFalse();

        await problems.DidNotReceiveWithAnyArgs().TryWriteAsync(default!);
        context.Response.StatusCode.ShouldBe(200);
    }

    [Fact]
    public void WhenProblemShortcutsAreUsed_ShouldCarryTheirStatusAndTitle()
    {
        Problems.BadRequest("a").StatusCode.ShouldBe(400);
        Problems.Forbidden("a").StatusCode.ShouldBe(403);
        Problems.Conflict("a").StatusCode.ShouldBe(409);
        var unavailable = Problems.Unavailable("a");
        unavailable.StatusCode.ShouldBe(502);
        unavailable.ProblemDetails.Title.ShouldBe("Market data unavailable");
        Problems.Unavailable("a", "Other").ProblemDetails.Title.ShouldBe("Other");
    }
}
