using Warehouse.Api.Models;
using Warehouse.Api.Rules;

namespace Warehouse.Tests.Rules;

// Phòng 10 m × 5 m, lối đi tối thiểu 1,0 m. Mọi toạ độ bằng mét.
// Kệ mẫu: 2 ô × 1,0 m = dài 2,0 m theo X, sâu 1,0 m theo Y (xoay 90° thì 1,0 × 2,0).
public class PlacementValidatorTests
{
    private static Room MakeRoom(double minGap = 1.0) => new("Kho A", 10, 5, 0.5, minGap, 0.05);

    private static Rack MakeRack(string code, double x, double y, int rotation = 0)
        => new(1, code, x, y, rotation, 2, 1.3, 2, 1.0, 1.0, false, 1000);

    private static Obstacle Wall(double x, double y, double width, double depth)
        => new(1, ObstacleKind.Wall, x, y, width, depth);

    private static Obstacle Column(double x, double y)
        => new(1, ObstacleKind.Column, x, y, 0.4, 0.4);

    // ---- hợp lệ ----

    [Fact]
    public void Validate_RackInEmptyRoom_ReturnsNull()
    {
        Assert.Null(PlacementValidator.Validate(MakeRoom(), MakeRack("K1", 2.5, 1.5)));
    }

    [Fact]
    public void Validate_PositionOffGrid_IsAllowed()
    {
        // Grid chỉ để snap trên giao diện; server không ép kệ nằm đúng lưới.
        Assert.Null(PlacementValidator.Validate(MakeRoom(), MakeRack("K1", 2.37, 1.13)));
    }

    // ---- ngoài sàn ----

    [Theory]
    [InlineData(8.0, 0, true)]     // x 8 → 10: sát mép phải
    [InlineData(8.1, 0, false)]    // x 8,1 → 10,1: thò ra ngoài
    [InlineData(0, 4.0, true)]     // y 4 → 5: sát mép dưới
    [InlineData(0, 4.1, false)]    // y 4,1 → 5,1: thò ra ngoài
    public void Validate_RackAtRoomEdge(double x, double y, bool allowed)
    {
        var reason = PlacementValidator.Validate(MakeRoom(), MakeRack("K1", x, y));

        if (allowed)
            Assert.Null(reason);
        else
            Assert.Equal("Kệ nằm ngoài sàn.", reason);
    }

    [Theory]
    [InlineData(9.0, 3.0, true)]   // xoay 90°: rộng 1 × sâu 2 → x 9 → 10, y 3 → 5
    [InlineData(9.1, 3.0, false)]
    [InlineData(9.0, 3.1, false)]
    public void Validate_Rotated90RackAtRoomEdge_UsesSwappedSize(double x, double y, bool allowed)
    {
        var reason = PlacementValidator.Validate(MakeRoom(), MakeRack("K1", x, y, rotation: 90));

        if (allowed)
            Assert.Null(reason);
        else
            Assert.Equal("Kệ nằm ngoài sàn.", reason);
    }

    // ---- đè tường, cột ----

    [Fact]
    public void Validate_RackOnWall_ReportsWallPosition()
    {
        var room = MakeRoom();
        room.AddObstacle(Wall(3.0, 0, 0.2, 5));   // tường ngăn dọc ở x 3,0 → 3,2

        Assert.Equal("Kệ đè tường tại (3; 0) m.", PlacementValidator.Validate(room, MakeRack("K1", 2.5, 1.5)));
    }

    [Fact]
    public void Validate_RackOnColumn_ReportsColumnPosition()
    {
        var room = MakeRoom();
        room.AddObstacle(Column(3.5, 2.0));

        Assert.Equal("Kệ đè cột tại (3.5; 2) m.", PlacementValidator.Validate(room, MakeRack("K1", 2.5, 1.5)));
    }

