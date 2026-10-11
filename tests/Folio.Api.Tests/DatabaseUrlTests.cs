using Folio.Api.Data;

namespace Folio.Api.Tests;

public class DatabaseUrlTests
{
    [Fact]
    public void A_postgres_url_becomes_an_npgsql_connection_string()
    {
        var result = DatabaseUrl.ToConnectionString("postgresql://folio:p%40ss%3Bword@db.example.com:5433/folio?sslmode=require");
        Assert.Equal("Host=db.example.com;Port=5433;Database=folio;Username=folio;Password='p@ss;word';SSL Mode=VerifyFull", result);
    }

    [Fact]
    public void A_railway_style_url_without_options_works()
    {
        var result = DatabaseUrl.ToConnectionString("postgres://postgres:secret@postgres.railway.internal:5432/railway");
        Assert.Equal("Host=postgres.railway.internal;Port=5432;Database=railway;Username=postgres;Password=secret", result);
    }

    [Fact]
    public void A_neon_url_keeps_the_options_npgsql_knows_and_drops_the_rest()
    {
        var result = DatabaseUrl.ToConnectionString(
            "postgresql://neondb_owner:npg_abc123@ep-cool-sky-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require&unknown_thing=1");
        Assert.Equal("Host=ep-cool-sky-123456-pooler.us-east-2.aws.neon.tech;Database=neondb;Username=neondb_owner;Password=npg_abc123;SSL Mode=VerifyFull;Channel Binding=Require", result);
        _ = new Npgsql.NpgsqlConnectionStringBuilder(result);   // every keyword is one Npgsql accepts
    }

    [Theory]
    [InlineData("verify-ca", "VerifyCA")]
    [InlineData("verify-full", "VerifyFull")]
    [InlineData("prefer", "Prefer")]
    [InlineData("disable", "Disable")]
    public void Every_libpq_ssl_mode_has_an_npgsql_spelling(string libpq, string npgsql)
    {
        var result = DatabaseUrl.ToConnectionString($"postgresql://u:p@h/d?sslmode={libpq}");
        Assert.EndsWith($"SSL Mode={npgsql}", result);
        _ = new Npgsql.NpgsqlConnectionStringBuilder(result);
    }

    [Fact]
    public void A_key_value_string_passes_through_untouched()
    {
        const string plain = "Host=localhost;Port=5434;Database=folio;Username=folio;Password=folio";
        Assert.Equal(plain, DatabaseUrl.ToConnectionString($"  {plain} "));
    }
}
