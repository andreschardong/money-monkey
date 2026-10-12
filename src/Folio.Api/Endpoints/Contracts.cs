using Folio.Api.Data;
using Folio.Core;

namespace Folio.Api.Endpoints;

public sealed record CreatePortfolioRequest(string Name, string BaseCurrency, string? Description);

public sealed record UpdatePortfolioRequest(string Name, string BaseCurrency, string? Description);

public sealed record PortfolioSummaryDto(
    Guid Id,
    string Name,
    string BaseCurrency,
    string? Description,
    decimal TotalValue,
    decimal HoldingsValue,
    decimal CashValue,
    decimal DayChange,
    decimal? DayChangePercent,
    decimal? TotalReturn,
    decimal? TotalReturnPercent,
    double? AnnualizedReturn,
    decimal NetContributions,
    int HoldingsCount,
    int TransactionsCount,
    DateOnly? PricesAsOf,
    DateOnly? FirstTransactionDate,
    string Access,
    string? OwnerEmail,
    int SharedWith,
    DateOnly? DayChangeDate);

public sealed record PortfolioDetailDto(
    PortfolioSummaryDto Summary,
    decimal CostBasis,
    decimal UnrealizedGain,
    decimal? UnrealizedGainPercent,
    decimal RealizedGain,
    decimal Dividends,
    decimal Interest,
    decimal Fees,
    decimal TaxWithheld,
    IReadOnlyList<HoldingDto> Holdings,
    IReadOnlyList<CashBalanceDto> Cash,
    IReadOnlyList<string> Warnings);

public sealed record HoldingDto(
    Guid SecurityId,
    string Symbol,
    string Name,
    string? Exchange,
    AssetType AssetType,
    string Currency,
    decimal Quantity,
    decimal AverageCost,
    decimal CostBasis,
    decimal? Price,
    DateOnly? PriceDate,
    decimal? PreviousClose,
    decimal? DayChangePercent,
    decimal MarketValue,
    decimal MarketValueLocal,
    decimal DayChange,
    decimal UnrealizedGain,
    decimal? UnrealizedGainPercent,
    decimal RealizedGain,
    decimal Dividends,
    decimal Weight,
    decimal FxRate,
    bool PriceMissing);

public sealed record CashBalanceDto(string Currency, decimal Balance, DateOnly AsOf, decimal FxRate, decimal Value);

/// <summary>One entered cash balance, as kept for history.</summary>
public sealed record CashEntryDto(string Currency, DateOnly Date, decimal Balance, string? Note);

public sealed record SetCashRequest(string Currency, decimal Balance, DateOnly? Date, string? Note);

public sealed record TransactionDto(
    Guid Id,
    TransactionType Type,
    DateOnly Date,
    Guid? SecurityId,
    string? Symbol,
    string? SecurityName,
    string Currency,
    decimal Quantity,
    decimal Price,
    decimal Amount,
    decimal Fee,
    decimal FxRate,
    decimal SplitFrom,
    decimal SplitTo,
    string? Note,
    decimal Total,
    DateTimeOffset CreatedAt);

/// <summary>
/// A transaction to record. Securities are given by <see cref="SecurityId"/> or by a quote <see cref="Symbol"/>;
/// <see cref="FxRate"/> is looked up for the trade date when omitted.
/// </summary>
public sealed record TransactionRequest(
    TransactionType Type,
    DateOnly Date,
    Guid? SecurityId = null,
    string? Symbol = null,
    string? Currency = null,
    decimal? Quantity = null,
    decimal? Price = null,
    decimal? Amount = null,
    decimal? Fee = null,
    decimal? FxRate = null,
    decimal? SplitFrom = null,
    decimal? SplitTo = null,
    string? Note = null);

public sealed record HistoryPointDto(DateOnly Date, decimal Value, decimal NetContributions);

public sealed record HistoryDto(string Currency, string Range, IReadOnlyList<HistoryPointDto> Points);

