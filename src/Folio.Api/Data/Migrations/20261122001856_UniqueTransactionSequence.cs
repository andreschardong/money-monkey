using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Folio.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class UniqueTransactionSequence : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Two writes racing before this release could have given two transactions the same number. Only portfolios
            // with such a pair are renumbered 1..n, in their current order (number, then when entered), so the unique
            // index can be built; every other portfolio keeps its numbers.
            migrationBuilder.Sql(
                """
                UPDATE transactions AS t
                SET sequence = n.rn
                FROM (
                    SELECT id, row_number() OVER (PARTITION BY portfolio_id ORDER BY sequence, created_at, id) AS rn
                    FROM transactions
                    WHERE portfolio_id IN (
                        SELECT portfolio_id FROM transactions GROUP BY portfolio_id, sequence HAVING count(*) > 1)
                ) AS n
                WHERE t.id = n.id AND t.sequence <> n.rn;
                """);

            migrationBuilder.CreateIndex(
                name: "ix_transactions_portfolio_id_sequence",
                table: "transactions",
                columns: new[] { "portfolio_id", "sequence" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_transactions_portfolio_id_sequence",
                table: "transactions");
        }
    }
}
