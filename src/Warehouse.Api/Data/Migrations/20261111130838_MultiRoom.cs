using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Warehouse.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class MultiRoom : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Slots_Code",
                table: "Slots");

            migrationBuilder.DropIndex(
                name: "IX_Slots_RackId",
                table: "Slots");

            migrationBuilder.AddColumn<string>(
                name: "Name",
                table: "Rooms",
                type: "character varying(50)",
                maxLength: 50,
                nullable: false,
                defaultValue: "");

            // Viết tay: phòng đã có trước migration này chưa có tên (cột vừa thêm mang giá trị ""),
            // đặt "Phòng {Id}" để không trùng nhau trước khi tạo index duy nhất IX_Rooms_Name bên dưới.
            migrationBuilder.Sql("UPDATE \"Rooms\" SET \"Name\" = 'Phòng ' || \"Id\" WHERE \"Name\" = '';");

            migrationBuilder.CreateIndex(
                name: "IX_Slots_RackId_Code",
                table: "Slots",
                columns: new[] { "RackId", "Code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Rooms_Name",
                table: "Rooms",
                column: "Name",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Slots_RackId_Code",
                table: "Slots");

            migrationBuilder.DropIndex(
                name: "IX_Rooms_Name",
                table: "Rooms");

            migrationBuilder.DropColumn(
                name: "Name",
                table: "Rooms");

            migrationBuilder.CreateIndex(
                name: "IX_Slots_Code",
                table: "Slots",
                column: "Code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Slots_RackId",
                table: "Slots",
                column: "RackId");
        }
    }
}
