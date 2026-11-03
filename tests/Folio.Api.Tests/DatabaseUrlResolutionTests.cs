using Folio.Api.Data;
using Microsoft.Extensions.Configuration;

namespace Folio.Api.Tests;

public class DatabaseUrlResolutionTests
{
    private static IConfiguration Config(string? databaseUrl = null, string? connectionString = null) =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["DATABASE_URL"] = databaseUrl,
            ["ConnectionStrings:Folio"] = connectionString,
        }).Build();

    [Fact]
    public void WhenBothAreSet_ShouldPreferTheDatabaseUrl()
    {
        var result = DatabaseUrl.Resolve(Config("postgres://u:p@cloud/db", "Host=local;Database=folio"));

        result.ShouldBe("Host=cloud;Database=db;Username=u;Password=p");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void WhenDatabaseUrlIsEmpty_ShouldUseTheConnectionString(string? databaseUrl) =>
        DatabaseUrl.Resolve(Config(databaseUrl, "Host=local;Database=folio")).ShouldBe("Host=local;Database=folio");

    [Fact]
    public void WhenNeitherIsSet_ShouldExplainWhatToConfigure()
    {
        var ex = Should.Throw<InvalidOperationException>(() => DatabaseUrl.Resolve(Config()));

        ex.Message.ShouldBe("Set ConnectionStrings:Folio (or DATABASE_URL) to the PostgreSQL connection.");
    }

    [Fact]
    public void WhenUrlHasNoPortDatabaseOrUser_ShouldKeepOnlyTheHost() =>
        DatabaseUrl.ToConnectionString("postgresql://db.example.com").ShouldBe("Host=db.example.com");

    [Fact]
    public void WhenUrlHasAUserWithoutAPassword_ShouldOmitThePassword() =>
        DatabaseUrl.ToConnectionString("postgresql://folio@db.example.com/folio").ShouldBe("Host=db.example.com;Database=folio;Username=folio");

    [Fact]
    public void WhenUrlHasOnlyAPassword_ShouldOmitTheUser() =>
        DatabaseUrl.ToConnectionString("postgresql://:secret@db.example.com/folio").ShouldBe("Host=db.example.com;Database=folio;Password=secret");

    [Fact]
    public void WhenUrlHasAllTheKnownOptions_ShouldTranslateEach() =>
        DatabaseUrl.ToConnectionString(
                "postgresql://u:p@h/d?sslmode=allow&channel_binding=PREFER&application_name=money&connect_timeout=15&options=-c%20search_path%3Dapp")
            .ShouldBe("Host=h;Database=d;Username=u;Password=p;SSL Mode=Allow;Channel Binding=Prefer;Application Name=money;Timeout=15;Options='-c search_path=app'");

    [Fact]
    public void WhenOptionsAreEmptyOrHaveNoName_ShouldSkipThem() =>
        DatabaseUrl.ToConnectionString("postgresql://u:p@h/d?sslmode=&justaflag&=value&application_name=x")
            .ShouldBe("Host=h;Database=d;Username=u;Password=p;Application Name=x");

    [Theory]
    [InlineData("require", "VerifyFull")]
    [InlineData("allow", "Allow")]
    [InlineData("something-new", "VerifyFull")]
    public void WhenSslModeIsOddOrLenient_ShouldKeepTheStrictSpelling(string libpq, string npgsql) =>
        DatabaseUrl.ToConnectionString($"postgresql://u:p@h/d?sslmode={libpq}").ShouldEndWith($"SSL Mode={npgsql}");

    [Fact]
    public void WhenPasswordHasQuotesAndSemicolons_ShouldQuoteAndDoubleTheQuotes() =>
        DatabaseUrl.ToConnectionString("postgresql://u:it%27s%3Bme@h/d").ShouldEndWith("Password='it''s;me'");
}
