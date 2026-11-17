using Warehouse.Api.Models;

namespace Warehouse.Tests.Models;

public class ObstacleTests
{
    [Fact]
    public void Bounds_MatchesPositionAndSize()
    {
        var column = new Obstacle(1, ObstacleKind.Column, 6.5, 8, 0.4, 0.4);

        Assert.Equal(new Rect(6.5, 8, 0.4, 0.4), column.Bounds);
    }

    [Theory]
    [InlineData(-0.1, 0, 1, 1, "x")]
    [InlineData(0, -0.1, 1, 1, "y")]
    [InlineData(0, 0, 0, 1, "width")]
    [InlineData(0, 0, 1, 0, "depth")]
    public void Constructor_InvalidNumber_Throws(double x, double y, double width, double depth, string badParam)
    {
        var ex = Assert.Throws<ArgumentException>(
            () => new Obstacle(1, ObstacleKind.Wall, x, y, width, depth));

        Assert.Equal(badParam, ex.ParamName);
    }
}