public sealed record RealizedGainDto(
    Guid TransactionId,
    DateOnly Date,
    Guid SecurityId,
    string Symbol,
    string Name,
    decimal Quantity,
    string Currency,
    decimal ProceedsLocal,
    decimal CostLocal,
    decimal GainLocal,
    decimal Proceeds,
    decimal CostBasis,
    decimal Gain);

public sealed record IncomeYearDto(int Year, decimal Proceeds, decimal CostBasis, decimal Gain, decimal Dividends, decimal Interest, decimal TaxWithheld);

public sealed record RealizedReportDto(string Currency, IReadOnlyList<IncomeYearDto> Years, IReadOnlyList<RealizedGainDto> Sales);

public sealed record HoldingDetailDto(
    string BaseCurrency,
    SecurityDto Security,
    HoldingDto? Holding,
    decimal RealizedGain,
    decimal Dividends,
    IReadOnlyList<TransactionDto> Transactions);

public sealed record SuggestionDto(
    CorporateActionKind Kind,
    Guid SecurityId,
    string Symbol,
    string Name,
    DateOnly Date,
    string Currency,
    decimal? SplitFrom,
    decimal? SplitTo,
    decimal? PerShare,
    decimal? Quantity,
    decimal? Amount);

public sealed record DismissSuggestionRequest(Guid SecurityId, DateOnly Date, CorporateActionKind Kind);

public sealed record SecurityDto(
    Guid Id,
    string Symbol,
    string Name,
    string Currency,
    string? Exchange,
    AssetType AssetType,
    PriceSource PriceSource,
    decimal? LastPrice,
    DateOnly? LastPriceDate,
    decimal? PreviousClose,
    decimal? DayChangePercent,
    DateTimeOffset? LastRefreshAt,
    string? LastRefreshError,
    bool InUse);

public sealed record SymbolMatchDto(string Symbol, string Name, string? Exchange, AssetType AssetType, Guid? SecurityId);

public sealed record ResolveSecurityRequest(string Symbol, DateOnly? HistoryFrom);

public sealed record ManualSecurityRequest(string Symbol, string Name, string Currency, AssetType AssetType, decimal? Price, DateOnly? Date);

public sealed record ManualPriceRequest(DateOnly Date, decimal Close);

public sealed record PricePointDto(DateOnly Date, decimal Close);

public sealed record ExportTransactionDto(
    DateOnly Date,
    TransactionType Type,
    string? Symbol,
    string? SecurityName,
    string? PriceSource,
    string Currency,
    decimal Quantity,
    decimal Price,
    decimal Amount,
    decimal Fee,
    decimal FxRate,
    decimal SplitFrom,
    decimal SplitTo,
    string? Note);

public sealed record ExportPortfolioDto(
    Guid Id,
    string Name,
    string BaseCurrency,
    string? Description,
    DateTimeOffset CreatedAt,
    IReadOnlyList<ExportTransactionDto> Transactions,
    IReadOnlyList<CashEntryDto> CashBalances);

/// <summary>Everything the account entered; what a restore or another tool would need.</summary>
public sealed record ExportDto(DateTimeOffset ExportedAt, IReadOnlyList<ExportPortfolioDto> Portfolios);

public sealed record ImportResultDto(int Portfolios, int Transactions, int CashBalances, IReadOnlyList<string> Warnings);

public sealed record ShareDto(string Email, bool CanEdit, DateTimeOffset CreatedAt);

public sealed record ShareRequest(string Email, bool CanEdit);

/// <summary>A split (<see cref="Denominator"/> old shares became <see cref="Numerator"/>) or a dividend per share.</summary>
public sealed record CorporateActionDto(DateOnly Date, CorporateActionKind Kind, decimal Numerator, decimal Denominator, decimal Amount);

public sealed record PriceOnDto(Guid SecurityId, DateOnly RequestedDate, DateOnly? Date, decimal? Close);