    [Fact]
    public void Validate_ColumnTouchingRackEdge_IsAllowed()
    {
        var room = MakeRoom();
        room.AddObstacle(Column(4.5, 1.5));   // kệ x 2,5 → 4,5: cột bắt đầu đúng ở cạnh phải

        Assert.Null(PlacementValidator.Validate(room, MakeRack("K1", 2.5, 1.5)));
    }

    [Fact]
    public void Validate_WallAndTooCloseToRack_ReportsWallNotAisle()
    {
        var room = MakeRoom();
        room.AddObstacle(Column(2.5, 1.5));
        room.Racks.Add(MakeRack("K2", 5.0, 1.5));   // chỉ cách 0,5 m, thiếu lối đi

        Assert.Equal("Kệ đè cột tại (2.5; 1.5) m.", PlacementValidator.Validate(room, MakeRack("K1", 2.5, 1.5)));
    }

    // ---- đè kệ khác ----

    [Fact]
    public void Validate_OverlapsExistingRack_ReportsOverlap()
    {
        var room = MakeRoom();
        room.Racks.Add(MakeRack("K2", 2.5, 1.5));   // x 2,5 → 4,5

        Assert.Equal("Kệ đè lên K2.", PlacementValidator.Validate(room, MakeRack("K3", 3.5, 1.5)));
    }

    [Fact]
    public void Validate_OverlapWithOneRackAndTooCloseToAnother_ReportsOverlapFirst()
    {
        var room = MakeRoom();
        room.Racks.Add(MakeRack("K2", 2.5, 1.5));   // x 2,5 → 4,5
        room.Racks.Add(MakeRack("K4", 6.0, 1.5));   // kệ mới x 4,0 → 6,0: liền sát K4

        Assert.Equal("Kệ đè lên K2.", PlacementValidator.Validate(room, MakeRack("K3", 4.0, 1.5)));
    }

    // ---- lối đi ----

    [Theory]
    [InlineData(4.5, false)]   // liền K2 (2,5 → 4,5): 0 m
    [InlineData(5.0, false)]   // 0,5 m < 1,0
    [InlineData(5.5, true)]    // đúng 1,0 m: đủ
    public void Validate_AisleBesideExistingRack(double x, bool allowed)
    {
        var room = MakeRoom();
        room.Racks.Add(MakeRack("K2", 2.5, 1.5));

        var reason = PlacementValidator.Validate(room, MakeRack("K1", x, 1.5));

        if (allowed)
            Assert.Null(reason);
        else
            Assert.Equal("Thiếu lối đi với K2.", reason);
    }

    [Theory]
    [InlineData(3.0, false)]   // K2 y 1,5 → 2,5; khoảng trống 0,5 m
    [InlineData(3.5, true)]    // khoảng trống 1,0 m
    public void Validate_AisleAboveOrBelowExistingRack(double y, bool allowed)
    {
        var room = MakeRoom();
        room.Racks.Add(MakeRack("K2", 2.5, 1.5));

        var reason = PlacementValidator.Validate(room, MakeRack("K1", 2.5, y));

        if (allowed)
            Assert.Null(reason);
        else
            Assert.Equal("Thiếu lối đi với K2.", reason);
    }

    [Fact]
    public void Validate_DiagonalNeighbour_NeedsGapOnOnlyOneAxis()
    {
        // K1 chéo góc với K2: cách 0,5 m theo X nhưng 1,0 m theo Y → đi qua được.
        var room = MakeRoom();
        room.Racks.Add(MakeRack("K2", 2.5, 1.5));   // x 2,5 → 4,5; y 1,5 → 2,5

        Assert.Null(PlacementValidator.Validate(room, MakeRack("K1", 5.0, 3.5)));
        Assert.Equal("Thiếu lối đi với K2.", PlacementValidator.Validate(room, MakeRack("K1", 5.0, 3.0)));
    }

    [Fact]
    public void Validate_AisleExactlyMinGapWithFloatingPointNoise_IsAllowed()
    {
        // 0,1 + 0,2 + 4,2 = 4,500000000000001 trong double; khoảng cách vẫn phải tính là đúng 1,0 m.
        var room = MakeRoom();
        room.Racks.Add(MakeRack("K2", 0.1 + 0.2 + 4.2 - 2.0, 1.5));   // x ≈ 2,5 → 4,5

        Assert.Null(PlacementValidator.Validate(room, MakeRack("K1", 5.5, 1.5)));
    }

