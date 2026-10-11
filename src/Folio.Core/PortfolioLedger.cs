namespace Folio.Core;

/// <summary>
/// Replays transactions into holdings and gains. Cost basis is the Canadian adjusted cost base (average cost),
/// tracked both in the security's currency and in the portfolio's base currency at each transaction's own
/// exchange rate. Cash is not derived from trades (see <see cref="CashLedger"/>). Selling more shares than are
/// held is an error.
/// </summary>
public sealed class PortfolioLedger
{
    /// <summary>Quantities closer than this are treated as equal (fractional-share rounding).</summary>
    public const decimal QuantityTolerance = 0.00000001m;

    private readonly Dictionary<Guid, Position> _positions = [];
    private readonly List<RealizedGain> _realized = [];
    private readonly List<ExternalFlow> _flows = [];

    public PortfolioLedger(string baseCurrency)
    {
        if (!Currencies.IsSupported(baseCurrency))
            throw new ArgumentException($"Unsupported currency '{baseCurrency}'.", nameof(baseCurrency));
        BaseCurrency = baseCurrency;
    }

    public string BaseCurrency { get; }

    /// <summary>Every security ever held, including closed positions.</summary>
    public IReadOnlyDictionary<Guid, Position> Positions => _positions;

    public IReadOnlyList<RealizedGain> RealizedGains => _realized;

    /// <summary>Money (and shares, at book value) put in minus money taken out, in the base currency.</summary>
    public IReadOnlyList<ExternalFlow> ExternalFlows => _flows;

    public decimal NetContributions { get; private set; }
    public decimal RealizedGain { get; private set; }
    public decimal Dividends { get; private set; }
    public decimal Interest { get; private set; }

    /// <summary>Trading commissions plus account fees.</summary>
    public decimal Fees { get; private set; }

    public decimal TaxWithheld { get; private set; }
    public DateOnly? FirstDate { get; private set; }
    public DateOnly? LastDate { get; private set; }

    public static PortfolioLedger Replay(string baseCurrency, IEnumerable<LedgerEntry> entries)
    {
        var ledger = new PortfolioLedger(baseCurrency);
        foreach (var entry in LedgerOrder.Sort(entries))
            ledger.Apply(entry);
        return ledger;
    }

    public IEnumerable<Position> OpenPositions => _positions.Values.Where(p => p.Quantity > 0);

    public void Apply(LedgerEntry e)
    {
        if (LastDate is { } last && e.Date < last)
            throw new LedgerException(e.Id, $"Entries must be applied in date order ({e.Date:yyyy-MM-dd} is before {last:yyyy-MM-dd}).");

        ValidateCommon(e);
        switch (e.Type)
        {
            case TransactionType.Buy: ApplyBuy(e, asTransfer: false); break;
            case TransactionType.TransferIn: ApplyBuy(e, asTransfer: true); break;
            case TransactionType.Sell: ApplySell(e); break;
            case TransactionType.Split: ApplySplit(e); break;
            case TransactionType.Deposit: ApplyFlow(e, +1); break;
            case TransactionType.Withdrawal: ApplyFlow(e, -1); break;
            case TransactionType.Dividend: ApplyDividend(e); break;
            case TransactionType.Interest:
                Positive(e, e.Amount, "Amount");
                Interest += e.Amount * e.FxRate;
                break;
            case TransactionType.Fee:
                Positive(e, e.Amount, "Amount");
                Fees += e.Amount * e.FxRate;
                break;
            default:
                throw new LedgerException(e.Id, $"Unknown transaction type '{e.Type}'.");
        }

        FirstDate ??= e.Date;
        LastDate = e.Date;
    }

