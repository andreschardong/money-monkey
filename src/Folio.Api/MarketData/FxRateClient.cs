using System.Globalization;
using System.Text.Json;
using Folio.Core;

namespace Folio.Api.MarketData;

/// <summary>
/// Daily exchange rates against the Canadian dollar. The Bank of Canada's Valet API is the official source
/// from 2017 on; the European Central Bank's reference rates (via Frankfurter) cover earlier dates, other
/// currencies, and any Bank of Canada outage.
/// </summary>
public sealed class FxRateClient(HttpClient http, ILogger<FxRateClient> logger) : IFxProvider
{
    public const string BankOfCanadaHost = "https://www.bankofcanada.ca";
    public const string FrankfurterHost = "https://api.frankfurter.dev";

    private static readonly HashSet<string> BankOfCanadaCurrencies =
    [
        "USD", "EUR", "GBP", "CHF", "JPY", "AUD", "NZD", "HKD", "SGD", "SEK", "NOK", "CNY", "INR", "IDR",
        "KRW", "TWD", "MXN", "BRL", "ZAR", "TRY",
    ];

    private static readonly DateOnly BankOfCanadaFirstDate = new(2017, 1, 3);

    public async Task<IReadOnlyList<FxObservation>> GetCadRatesAsync(
        IReadOnlyCollection<string> currencies, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var wanted = currencies.Where(c => c != Currencies.Cad).Distinct().ToList();
        if (wanted.Count == 0 || from > to)
            return [];

        var results = new List<FxObservation>();
        var fromEcb = new List<(List<string> Currencies, DateOnly From, DateOnly To)>();
        var boc = wanted.Where(BankOfCanadaCurrencies.Contains).ToList();
        var ecbOnly = wanted.Except(boc).ToList();
        if (ecbOnly.Count > 0)
            fromEcb.Add((ecbOnly, from, to));

        if (boc.Count > 0 && from < BankOfCanadaFirstDate)
            fromEcb.Add((boc, from, Min(to, BankOfCanadaFirstDate.AddDays(-1))));

        if (boc.Count > 0 && to >= BankOfCanadaFirstDate)
        {
            var start = Max(from, BankOfCanadaFirstDate);
            try
            {
                results.AddRange(await GetBankOfCanadaAsync(boc, start, to, ct));
            }
            catch (Exception ex) when (ex is HttpRequestException or JsonException or InvalidOperationException
                                       || (ex is OperationCanceledException && !ct.IsCancellationRequested))
            {
                logger.LogWarning(ex, "Bank of Canada rates unavailable; falling back to ECB rates.");
                fromEcb.Add((boc, start, to));
            }
        }

        foreach (var (list, start, end) in fromEcb)
            results.AddRange(await GetEcbAsync(list, start, end, ct));
        return results;
    }

    private async Task<List<FxObservation>> GetBankOfCanadaAsync(List<string> currencies, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var series = string.Join(',', currencies.Select(c => $"FX{c}CAD"));
        var url = $"{BankOfCanadaHost}/valet/observations/{series}/json?start_date={Iso(from)}&end_date={Iso(to)}";
        using var document = JsonDocument.Parse(await http.GetStringAsync(url, ct));

        var results = new List<FxObservation>();
        foreach (var observation in document.RootElement.GetProperty("observations").EnumerateArray())
        {
            var date = DateOnly.ParseExact(observation.GetProperty("d").GetString()!, "yyyy-MM-dd", CultureInfo.InvariantCulture);
            foreach (var currency in currencies)
            {
                if (observation.TryGetProperty($"FX{currency}CAD", out var cell)
                    && cell.TryGetProperty("v", out var value)
                    && decimal.TryParse(value.GetString(), NumberStyles.Number, CultureInfo.InvariantCulture, out var rate)
                    && rate > 0)
                {
                    results.Add(new FxObservation(currency, date, rate, "BankOfCanada"));
                }
            }
        }

        return results;
    }

    private async Task<List<FxObservation>> GetEcbAsync(List<string> currencies, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var url = $"{FrankfurterHost}/v1/{Iso(from)}..{Iso(to)}?base=CAD&symbols={string.Join(',', currencies)}";
        using var document = JsonDocument.Parse(await http.GetStringAsync(url, ct));

        var results = new List<FxObservation>();
        if (!document.RootElement.TryGetProperty("rates", out var rates))
            return results;

        foreach (var day in rates.EnumerateObject())
        {
            var date = DateOnly.ParseExact(day.Name, "yyyy-MM-dd", CultureInfo.InvariantCulture);
            foreach (var quote in day.Value.EnumerateObject())
            {
                // Quoted as units of the currency per CAD; store the inverse.
                var perCad = quote.Value.GetDecimal();
                if (perCad > 0)
                    results.Add(new FxObservation(quote.Name, date, decimal.Round(1m / perCad, 8), "ECB"));
            }
        }

        return results;
    }

    private static string Iso(DateOnly date) => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static DateOnly Min(DateOnly a, DateOnly b) => a < b ? a : b;

    private static DateOnly Max(DateOnly a, DateOnly b) => a > b ? a : b;
}
