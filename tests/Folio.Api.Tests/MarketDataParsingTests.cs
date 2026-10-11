using Folio.Api.Data;
using Folio.Api.MarketData;
using static Folio.Api.MarketData.YahooFinanceClient;

namespace Folio.Api.Tests;

public class MarketDataParsingTests
{
    private static readonly DateOnly From = new(2024, 1, 1);
    private static readonly DateOnly To = new(2026, 12, 31);

    // NVIDIA around its 10-for-1 split: Yahoo reports 120.888 for 2024-06-07, a day it actually closed at 1,208.88.
    private static ChartResult NvidiaAroundTheSplit() => new()
    {
        Meta = new ChartMeta { Currency = "USD", Symbol = "NVDA", ExchangeName = "NMS", InstrumentType = "EQUITY", LongName = "NVIDIA Corporation", Gmtoffset = -14400 },
        Timestamp = [1717767000, 1718026200],
        Indicators = new ChartIndicators { Quote = [new QuoteIndicator { Close = [120.88800048828125, 121.79000091552734] }] },
        Events = new ChartEvents
        {
            Splits = new() { ["1718026200"] = new YahooSplit { Date = 1718026200, Numerator = 10, Denominator = 1 } },
            Dividends = new() { ["1717767000"] = new YahooDividend { Date = 1717767000, Amount = 0.004 } },
        },
    };

    [Fact]
    public void Closes_before_a_split_are_restated_to_the_price_actually_traded()
    {
        var history = Parse("NVDA", NvidiaAroundTheSplit(), From, To);

        Assert.Equal([new DateOnly(2024, 6, 7), new DateOnly(2024, 6, 10)], history.Bars.Select(b => b.Date));
        Assert.Equal(1_208.88m, history.Bars[0].Close);
        Assert.Equal(121.79m, history.Bars[1].Close);

        var split = Assert.Single(history.Splits);
        Assert.Equal((new DateOnly(2024, 6, 10), 10m, 1m), (split.Date, split.Numerator, split.Denominator));
        Assert.Equal(0.04m, Assert.Single(history.Dividends).Amount);
    }

    [Fact]
    public void Metadata_maps_to_friendly_names()
    {
        var info = Parse("nvda", NvidiaAroundTheSplit(), From, To).Info;

        Assert.Equal("NVDA", info.Symbol);
        Assert.Equal("NVIDIA Corporation", info.Name);
        Assert.Equal("NASDAQ", info.Exchange);
        Assert.Equal(AssetType.Stock, info.AssetType);
    }

    [Fact]
    public void London_prices_in_pence_become_pounds()
    {
        var result = new ChartResult
        {
            Meta = new ChartMeta { Currency = "GBp", Symbol = "VOD.L", ExchangeName = "LSE", InstrumentType = "EQUITY", Gmtoffset = 3600 },
            Timestamp = [1791532800],
            Indicators = new ChartIndicators { Quote = [new QuoteIndicator { Close = [118.3499984741211] }] },
        };

        var history = Parse("VOD.L", result, From, To);

        Assert.Equal("GBP", history.Info.Currency);
        Assert.Equal(1.1835m, Assert.Single(history.Bars).Close);
    }

    [Fact]
    public void Missing_closes_are_skipped_and_the_live_quote_fills_today()
    {
        var result = new ChartResult
        {
            Meta = new ChartMeta
            {
                Currency = "CAD", Symbol = "SHOP.TO", ExchangeName = "TOR", InstrumentType = "EQUITY", Gmtoffset = -14400,
                RegularMarketPrice = 243.83, RegularMarketTime = 1791576000,
            },
            Timestamp = [1791466200, 1791552600],
            Indicators = new ChartIndicators { Quote = [new QuoteIndicator { Close = [234.19000244140625, null] }] },
        };

        var history = Parse("SHOP.TO", result, From, To);

        Assert.Equal([234.19m, 243.83m], history.Bars.Select(b => b.Close));
        Assert.Equal("TSX", history.Info.Exchange);
    }

    [Theory]
    [InlineData(243.8300018310547, "243.83")]
    [InlineData(120.88800048828125, "120.888")]
    [InlineData(0.012345678, "0.01234568")]
    [InlineData(45000.12, "45000.12")]
    public void Prices_are_rounded_to_seven_significant_digits(double raw, string expected)
    {
        Assert.Equal(decimal.Parse(expected, System.Globalization.CultureInfo.InvariantCulture), RoundPrice(raw));
    }

    [Theory]
    [InlineData("SHOP.TO", "SHOP.TRT")]
    [InlineData("AII.V", "AII.TRV")]
    [InlineData("VOD.L", "VOD.LON")]
    [InlineData("SAP.DE", "SAP.DEX")]
    [InlineData("AAPL", "AAPL")]
    [InlineData("AIR.PA", null)]
    public void Yahoo_symbols_map_to_alpha_vantage(string yahoo, string? expected)
    {
        Assert.Equal(expected, AlphaVantageClient.ToAlphaVantageSymbol(yahoo));
    }
}