    private void ValidateCommon(LedgerEntry e)
    {
        if (!Currencies.IsSupported(e.Currency))
            throw new LedgerException(e.Id, $"Unsupported currency '{e.Currency}'.");
        if (e.FxRate <= 0)
            throw new LedgerException(e.Id, "The exchange rate must be greater than zero.");
        if (e.Currency == BaseCurrency && e.FxRate != 1m)
            throw new LedgerException(e.Id, $"The exchange rate must be 1 for a {BaseCurrency} transaction in a {BaseCurrency} portfolio.");
        if (e.Type.RequiresSecurity() && e.SecurityId is null)
            throw new LedgerException(e.Id, $"A {e.Type} needs a security.");
        if (e.Fee < 0)
            throw new LedgerException(e.Id, "Fees cannot be negative.");
    }

    private void ApplyBuy(LedgerEntry e, bool asTransfer)
    {
        Positive(e, e.Quantity, "Quantity");
        if (e.Price < 0)
            throw new LedgerException(e.Id, "The price cannot be negative.");

        var position = GetOrCreatePosition(e);
        var cost = e.Quantity * e.Price + e.Fee;
        if (asTransfer)
        {
            // Shares brought in from elsewhere are money the owner put in, at their book value.
            NetContributions += cost * e.FxRate;
            _flows.Add(new ExternalFlow(e.Date, cost * e.FxRate));
        }
        else
        {
            Fees += e.Fee * e.FxRate;
        }

        if (position.Quantity == 0)
        {
            position.OpenedOn = e.Date;
            position.ClosedOn = null;
        }

        position.Quantity += e.Quantity;
        position.CostLocal += cost;
        position.CostBase += cost * e.FxRate;
    }

    private void ApplySell(LedgerEntry e)
    {
        Positive(e, e.Quantity, "Quantity");
        if (e.Price < 0)
            throw new LedgerException(e.Id, "The price cannot be negative.");

        var position = _positions.GetValueOrDefault(e.SecurityId!.Value);
        var held = position?.Quantity ?? 0m;
        if (position is null || e.Quantity > held + QuantityTolerance)
            throw new LedgerException(e.Id, $"Cannot sell {Format(e.Quantity)} shares on {e.Date:yyyy-MM-dd}: only {Format(held)} held.");
        CheckCurrency(e, position);

        var closesPosition = e.Quantity >= held - QuantityTolerance;
        var costLocal = closesPosition ? position.CostLocal : position.CostLocal * e.Quantity / held;
        var costBase = closesPosition ? position.CostBase : position.CostBase * e.Quantity / held;
        var proceeds = e.Quantity * e.Price - e.Fee;
        var proceedsBase = proceeds * e.FxRate;

        Fees += e.Fee * e.FxRate;

        var gain = new RealizedGain(e.Id, e.Date, position.SecurityId, e.Quantity, e.Currency,
            proceeds, costLocal, proceedsBase, costBase);
        _realized.Add(gain);
        RealizedGain += gain.GainBase;
        position.RealizedLocal += gain.GainLocal;
        position.RealizedBase += gain.GainBase;

        position.Quantity = closesPosition ? 0m : held - e.Quantity;
        position.CostLocal = closesPosition ? 0m : position.CostLocal - costLocal;
        position.CostBase = closesPosition ? 0m : position.CostBase - costBase;
        if (closesPosition)
            position.ClosedOn = e.Date;
    }

    private void ApplySplit(LedgerEntry e)
    {
        Positive(e, e.SplitFrom, "Split ratio");
        Positive(e, e.SplitTo, "Split ratio");
        var position = _positions.GetValueOrDefault(e.SecurityId!.Value);
        if (position is null || position.Quantity <= 0)
            throw new LedgerException(e.Id, $"No shares are held on {e.Date:yyyy-MM-dd}, so there is nothing to split.");

        position.Quantity = decimal.Round(position.Quantity * e.SplitTo / e.SplitFrom, 8);
        position.AddSplit(new SplitEvent(e.Date, e.SplitFrom, e.SplitTo));
    }

    private void ApplyFlow(LedgerEntry e, int sign)
    {
        Positive(e, e.Amount, "Amount");
        var amountBase = sign * e.Amount * e.FxRate;
        NetContributions += amountBase;
        _flows.Add(new ExternalFlow(e.Date, amountBase));
    }

