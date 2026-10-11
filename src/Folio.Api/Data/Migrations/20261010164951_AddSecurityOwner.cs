using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Folio.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddSecurityOwner : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_securities_symbol",
                table: "securities");

            migrationBuilder.AddColumn<string>(
                name: "owner_id",
                table: "securities",
                type: "text",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_securities_owner_id_symbol",
                table: "securities",
                columns: new[] { "owner_id", "symbol" },
                unique: true,
                filter: "owner_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_securities_symbol",
                table: "securities",
                column: "symbol",
                unique: true,
                filter: "owner_id IS NULL");

            migrationBuilder.AddForeignKey(
                name: "fk_securities_asp_net_users_owner_id",
                table: "securities",
                column: "owner_id",
                principalTable: "AspNetUsers",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_securities_asp_net_users_owner_id",
                table: "securities");

            migrationBuilder.DropIndex(
                name: "ix_securities_owner_id_symbol",
                table: "securities");

            migrationBuilder.DropIndex(
                name: "ix_securities_symbol",
                table: "securities");

            migrationBuilder.DropColumn(
                name: "owner_id",
                table: "securities");

            migrationBuilder.CreateIndex(
                name: "ix_securities_symbol",
                table: "securities",
                column: "symbol",
                unique: true);
        }
    }
}
