using Folio.Api.Data;

namespace Folio.Api.MarketData;

/// <summary>Friendly names for Yahoo Finance exchange codes and instrument types.</summary>
public static class Exchanges
{
    private static readonly Dictionary<string, string> Names = new(StringComparer.OrdinalIgnoreCase)
    {
        ["TOR"] = "TSX",
        ["VAN"] = "TSXV",
        ["NEO"] = "Cboe Canada",
        ["CNQ"] = "CSE",
        ["NMS"] = "NASDAQ",
        ["NGM"] = "NASDAQ",
        ["NCM"] = "NASDAQ",
        ["NAS"] = "NASDAQ",
        ["NYQ"] = "NYSE",
        ["NYS"] = "NYSE",
        ["ASE"] = "NYSE American",
        ["PCX"] = "NYSE Arca",
        ["BTS"] = "Cboe US",
        ["PNK"] = "OTC",
        ["OQB"] = "OTC",
        ["OQX"] = "OTC",
        ["GER"] = "XETRA",
        ["FRA"] = "Frankfurt",
        ["PAR"] = "Euronext Paris",
        ["AMS"] = "Euronext Amsterdam",
        ["BRU"] = "Euronext Brussels",
        ["LIS"] = "Euronext Lisbon",
        ["ISE"] = "Euronext Dublin",
        ["MIL"] = "Borsa Italiana",
        ["MCE"] = "BME Madrid",
        ["LSE"] = "LSE",
        ["IOB"] = "LSE IOB",
        ["EBS"] = "SIX Swiss",
        ["STO"] = "Stockholm",
        ["CPH"] = "Copenhagen",
        ["HEL"] = "Helsinki",
        ["OSL"] = "Oslo",
        ["VIE"] = "Vienna",
        ["ASX"] = "ASX",
        ["HKG"] = "HKEX",
        ["JPX"] = "Tokyo",
        ["CCC"] = "Crypto",
    };

    public static string? Name(string? code, string? fallback = null) =>
        code is not null && Names.TryGetValue(code, out var name) ? name : fallback ?? code;

    public static AssetType AssetTypeOf(string? yahooType) => yahooType?.ToUpperInvariant() switch
    {
        "EQUITY" => AssetType.Stock,
        "ETF" => AssetType.Etf,
        "MUTUALFUND" => AssetType.Fund,
        "CRYPTOCURRENCY" => AssetType.Crypto,
        _ => AssetType.Other,
    };

    public static bool IsHoldable(string? yahooType) =>
        yahooType?.ToUpperInvariant() is "EQUITY" or "ETF" or "MUTUALFUND" or "CRYPTOCURRENCY";
}