    private void ApplyDividend(LedgerEntry e)
    {
        Positive(e, e.Amount, "Amount");
        if (e.Fee > e.Amount)
            throw new LedgerException(e.Id, "The tax withheld cannot exceed the dividend.");

        var net = e.Amount - e.Fee;
        Dividends += net * e.FxRate;
        TaxWithheld += e.Fee * e.FxRate;

        // A dividend can arrive after the position was sold, so it never requires shares on the date.
        if (!_positions.TryGetValue(e.SecurityId!.Value, out var position))
        {
            position = new Position(e.SecurityId.Value, e.Currency);
            _positions.Add(position.SecurityId, position);
        }

        position.DividendsBase += net * e.FxRate;
    }

    private Position GetOrCreatePosition(LedgerEntry e)
    {
        if (_positions.TryGetValue(e.SecurityId!.Value, out var position))
        {
            CheckCurrency(e, position);
            return position;
        }

        position = new Position(e.SecurityId.Value, e.Currency);
        _positions.Add(position.SecurityId, position);
        return position;
    }

    private static void CheckCurrency(LedgerEntry e, Position position)
    {
        // Dividend-only placeholders take their currency from the payment, which may differ from the trading currency.
        if (position.Quantity == 0 && position.CostLocal == 0 && position.RealizedLocal == 0)
        {
            position.Currency = e.Currency;
            return;
        }

        if (position.Currency != e.Currency)
            throw new LedgerException(e.Id, $"This security trades in {position.Currency}, not {e.Currency}.");
    }

    private static void Positive(LedgerEntry e, decimal value, string what)
    {
        if (value <= 0)
            throw new LedgerException(e.Id, $"{what} must be greater than zero.");
    }

    private static string Format(decimal quantity) => quantity.ToString("0.########", System.Globalization.CultureInfo.InvariantCulture);
}

public sealed class Position(Guid securityId, string currency)
{
    private readonly List<SplitEvent> _splits = [];

    public Guid SecurityId { get; } = securityId;

    /// <summary>The security's trading currency; costs in <see cref="CostLocal"/> are in this currency.</summary>
    public string Currency { get; internal set; } = currency;

    public decimal Quantity { get; internal set; }

    /// <summary>Adjusted cost base in the security's currency, commissions included.</summary>
    public decimal CostLocal { get; internal set; }

    /// <summary>Adjusted cost base in the portfolio's base currency, at each purchase's exchange rate.</summary>
    public decimal CostBase { get; internal set; }

    public decimal RealizedLocal { get; internal set; }
    public decimal RealizedBase { get; internal set; }
    public decimal DividendsBase { get; internal set; }
    public DateOnly? OpenedOn { get; internal set; }
    public DateOnly? ClosedOn { get; internal set; }
    public IReadOnlyList<SplitEvent> Splits => _splits;

    public decimal AverageCostLocal => Quantity == 0 ? 0m : CostLocal / Quantity;
    public decimal AverageCostBase => Quantity == 0 ? 0m : CostBase / Quantity;

    internal void AddSplit(SplitEvent split) => _splits.Add(split);
}

public readonly record struct SplitEvent(DateOnly Date, decimal From, decimal To)
{
    public decimal Factor => To / From;
}

public sealed record RealizedGain(
    Guid EntryId,
    DateOnly Date,
    Guid SecurityId,
    decimal Quantity,
    string Currency,
    decimal ProceedsLocal,
    decimal CostLocal,
    decimal ProceedsBase,
    decimal CostBase)
{
    public decimal GainLocal => ProceedsLocal - CostLocal;
    public decimal GainBase => ProceedsBase - CostBase;
}

/// <summary>Money entering (positive) or leaving (negative) the portfolio, in the base currency.</summary>
public readonly record struct ExternalFlow(DateOnly Date, decimal Amount);
