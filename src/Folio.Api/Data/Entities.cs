using Folio.Core;

namespace Folio.Api.Data;

/// <summary>What kind of account a portfolio is; the overview can leave real estate out of the picture.</summary>
public enum PortfolioKind
{
    Investment,

    /// <summary>A property, valued through a manually priced holding.</summary>
    RealEstate,
}

public sealed class Portfolio
{
    public Guid Id { get; set; }

    /// <summary>The account that owns the portfolio; null only for portfolios created before sign-in existed.</summary>
    public string? OwnerId { get; set; }

    public required string Name { get; set; }

    /// <summary>The currency totals are reported in: CAD, USD or EUR.</summary>
    public required string BaseCurrency { get; set; }

    public string? Description { get; set; }

    /// <summary>Where the account is held, as an ISO 3166-1 alpha-2 code (CA, US, BR); the overview sums by it.</summary>
    public string? Country { get; set; }

    /// <summary>Investment account (the default) or real estate.</summary>
    public PortfolioKind Kind { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public List<Transaction> Transactions { get; set; } = [];
    public List<PortfolioShare> Shares { get; set; } = [];
}

/// <summary>Access another account has to a portfolio: to look, or to record transactions and cash too.</summary>
public sealed class PortfolioShare
{
    public Guid PortfolioId { get; set; }
    public required string UserId { get; set; }
    public bool CanEdit { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public enum PriceSource
{
    Yahoo,
    Manual,

    /// <summary>Only ever on a <see cref="PriceBar"/>: a close filled in by the fallback provider.</summary>
    AlphaVantage,
}

public enum AssetType
{
    Stock,
    Etf,
    Fund,
    Crypto,
    Other,

    /// <summary>A property added to a real-estate portfolio: one unit, valued by hand.</summary>
    RealEstate,
}

public sealed class Security
{
    public Guid Id { get; set; }

    /// <summary>Null for quoted securities, which everyone shares; the account that created a manually priced one.</summary>
    public string? OwnerId { get; set; }

    /// <summary>Yahoo Finance symbol (e.g. SHOP.TO, AAPL, SAP.DE), or a name of the user's choosing for manual prices.</summary>
    public required string Symbol { get; set; }

    public required string Name { get; set; }
    public required string Currency { get; set; }
    public string? Exchange { get; set; }
    public AssetType AssetType { get; set; }
    public PriceSource PriceSource { get; set; }

    /// <summary>Daily prices are stored from this date onwards.</summary>
    public DateOnly? HistoryStart { get; set; }

    public DateTimeOffset? LastRefreshAt { get; set; }
    public string? LastRefreshError { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class Transaction
{
    public Guid Id { get; set; }
    public Guid PortfolioId { get; set; }
    public TransactionType Type { get; set; }
    public DateOnly Date { get; set; }
    public long Sequence { get; set; }
    public Guid? SecurityId { get; set; }
    public Security? Security { get; set; }
    public required string Currency { get; set; }
    public decimal Quantity { get; set; }
    public decimal Price { get; set; }
    public decimal Amount { get; set; }
    public decimal Fee { get; set; }
    public decimal FxRate { get; set; } = 1m;
    public decimal SplitFrom { get; set; }
    public decimal SplitTo { get; set; }
    public string? Note { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public LedgerEntry ToLedgerEntry() => new()
    {
        Id = Id,
        Type = Type,
        Date = Date,
        Sequence = Sequence,
        SecurityId = SecurityId,
        Currency = Currency,
        Quantity = Quantity,
        Price = Price,
        Amount = Amount,
        Fee = Fee,
        FxRate = FxRate,
        SplitFrom = SplitFrom,
        SplitTo = SplitTo,
    };
}

/// <summary>A cash balance as entered for a portfolio: what the account held in a currency on a date.</summary>
public sealed class CashBalance
{
    public Guid PortfolioId { get; set; }
    public required string Currency { get; set; }
    public DateOnly Date { get; set; }
    public decimal Balance { get; set; }
    public string? Note { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>A daily close as actually traded, i.e. not adjusted for later splits.</summary>
public sealed class PriceBar
{
    public Guid SecurityId { get; set; }
    public DateOnly Date { get; set; }
    public decimal Close { get; set; }
    public PriceSource Source { get; set; }
}

public sealed class FxRate
{
    public required string Currency { get; set; }
    public DateOnly Date { get; set; }

    /// <summary>Canadian dollars per one unit of <see cref="Currency"/>.</summary>
    public decimal CadPerUnit { get; set; }

    public required string Source { get; set; }
}

public enum CorporateActionKind
{
    Split,
    Dividend,
}

/// <summary>Splits and dividends reported by the quote provider, used to suggest transactions.</summary>
public sealed class CorporateAction
{
    public Guid SecurityId { get; set; }
    public DateOnly Date { get; set; }
    public CorporateActionKind Kind { get; set; }

    /// <summary>For splits: <see cref="Denominator"/> old shares become <see cref="Numerator"/> new ones.</summary>
    public decimal Numerator { get; set; }

    public decimal Denominator { get; set; }

    /// <summary>For dividends: the amount per share, in the security's currency.</summary>
    public decimal Amount { get; set; }
}

public sealed class DismissedSuggestion
{
    public Guid PortfolioId { get; set; }
    public Guid SecurityId { get; set; }
    public DateOnly Date { get; set; }
    public CorporateActionKind Kind { get; set; }
    public DateTimeOffset DismissedAt { get; set; }
}

public enum RefreshStatus
{
    Running,
    Succeeded,
    PartiallySucceeded,
    Failed,
}

public sealed class RefreshRun
{
    public long Id { get; set; }
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset? FinishedAt { get; set; }
    public required string Trigger { get; set; }
    public RefreshStatus Status { get; set; }
    public int SecuritiesUpdated { get; set; }
    public int SecuritiesFailed { get; set; }
    public int FxRatesStored { get; set; }
    public string? Log { get; set; }
}
