using Warehouse.Api.Models;

namespace Warehouse.Tests.Models;

public class RackBoundsTests
{
    private static Rack MakeRack(double x = 2, double y = 3, int bays = 3, double bayWidth = 1.35, double depth = 1.1,
                                 int rotation = 0, int levels = 2, bool hasTop = false)
        => new(1, "K1", x, y, rotation, levels, 1.3, bays, bayWidth, depth, hasTop, 1000);

    [Fact]
    public void GetBounds_Rotation0_LengthAlongX()
    {
        // dài 3 × 1,35 = 4,05 m theo X; sâu 1,1 m theo Y
        var b = MakeRack().GetBounds();

        Assert.Equal(2, b.X);
        Assert.Equal(3, b.Y);
        Assert.True(Tolerance.AreEqual(4.05, b.Width));
        Assert.True(Tolerance.AreEqual(1.1, b.Depth));
    }

    [Fact]
    public void GetBounds_Rotation90_SwapsLengthAndDepth()
    {
        var b = MakeRack(rotation: 90).GetBounds();

        Assert.True(Tolerance.AreEqual(1.1, b.Width));
        Assert.True(Tolerance.AreEqual(4.05, b.Depth));
    }

    [Fact]
    public void GetBounds_KeepsPositionInMeters_NotRoundedToGrid()
    {
        var b = MakeRack(x: 7.25, y: 0.3).GetBounds();

        Assert.Equal(7.25, b.X);
        Assert.Equal(0.3, b.Y);
    }

    [Fact]
    public void GetBounds_DoesNotDependOnLevelsOrTop()
    {
        var low = MakeRack(levels: 1, hasTop: false).GetBounds();
        var tall = MakeRack(levels: 5, hasTop: true).GetBounds();

        Assert.Equal(low, tall);
    }
}
