using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Folio.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class PortfolioKind : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "kind",
                table: "portfolios",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "Investment");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "kind",
                table: "portfolios");
        }
    }
}
