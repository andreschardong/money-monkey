using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Folio.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class PortfolioCountry : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "country",
                table: "portfolios",
                type: "character varying(2)",
                maxLength: 2,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "country",
                table: "portfolios");
        }
    }
}
