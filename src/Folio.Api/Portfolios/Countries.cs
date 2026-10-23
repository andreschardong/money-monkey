namespace Folio.Api.Portfolios;

/// <summary>
/// Where a portfolio is held, as an ISO 3166-1 alpha-2 code. Only the shape is checked here: the web app carries the
/// list of countries and their names, so the two can never disagree about what a code means.
/// </summary>
public static class Countries
{
    public static string? Normalize(string? code)
    {
        var trimmed = code?.Trim();
        return string.IsNullOrEmpty(trimmed) ? null : trimmed.ToUpperInvariant();
    }

    /// <summary>No country, or two capital letters.</summary>
    public static bool IsCode(string? normalized) =>
        normalized is null || (normalized.Length == 2 && normalized.All(c => c is >= 'A' and <= 'Z'));

    public const string Invalid = "The country must be a two-letter code, such as CA or US.";
}