public sealed record FxRateDto(string From, string To, decimal Rate);

public sealed record FxRatesDto(DateOnly Date, DateOnly? RatesDate, IReadOnlyList<FxRateDto> Rates);

public sealed record RefreshRunDto(
    long Id,
    DateTimeOffset StartedAt,
    DateTimeOffset? FinishedAt,
    string Trigger,
    RefreshStatus Status,
    int SecuritiesUpdated,
    int SecuritiesFailed,
    int FxRatesStored,
    string? Log);

public sealed record MarketStatusDto(
    bool Running,
    RefreshRunDto? LastRun,
    DateTimeOffset NextScheduledRun,
    bool SchedulerEnabled,
    DateOnly? FxAsOf,
    DateOnly? PricesAsOf,
    int SecuritiesTracked,
    int SecuritiesWithErrors,
    bool FallbackConfigured,
    DateOnly Today);

public sealed record OverviewPortfolioDto(
    Guid Id,
    string Name,
    string BaseCurrency,
    decimal Value,
    decimal ValueInDisplay,
    decimal DayChangeInDisplay,
    decimal? DayChangePercent,
    decimal? TotalReturnInDisplay,
    decimal? TotalReturnPercent,
    int HoldingsCount,
    string Access,
    string? OwnerEmail);

public sealed record AllocationDto(string Key, string Label, decimal Value, decimal Weight);

public sealed record MoverDto(Guid SecurityId, string Symbol, string Name, string Currency, decimal Price, decimal DayChangePercent);

public sealed record OverviewDto(
    string Currency,
    decimal TotalValue,
    decimal DayChange,
    decimal? DayChangePercent,
    decimal? TotalReturn,
    decimal? TotalReturnPercent,
    decimal NetContributions,
    decimal CashValue,
    DateOnly? PricesAsOf,
    IReadOnlyList<OverviewPortfolioDto> Portfolios,
    IReadOnlyList<AllocationDto> ByCurrency,
    IReadOnlyList<AllocationDto> ByAssetType,
    IReadOnlyList<MoverDto> Movers,
    IReadOnlyList<string> Warnings,
    DateOnly? DayChangeDate);

/// <summary>One portfolio's share of a consolidated holding (shares) or cash balance (amount).</summary>
public sealed record AssetSliceDto(Guid PortfolioId, string PortfolioName, decimal Quantity, decimal Value);

public sealed record AssetHoldingDto(
    Guid SecurityId,
    string Symbol,
    string Name,
    string? Exchange,
    AssetType AssetType,
    string Currency,
    decimal Quantity,
    decimal AverageCost,
    decimal CostBasis,
    decimal? Price,
    DateOnly? PriceDate,
    decimal? DayChangePercent,
    decimal MarketValue,
    decimal MarketValueLocal,
    decimal DayChange,
    decimal UnrealizedGain,
    decimal? UnrealizedGainPercent,
    decimal Weight,
    bool PriceMissing,
    IReadOnlyList<AssetSliceDto> Portfolios);

public sealed record AssetCashDto(string Currency, decimal Balance, decimal Value, decimal Weight, IReadOnlyList<AssetSliceDto> Portfolios);

/// <summary>Everything held across all portfolios, consolidated per security and per cash currency.</summary>
public sealed record AssetsDto(
    string Currency,
    int PortfolioCount,
    decimal TotalValue,
    decimal HoldingsValue,
    decimal CashValue,
    decimal DayChange,
    decimal? DayChangePercent,
    decimal CostBasis,
    decimal UnrealizedGain,
    decimal? UnrealizedGainPercent,
    DateOnly? PricesAsOf,
    IReadOnlyList<AssetHoldingDto> Holdings,
    IReadOnlyList<AssetCashDto> Cash,
    IReadOnlyList<string> Warnings,
    DateOnly? DayChangeDate);
