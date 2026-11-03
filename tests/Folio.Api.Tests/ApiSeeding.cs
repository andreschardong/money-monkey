using Folio.Api.Data;

namespace Folio.Api.Tests;

/// <summary>Rows written straight to the database, for states the API cannot produce on its own.</summary>
public static class ApiSeeding
{
    /// <summary>A shared, manually priced security with its own unique symbol, so no other test sees it in a refresh.</summary>
    public static async Task<Security> SeedSecurityAsync(
        this FolioApiFactory factory, string currency = "CAD", PriceSource source = PriceSource.Manual, string? ownerId = null, string? symbol = null, AssetType assetType = AssetType.Stock)
    {
        var security = new Security
        {
            Id = Guid.CreateVersion7(),
            Symbol = symbol ?? $"T{Guid.NewGuid():N}"[..12].ToUpperInvariant(),
            Name = "Seeded security",
            Currency = currency,
            AssetType = assetType,
            PriceSource = source,
            OwnerId = ownerId,
            HistoryStart = new DateOnly(2000, 1, 1),
            CreatedAt = factory.Time.GetUtcNow(),
        };
        await factory.WithDbAsync(async db =>
        {
            db.Securities.Add(security);
            await db.SaveChangesAsync(TestContext.Current.CancellationToken);
        });
        return security;
    }

    public static Task SeedActionAsync(
        this FolioApiFactory factory, Guid securityId, DateOnly date, CorporateActionKind kind, decimal numerator = 0, decimal denominator = 0, decimal amount = 0) =>
        factory.WithDbAsync(async db =>
        {
            db.CorporateActions.Add(new CorporateAction
            {
                SecurityId = securityId, Date = date, Kind = kind, Numerator = numerator, Denominator = denominator, Amount = amount,
            });
            await db.SaveChangesAsync(TestContext.Current.CancellationToken);
        });

    public static Task SeedPricesAsync(this FolioApiFactory factory, Guid securityId, params (DateOnly Date, decimal Close)[] bars) =>
        factory.WithDbAsync(async db =>
        {
            foreach (var (date, close) in bars)
                db.PriceBars.Add(new PriceBar { SecurityId = securityId, Date = date, Close = close, Source = PriceSource.Manual });
            await db.SaveChangesAsync(TestContext.Current.CancellationToken);
        });
}