    [Fact]
    public void Validate_MinGapZero_AllowsRacksSideBySide_ButStillRejectsOverlap()
    {
        var room = MakeRoom(minGap: 0);
        room.Racks.Add(MakeRack("K2", 2.5, 1.5));

        Assert.Null(PlacementValidator.Validate(room, MakeRack("K1", 4.5, 1.5)));
        Assert.Equal("Kệ đè lên K2.", PlacementValidator.Validate(room, MakeRack("K1", 4.4, 1.5)));
    }

    [Fact]
    public void Validate_MinGapIsExactMeters_NotRoundedToGrid()
    {
        // 0,6 m: cách 0,6 là đủ, cách 0,5 thì thiếu (trước đây làm tròn lên 2 ô = 1,0 m).
        var room = MakeRoom(minGap: 0.6);
        room.Racks.Add(MakeRack("K2", 2.5, 1.5));

        Assert.Equal("Thiếu lối đi với K2.", PlacementValidator.Validate(room, MakeRack("K1", 5.0, 1.5)));
        Assert.Null(PlacementValidator.Validate(room, MakeRack("K1", 5.1, 1.5)));
    }

    [Fact]
    public void Validate_RackNextToWallWithoutAisle_IsAllowed()
    {
        // lối đi chỉ áp dụng giữa kệ với kệ, không áp dụng với tường
        var room = MakeRoom();
        room.AddObstacle(Wall(4.5, 0, 0.2, 5));

        Assert.Null(PlacementValidator.Validate(room, MakeRack("K1", 2.5, 1.5)));
    }

    // ---- kiểm tra lại chính kệ đã có ----

    [Fact]
    public void Validate_ExistingRackAtSamePlace_DoesNotOverlapItself()
    {
        var room = MakeRoom();
        var k2 = MakeRack("K2", 2.5, 1.5);
        room.Racks.Add(k2);

        Assert.Null(PlacementValidator.Validate(room, k2));
    }

    [Fact]
    public void Validate_MovingExistingRack_IgnoresItsOldPosition()
    {
        var room = MakeRoom();
        room.Racks.Add(MakeRack("K2", 2.5, 1.5));

        // cùng mã K2 nhưng dời sang 3,0: vẫn chồng lên vị trí cũ, nhưng không tính là đè kệ khác
        Assert.Null(PlacementValidator.Validate(room, MakeRack("K2", 3.0, 1.5)));
    }

    [Fact]
    public void Validate_SameCodeIgnoresCase()
    {
        var room = MakeRoom();
        room.Racks.Add(MakeRack("K2", 2.5, 1.5));

        Assert.Null(PlacementValidator.Validate(room, MakeRack("k2", 3.0, 1.5)));
    }

    // ---- không sửa dữ liệu, tham số null ----

    [Fact]
    public void Validate_DoesNotChangeRoom()
    {
        var room = MakeRoom();
        room.AddObstacle(Column(0.5, 0.5));
        room.Racks.Add(MakeRack("K2", 2.5, 1.5));

        PlacementValidator.Validate(room, MakeRack("K1", 5.5, 1.5));

        Assert.Single(room.Obstacles);
        Assert.Single(room.Racks);
    }

    [Fact]
    public void Validate_NullRoom_Throws()
    {
        var ex = Assert.Throws<ArgumentNullException>(() => PlacementValidator.Validate(null!, MakeRack("K1", 0, 0)));

        Assert.Equal("room", ex.ParamName);
    }

    [Fact]
    public void Validate_NullRack_Throws()
    {
        var ex = Assert.Throws<ArgumentNullException>(() => PlacementValidator.Validate(MakeRoom(), null!));

        Assert.Equal("rack", ex.ParamName);
    }
}
