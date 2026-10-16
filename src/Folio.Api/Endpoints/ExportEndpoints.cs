using System.Globalization;
using System.Text;
using Folio.Api.Auth;
using Folio.Api.Data;
using Folio.Api.Portfolios;
using Folio.Core;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;

namespace Folio.Api.Endpoints;

/// <summary>Everything the account entered, as one JSON document or as CSV files for a spreadsheet.</summary>
public static class ExportEndpoints
{
    public static void MapExportEndpoints(this IEndpointRouteBuilder api)
    {
        var group = api.MapGroup("/export").WithTags("Export");
        group.MapGet("/", Json);
        group.MapGet("/transactions.csv", TransactionsCsv);
        group.MapGet("/cash.csv", CashCsv);
        group.MapGet("/holdings.csv", HoldingsCsv);
    }

    private static async Task<Ok<ExportDto>> Json(FolioDbContext db, ICurrentUser me, TimeProvider time, CancellationToken ct)
    {
        // The account's own portfolios: what others shared is theirs to export.
        var portfolios = await db.Portfolios.AsNoTracking().Where(p => p.OwnerId == me.Id).OrderBy(p => p.CreatedAt).ToListAsync(ct);
        var ids = portfolios.Select(p => p.Id).ToList();
        var transactions = await db.Transactions.AsNoTracking().Include(t => t.Security)
            .Where(t => ids.Contains(t.PortfolioId)).OrderBy(t => t.Date).ThenBy(t => t.Sequence).ToListAsync(ct);
        var cash = await db.CashBalances.AsNoTracking()
            .Where(c => ids.Contains(c.PortfolioId)).OrderBy(c => c.Currency).ThenBy(c => c.Date).ToListAsync(ct);

        var export = new ExportDto(time.GetUtcNow(), portfolios.Select(p => new ExportPortfolioDto(
            p.Id, p.Name, p.BaseCurrency, p.Description, p.CreatedAt,
            transactions.Where(t => t.PortfolioId == p.Id).Select(t => new ExportTransactionDto(
                t.Date, t.Type, t.Security?.Symbol, t.Security?.Name, t.Security?.PriceSource.ToString(), t.Currency, t.Quantity, t.Price, t.Amount, t.Fee,
                t.FxRate, t.SplitFrom, t.SplitTo, t.Note)).ToList(),
            cash.Where(c => c.PortfolioId == p.Id).Select(c => new CashEntryDto(c.Currency, c.Date, c.Balance, c.Note)).ToList(),
            p.Country)).ToList());
        return TypedResults.Ok(export);
    }

    private static async Task<FileContentHttpResult> TransactionsCsv(FolioDbContext db, ICurrentUser me, MarketData.MarketClock clock, CancellationToken ct)
    {
        var rows = await db.Transactions.AsNoTracking().Include(t => t.Security)
            .Where(t => db.Portfolios.Any(p => p.Id == t.PortfolioId && p.OwnerId == me.Id))
            .OrderBy(t => t.Date).ThenBy(t => t.Sequence)
            .Select(t => new
            {
                Portfolio = db.Portfolios.Where(p => p.Id == t.PortfolioId).Select(p => p.Name).First(),
                t.Date, t.Type, t.Security!.Symbol, SecurityName = t.Security.Name, t.Currency,
                t.Quantity, t.Price, t.Amount, t.Fee, t.FxRate, t.SplitFrom, t.SplitTo, t.Note,
            })
            .ToListAsync(ct);

        var csv = new CsvBuilder("Portfolio", "Date", "Type", "Symbol", "Security", "Currency", "Quantity", "Price", "Amount", "Fee",
            "Exchange rate", "Split from", "Split to", "Note");
        foreach (var r in rows)
        {
            csv.Row(r.Portfolio, r.Date, r.Type, r.Symbol, r.SecurityName, r.Currency, r.Quantity, r.Price, r.Amount, r.Fee,
                r.FxRate, r.SplitFrom, r.SplitTo, r.Note);
        }

        return csv.ToFile($"folio-transactions-{clock.Today:yyyy-MM-dd}.csv");
    }

