using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Folio.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class HideGains : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "hide_gains",
                table: "AspNetUsers",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "hide_gains",
                table: "AspNetUsers");
        }
    }
}
