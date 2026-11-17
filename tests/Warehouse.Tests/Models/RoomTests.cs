using Warehouse.Api.Models;

namespace Warehouse.Tests.Models;

public class RoomTests
{
    [Fact]
    public void Constructor_KeepsSizesInMetersAndStartsEmpty()
    {
        var room = new Room("Kho A", 20, 12, 0.5, 1.0, 0.05);

        Assert.Equal(20, room.Width);
        Assert.Equal(12, room.Depth);
        Assert.Equal(0.5, room.GridSize);
        Assert.Equal(new Rect(0, 0, 20, 12), room.Bounds);
        Assert.Empty(room.Racks);
        Assert.Empty(room.Obstacles);
    }

    [Fact]
    public void Constructor_TrimsName()
    {
        Assert.Equal("Kho A", new Room("  Kho A ", 20, 12, 0.5, 1.0, 0.05).Name);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Constructor_EmptyName_Throws(string name)
    {
        var ex = Assert.Throws<ArgumentException>(() => new Room(name, 20, 12, 0.5, 1.0, 0.05));

        Assert.Equal("name", ex.ParamName);
    }

    [Theory]
    [InlineData(0, 12, 0.5, 1.0, 0.05, "width")]
    [InlineData(20, 0, 0.5, 1.0, 0.05, "depth")]
    [InlineData(20, 12, 0, 1.0, 0.05, "gridSize")]
    [InlineData(20, 12, 0.5, -1, 0.05, "minGap")]
    [InlineData(20, 12, 0.5, 1.0, -0.01, "margin")]
    public void Constructor_InvalidNumber_Throws(
        double width, double depth, double gridSize, double minGap, double margin, string badParam)
    {
        var ex = Assert.Throws<ArgumentException>(
            () => new Room("Kho A", width, depth, gridSize, minGap, margin));

        Assert.Equal(badParam, ex.ParamName);
    }

    [Fact]
    public void Configure_ChangingGrid_DoesNotMoveRacks()
    {
        // Grid chỉ để snap: đổi grid thì kệ vẫn nằm đúng chỗ, đúng kích thước.
        var room = new Room("Kho A", 20, 12, 0.5, 1.0, 0.05);
        var rack = new Rack(1, "K1", 7.0, 2.0, 0, 3, 1.2, 4, 1.2, 1.0, true, 1000);
        room.Racks.Add(rack);
        var before = rack.GetBounds();

        room.Configure("Kho A", 20, 12, 1.0, 1.0, 0.05);

        Assert.Equal(1.0, room.GridSize);
        Assert.Equal(before, rack.GetBounds());
    }

    [Fact]
    public void AddObstacle_Inside_IsAdded()
    {
        var room = new Room("Kho A", 20, 12, 0.5, 1.0, 0.05);

        room.AddObstacle(new Obstacle(1, ObstacleKind.Column, 6.5, 8, 0.4, 0.4));

        Assert.Single(room.Obstacles);
    }

    [Fact]
    public void AddObstacle_TouchingRoomEdge_IsAllowed()
    {
        // Tường ngăn chạy sát tới mép phòng: 19,8 + 0,2 = 20 đúng bằng chiều dài phòng.
        var room = new Room("Kho A", 20, 12, 0.5, 1.0, 0.05);

        room.AddObstacle(new Obstacle(1, ObstacleKind.Wall, 19.8, 0, 0.2, 6));

        Assert.Single(room.Obstacles);
    }

    [Fact]
    public void AddObstacle_StickingOutOfRoom_Throws()
    {
        var room = new Room("Kho A", 20, 12, 0.5, 1.0, 0.05);

        var ex = Assert.Throws<ArgumentException>(
            () => room.AddObstacle(new Obstacle(1, ObstacleKind.Column, 19.8, 5, 0.4, 0.4)));

        Assert.Equal("obstacle", ex.ParamName);
        Assert.Empty(room.Obstacles);
    }
}