    private static async Task<FileContentHttpResult> CashCsv(FolioDbContext db, ICurrentUser me, MarketData.MarketClock clock, CancellationToken ct)
    {
        var rows = await db.CashBalances.AsNoTracking()
            .Where(c => db.Portfolios.Any(p => p.Id == c.PortfolioId && p.OwnerId == me.Id))
            .OrderBy(c => c.Currency).ThenBy(c => c.Date)
            .Select(c => new { Portfolio = db.Portfolios.Where(p => p.Id == c.PortfolioId).Select(p => p.Name).First(), c.Currency, c.Date, c.Balance, c.Note })
            .ToListAsync(ct);

        var csv = new CsvBuilder("Portfolio", "Currency", "Date", "Balance", "Note");
        foreach (var r in rows)
            csv.Row(r.Portfolio, r.Currency, r.Date, r.Balance, r.Note);
        return csv.ToFile($"folio-cash-{clock.Today:yyyy-MM-dd}.csv");
    }

    /// <summary>Current positions as valued today, one line per portfolio and security.</summary>
    private static async Task<FileContentHttpResult> HoldingsCsv(FolioDbContext db, ICurrentUser me, PortfolioCalculator calculator, CancellationToken ct)
    {
        var csv = new CsvBuilder("Portfolio", "Portfolio currency", "Symbol", "Security", "Currency", "Shares", "Average cost",
            "Book value (portfolio currency)", "Price", "Price date", "Market value", "Market value (portfolio currency)",
            "Unrealized gain (portfolio currency)");
        foreach (var portfolio in await db.Portfolios.AsNoTracking().Where(p => p.OwnerId == me.Id).OrderBy(p => p.CreatedAt).ToListAsync(ct))
        {
            var snapshot = await calculator.SnapshotAsync(portfolio, ct);
            foreach (var h in snapshot.Valuation.Holdings.OrderByDescending(h => h.MarketValueBase))
            {
                var security = snapshot.Securities[h.Position.SecurityId];
                csv.Row(portfolio.Name, portfolio.BaseCurrency, security.Symbol, security.Name, h.Position.Currency, h.Position.Quantity,
                    PortfolioMapper.Price(h.Position.AverageCostLocal), PortfolioMapper.Money(h.Position.CostBase), h.Price?.Close, h.Price?.Date,
                    PortfolioMapper.Money(h.MarketValueLocal), PortfolioMapper.Money(h.MarketValueBase), PortfolioMapper.Money(h.UnrealizedBase));
            }

            foreach (var c in snapshot.Valuation.Cash)
            {
                csv.Row(portfolio.Name, portfolio.BaseCurrency, "CASH", $"Cash {c.Currency}", c.Currency, c.Balance, null, null, null, c.AsOf,
                    PortfolioMapper.Money(c.Balance), PortfolioMapper.Money(c.ValueBase), null);
            }
        }

        return csv.ToFile($"folio-holdings-{calculator.Today:yyyy-MM-dd}.csv");
    }

    /// <summary>RFC 4180 CSV with a UTF-8 byte order mark, which Excel reads correctly.</summary>
    private sealed class CsvBuilder
    {
        private readonly StringBuilder _text = new();

        public CsvBuilder(params string[] header) => Row(header);

        public void Row(params object?[] cells)
        {
            _text.AppendJoin(',', cells.Select(Format));
            _text.Append("\r\n");
        }

        public FileContentHttpResult ToFile(string fileName)
        {
            var bytes = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(_text.ToString())).ToArray();
            return TypedResults.File(bytes, "text/csv; charset=utf-8", fileName);
        }

        private static string Format(object? cell)
        {
            var text = cell switch
            {
                null => string.Empty,
                DateOnly d => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                decimal m => m.ToString("0.##########", CultureInfo.InvariantCulture),
                TransactionType t => t.ToString(),
                _ => Convert.ToString(cell, CultureInfo.InvariantCulture) ?? string.Empty,
            };
            return text.IndexOfAny([',', '"', '\n', '\r']) >= 0 ? $"\"{text.Replace("\"", "\"\"")}\"" : text;
        }
    }
}

