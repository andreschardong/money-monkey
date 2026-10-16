using Folio.Api.Auth;
using Folio.Core;
using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Folio.Api.Data;

/// <summary>
/// Accounts (ASP.NET Core Identity with passkeys), each account's portfolios, and the market data they share.
/// Portfolios are filtered to the signed-in account, so a query can't reach someone else's by accident.
/// </summary>
public sealed class FolioDbContext(DbContextOptions<FolioDbContext> options, ICurrentUser currentUser)
    : IdentityDbContext<AppUser>(options), IDataProtectionKeyContext
{
    public DbSet<Portfolio> Portfolios => Set<Portfolio>();
    public DbSet<EmailLink> EmailLinks => Set<EmailLink>();
    public DbSet<DataProtectionKey> DataProtectionKeys => Set<DataProtectionKey>();

    /// <summary>Read by the portfolio query filter on every query.</summary>
    private string? CurrentUserId => currentUser.Id;
    public DbSet<Security> Securities => Set<Security>();
    public DbSet<Transaction> Transactions => Set<Transaction>();
    public DbSet<CashBalance> CashBalances => Set<CashBalance>();
    public DbSet<PortfolioShare> PortfolioShares => Set<PortfolioShare>();
    public DbSet<PriceBar> PriceBars => Set<PriceBar>();
    public DbSet<FxRate> FxRates => Set<FxRate>();
    public DbSet<CorporateAction> CorporateActions => Set<CorporateAction>();
    public DbSet<DismissedSuggestion> DismissedSuggestions => Set<DismissedSuggestion>();
    public DbSet<RefreshRun> RefreshRuns => Set<RefreshRun>();

    protected override void ConfigureConventions(ModelConfigurationBuilder builder)
    {
        builder.Properties<decimal>().HavePrecision(28, 10);
        builder.Properties<TransactionType>().HaveConversion<string>().HaveMaxLength(20);
        builder.Properties<PriceSource>().HaveConversion<string>().HaveMaxLength(10);
        builder.Properties<AssetType>().HaveConversion<string>().HaveMaxLength(10);
        builder.Properties<CorporateActionKind>().HaveConversion<string>().HaveMaxLength(10);
        builder.Properties<RefreshStatus>().HaveConversion<string>().HaveMaxLength(20);
        builder.Properties<EmailLinkPurpose>().HaveConversion<string>().HaveMaxLength(10);
    }

    protected override void OnModelCreating(ModelBuilder model)
    {
        base.OnModelCreating(model);

        model.Entity<Portfolio>(e =>
        {
            e.Property(p => p.Name).HasMaxLength(100);
            e.Property(p => p.BaseCurrency).HasMaxLength(3);
            e.Property(p => p.Description).HasMaxLength(500);
            e.Property(p => p.Country).HasMaxLength(2);
            e.HasIndex(p => p.OwnerId);
            e.HasOne<AppUser>().WithMany().HasForeignKey(p => p.OwnerId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(p => p.Transactions).WithOne().HasForeignKey(t => t.PortfolioId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(p => p.Shares).WithOne().HasForeignKey(s => s.PortfolioId).OnDelete(DeleteBehavior.Cascade);
            // Mine, plus any shared with me.
            e.HasQueryFilter(p => p.OwnerId == CurrentUserId || p.Shares.Any(s => s.UserId == CurrentUserId));
        });

        model.Entity<PortfolioShare>(e =>
        {
            e.HasKey(s => new { s.PortfolioId, s.UserId });
            e.HasIndex(s => s.UserId);
            e.HasOne<AppUser>().WithMany().HasForeignKey(s => s.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        model.Entity<EmailLink>(e =>
        {
            e.HasIndex(l => l.TokenHash).IsUnique();
            e.Property(l => l.TokenHash).HasMaxLength(64);
            e.HasOne<AppUser>().WithMany().HasForeignKey(l => l.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        model.Entity<Security>(e =>
        {
            // Quoted securities are shared by everyone; manually priced ones are private to the account that made them.
            e.HasIndex(s => s.Symbol).IsUnique().HasFilter("owner_id IS NULL");
            e.HasIndex(s => new { s.OwnerId, s.Symbol }).IsUnique().HasFilter("owner_id IS NOT NULL");
            e.HasOne<AppUser>().WithMany().HasForeignKey(s => s.OwnerId).OnDelete(DeleteBehavior.Restrict);
            // ...except that a portfolio shared with me brings along the manual securities it holds.
            e.HasQueryFilter(s => s.OwnerId == null || s.OwnerId == CurrentUserId ||
                Set<Transaction>().Any(t => t.SecurityId == s.Id &&
                    Set<Portfolio>().Any(p => p.Id == t.PortfolioId && p.Shares.Any(sh => sh.UserId == CurrentUserId))));
            e.Property(s => s.Symbol).HasMaxLength(32);
            e.Property(s => s.Name).HasMaxLength(200);
            e.Property(s => s.Currency).HasMaxLength(3);
            e.Property(s => s.Exchange).HasMaxLength(40);
            e.Property(s => s.LastRefreshError).HasMaxLength(500);
        });

        model.Entity<Transaction>(e =>
        {
            e.HasIndex(t => new { t.PortfolioId, t.Date });
            e.HasIndex(t => t.SecurityId);
            e.Property(t => t.Currency).HasMaxLength(3);
            e.Property(t => t.Note).HasMaxLength(500);
            e.HasOne(t => t.Security).WithMany().HasForeignKey(t => t.SecurityId).OnDelete(DeleteBehavior.Restrict);
        });

        model.Entity<CashBalance>(e =>
        {
            e.HasKey(c => new { c.PortfolioId, c.Currency, c.Date });
            e.Property(c => c.Currency).HasMaxLength(3);
            e.Property(c => c.Note).HasMaxLength(200);
            e.HasOne<Portfolio>().WithMany().HasForeignKey(c => c.PortfolioId).OnDelete(DeleteBehavior.Cascade);
        });

        model.Entity<PriceBar>(e =>
        {
            e.HasKey(p => new { p.SecurityId, p.Date });
            e.HasOne<Security>().WithMany().HasForeignKey(p => p.SecurityId).OnDelete(DeleteBehavior.Cascade);
        });

        model.Entity<FxRate>(e =>
        {
            e.HasKey(f => new { f.Currency, f.Date });
            e.Property(f => f.Currency).HasMaxLength(3);
            e.Property(f => f.Source).HasMaxLength(20);
        });

        model.Entity<CorporateAction>(e =>
        {
            e.HasKey(c => new { c.SecurityId, c.Date, c.Kind });
            e.HasOne<Security>().WithMany().HasForeignKey(c => c.SecurityId).OnDelete(DeleteBehavior.Cascade);
        });

        model.Entity<DismissedSuggestion>(e =>
        {
            e.HasKey(d => new { d.PortfolioId, d.SecurityId, d.Date, d.Kind });
            e.HasOne<Portfolio>().WithMany().HasForeignKey(d => d.PortfolioId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Security>().WithMany().HasForeignKey(d => d.SecurityId).OnDelete(DeleteBehavior.Cascade);
        });

        model.Entity<RefreshRun>(e =>
        {
            e.Property(r => r.Trigger).HasMaxLength(20);
            e.HasIndex(r => r.StartedAt);
        });
    }
}
