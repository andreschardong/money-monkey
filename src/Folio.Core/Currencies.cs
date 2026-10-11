namespace Folio.Core;

public static class Currencies
{
    public const string Cad = "CAD";
    public const string Usd = "USD";
    public const string Eur = "EUR";

    /// <summary>Currencies a portfolio can report in.</summary>
    public static readonly IReadOnlyList<string> PortfolioCurrencies = [Cad, Usd, Eur];

    /// <summary>
    /// Currencies that securities and cash may use. Each has a daily rate from the
    /// Bank of Canada or the European Central Bank.
    /// </summary>
    public static readonly IReadOnlySet<string> Supported = new HashSet<string>(StringComparer.Ordinal)
    {
        "CAD", "USD", "EUR", "GBP", "CHF", "JPY", "AUD", "NZD", "HKD", "SGD", "SEK", "NOK",
        "DKK", "PLN", "CZK", "HUF", "ILS", "CNY", "INR", "IDR", "KRW", "TWD", "MXN", "BRL",
        "ZAR", "TRY",
    };

    public static string Normalize(string? code) => (code ?? string.Empty).Trim().ToUpperInvariant();

    public static bool IsSupported(string? code) => code is not null && Supported.Contains(code);

    public static bool IsPortfolioCurrency(string? code) => code is not null && PortfolioCurrencies.Contains(code);
}
