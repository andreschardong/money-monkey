using Folio.Api.Auth;
using Folio.Api.Data;
using Folio.Api.MarketData;
using Folio.Api.Portfolios;
using Folio.Core;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;

namespace Folio.Api.Endpoints;

/// <summary>Loads a Folio export (the JSON from the Account page) into this account as new portfolios.</summary>
public static class ImportEndpoints
{
    private const int MaxTransactions = 20_000;
    private const int MaxSymbols = 500;
    private const int MaxManualPrices = 100_000;

    public static void MapImportEndpoints(this IEndpointRouteBuilder api) =>
        api.MapPost("/import", Import).WithTags("Export");

    private static async Task<Results<Ok<ImportResultDto>, ProblemHttpResult>> Import(
        ExportDto export, FolioDbContext db, MarketDataService market, ICurrentUser me, TimeProvider time, CancellationToken ct)
    {
        if (me.Id is null)
            return Problems.Forbidden("Sign in to import.");
        if (export.Portfolios is null || export.Portfolios.Count == 0)
            return Problems.BadRequest("The file has no portfolios in it.");
        if (export.Portfolios.Sum(p => p.Transactions?.Count ?? 0) > MaxTransactions)
            return Problems.BadRequest($"The file has more than {MaxTransactions:N0} transactions.");
        var symbolCount = export.Portfolios.SelectMany(p => p.Transactions ?? []).Select(t => t.Symbol?.Trim().ToUpperInvariant())
            .Where(s => !string.IsNullOrEmpty(s)).Distinct().Count();
        if (symbolCount > MaxSymbols)
            return Problems.BadRequest($"The file has more than {MaxSymbols} different symbols; split it up.");

        var savedManual = (export.ManualSecurities ?? []).Select(s => s with { Prices = s.Prices ?? [] }).ToList();
        if (savedManual.Count > MaxSymbols || savedManual.Sum(s => s.Prices.Count) > MaxManualPrices)
            return Problems.BadRequest($"The file has more than {MaxSymbols} manual securities or {MaxManualPrices:N0} hand-entered prices; split it up.");
        if (savedManual.FirstOrDefault(s => string.IsNullOrWhiteSpace(s.Symbol) || s.Prices.Any(p => p.Close <= 0)) is { } bad)
            return Problems.BadRequest($"The manual security \"{bad.Symbol}\" needs a symbol and prices greater than zero.");
        var manualBySymbol = savedManual.DistinctBy(s => MarketDataService.NormalizeSymbol(s.Symbol))
            .ToDictionary(s => MarketDataService.NormalizeSymbol(s.Symbol), StringComparer.OrdinalIgnoreCase);

        // All or nothing: a file refused halfway through must not leave securities or prices behind.
        await using var scope = await db.Database.BeginTransactionAsync(ct);
        var existingNames = (await db.Portfolios.Select(p => p.Name).ToListAsync(ct)).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var warnings = new List<string>();
        var securities = new Dictionary<string, Security>(StringComparer.OrdinalIgnoreCase);
        var now = time.GetUtcNow();
        var created = new List<Portfolio>();
        var transactions = 0;
        var cashEntries = 0;

        foreach (var source in export.Portfolios)
        {
            if (string.IsNullOrWhiteSpace(source.Name) || !Currencies.IsPortfolioCurrency(Currencies.Normalize(source.BaseCurrency)))
                return Problems.BadRequest($"Portfolio \"{source.Name}\" needs a name and a currency of CAD, USD or EUR.");

            var name = source.Name.Trim();
            if (existingNames.Contains(name))
                name = $"{name} (imported)";
            existingNames.Add(name);
            var country = Countries.Normalize(source.Country);
            if (!Countries.IsCode(country))
                return Problems.BadRequest($"Portfolio \"{source.Name}\": {Countries.Invalid}");

            var portfolio = new Portfolio
            {
                Id = Guid.CreateVersion7(),
                OwnerId = me.Id,
                Name = name,
                BaseCurrency = Currencies.Normalize(source.BaseCurrency),
                Description = string.IsNullOrWhiteSpace(source.Description) ? null : source.Description.Trim(),
                Country = country,
                Kind = Enum.IsDefined(source.Kind) ? source.Kind : PortfolioKind.Investment,
                CreatedAt = now,
                UpdatedAt = now,
            };

            var sequence = 0L;
            foreach (var t in (source.Transactions ?? []).OrderBy(t => t.Date))
            {
                if (!Enum.IsDefined(t.Type))
                    return Problems.BadRequest($"\"{name}\": unknown transaction type on {t.Date:yyyy-MM-dd}.");
                var currency = Currencies.Normalize(t.Currency);
                if (!Currencies.IsSupported(currency))
                    return Problems.BadRequest($"\"{name}\": unsupported currency {t.Currency} on {t.Date:yyyy-MM-dd}.");

                Security? security = null;
                if (t.Type.RequiresSecurity())
                {
                    if (string.IsNullOrWhiteSpace(t.Symbol))
                        return Problems.BadRequest($"\"{name}\": the {t.Type} on {t.Date:yyyy-MM-dd} has no symbol.");
                    security = await ResolveAsync(t, currency, securities, manualBySymbol, db, market, me, warnings, ct);
                }

                portfolio.Transactions.Add(new Transaction
                {
                    Id = Guid.CreateVersion7(),
                    PortfolioId = portfolio.Id,
                    Type = t.Type,
                    Date = t.Date,
                    Sequence = ++sequence,
                    SecurityId = security?.Id,
                    Currency = security?.Currency ?? currency,
                    Quantity = t.Quantity,
                    Price = t.Price,
                    Amount = t.Amount,
                    Fee = t.Fee,
                    FxRate = t.FxRate <= 0 ? 1m : t.FxRate,
                    SplitFrom = t.SplitFrom,
                    SplitTo = t.SplitTo,
                    Note = string.IsNullOrWhiteSpace(t.Note) ? null : t.Note.Trim(),
                    CreatedAt = now,
                    UpdatedAt = now,
                });
            }

            try
            {
                PortfolioLedger.Replay(portfolio.BaseCurrency, portfolio.Transactions.Select(x => x.ToLedgerEntry()));
            }
            catch (LedgerException ex)
            {
                return Problems.BadRequest($"\"{name}\" doesn't add up: {ex.Message}");
            }

            db.Portfolios.Add(portfolio);
            foreach (var c in (source.CashBalances ?? []).DistinctBy(c => (Currencies.Normalize(c.Currency), c.Date)))
            {
                var currency = Currencies.Normalize(c.Currency);
                if (!Currencies.IsSupported(currency))
                    return Problems.BadRequest($"\"{name}\": unsupported cash currency {c.Currency}.");
                db.CashBalances.Add(new CashBalance { PortfolioId = portfolio.Id, Currency = currency, Date = c.Date, Balance = c.Balance, Note = c.Note, UpdatedAt = now });
                cashEntries++;
            }

            created.Add(portfolio);
            transactions += portfolio.Transactions.Count;
        }

        await db.SaveChangesAsync(ct);
        await scope.CommitAsync(ct);
        return TypedResults.Ok(new ImportResultDto(created.Count, transactions, cashEntries, warnings));
    }

