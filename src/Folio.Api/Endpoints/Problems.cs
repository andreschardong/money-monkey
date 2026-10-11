using Folio.Api.MarketData;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Folio.Api.Endpoints;

internal static class Problems
{
    public static ProblemHttpResult BadRequest(string detail) =>
        TypedResults.Problem(detail, statusCode: StatusCodes.Status400BadRequest, title: "That didn't work");

    public static ProblemHttpResult Forbidden(string detail) =>
        TypedResults.Problem(detail, statusCode: StatusCodes.Status403Forbidden, title: "Not allowed");

    public static ProblemHttpResult Conflict(string detail) =>
        TypedResults.Problem(detail, statusCode: StatusCodes.Status409Conflict, title: "Already exists");

    public static ProblemHttpResult Unavailable(string detail, string title = "Market data unavailable") =>
        TypedResults.Problem(detail, statusCode: StatusCodes.Status502BadGateway, title: title);
}

/// <summary>Turns provider failures that escape an endpoint into readable problem responses.</summary>
internal sealed class MarketDataExceptionHandler(IProblemDetailsService problems) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception, CancellationToken ct)
    {
        // The browser gave up on the request (typed the next letter, moved to another page): not an error.
        if (exception is OperationCanceledException && context.RequestAborted.IsCancellationRequested)
        {
            context.Response.StatusCode = 499;
            return true;
        }

        var (status, title, detail) = exception switch
        {
            SymbolNotFoundException e => (StatusCodes.Status404NotFound, "Symbol not found", e.Message),
            _ when MarketDataErrors.IsTransient(exception) => (StatusCodes.Status502BadGateway, "Market data unavailable",
                "The quote provider could not be reached. Check your internet connection and try again."),
            _ => (0, null, null),
        };
        if (status == 0)
            return false;

        context.Response.StatusCode = status;
        return await problems.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = context,
            Exception = exception,
            ProblemDetails = { Status = status, Title = title, Detail = detail },
        });
    }
}