    /// <summary>
    /// A quoted symbol is looked up (and shared); anything that can't be quoted becomes a manually priced security, with
    /// the asset type and prices the file saved for it.
    /// </summary>
    private static async Task<Security> ResolveAsync(
        ExportTransactionDto t, string currency, Dictionary<string, Security> cache, Dictionary<string, ExportSecurityDto> saved,
        FolioDbContext db, MarketDataService market, ICurrentUser me, List<string> warnings, CancellationToken ct)
    {
        var symbol = MarketDataService.NormalizeSymbol(t.Symbol!);
        if (cache.TryGetValue(symbol, out var cached))
            return cached;

        var manual = string.Equals(t.PriceSource, nameof(PriceSource.Manual), StringComparison.OrdinalIgnoreCase);
        var mine = await db.Securities.SingleOrDefaultAsync(s => s.Symbol == symbol && s.OwnerId == me.Id, ct);
        var shared = manual ? null : await db.Securities.SingleOrDefaultAsync(s => s.Symbol == symbol && s.OwnerId == null, ct);
        var security = manual ? mine ?? shared : shared ?? mine;

        if (security is null && !manual)
        {
            try
            {
                security = await market.ResolveAsync(symbol, t.Date, ct);
            }
            catch (Exception ex) when (ex is SymbolNotFoundException || MarketDataErrors.IsTransient(ex))
            {
                warnings.Add($"{symbol} could not be quoted; it was added with a manual price. {ex.Message}");
            }
        }

        if (security is null)
        {
            var name = string.IsNullOrWhiteSpace(t.SecurityName) ? symbol : t.SecurityName!;
            if (saved.TryGetValue(symbol, out var restored))
            {
                var assetType = Enum.IsDefined(restored.AssetType) ? restored.AssetType : AssetType.Other;
                security = await market.CreateManualAsync(symbol, name, currency, assetType, ct);
                await market.SetManualPricesAsync(security, restored.Prices.Select(p => new PricePoint(p.Date, p.Close)).ToList(), ct);
            }
            else
            {
                security = await market.CreateManualAsync(symbol, name, currency, AssetType.Other, ct);
            }
        }

        cache[symbol] = security;
        return security;
    }
}
