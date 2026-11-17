using Warehouse.Api.Models;

namespace Warehouse.Tests.Models;

public class RectTests
{
    private static readonly Rect K1 = new(1.0, 2.0, 4.8, 1.0);   // x 1,0 → 5,8; y 2,0 → 3,0

    [Fact]
    public void Overlaps_SharedArea_IsTrue()
    {
        Assert.True(K1.Overlaps(new Rect(5.0, 2.5, 2, 2)));
    }

    [Fact]
    public void Overlaps_OnlyTouchingEdge_IsFalse()
    {
        // Kệ liền nhau (MinGap = 0): cạnh phải K1 = cạnh trái kệ kia = 5,8.
        Assert.False(K1.Overlaps(new Rect(5.8, 2.0, 4.8, 1.0)));
    }

    [Fact]
    public void Overlaps_TouchingWithFloatingPointNoise_IsFalse()
    {
        // 1,0 + 4,8 trong double không ra đúng 5,8; vẫn phải coi là chạm, không phải đè.
        var next = new Rect(0.1 + 0.2 + 5.5, 2.0, 1, 1);   // 5,8000000000000001

        Assert.False(K1.Overlaps(next));
    }

    [Fact]
    public void Overlaps_FarAway_IsFalse()
    {
        Assert.False(K1.Overlaps(new Rect(10, 10, 1, 1)));
    }

    [Fact]
    public void IsInside_TouchingOuterEdges_IsTrue()
    {
        Assert.True(new Rect(0, 0, 20, 12).IsInside(new Rect(0, 0, 20, 12)));
    }

    [Fact]
    public void IsInside_StickingOut_IsFalse()
    {
        Assert.False(new Rect(18, 0, 4.8, 1).IsInside(new Rect(0, 0, 20, 12)));
    }

    [Fact]
    public void GapTo_SameRow_GivesDistanceAlongX()
    {
        var (dx, dy) = K1.GapTo(new Rect(7.0, 2.0, 4.8, 1.0));

        Assert.True(Tolerance.AreEqual(1.2, dx));
        Assert.Equal(0, dy);
    }

    [Fact]
    public void GapTo_IsSymmetric()
    {
        var other = new Rect(7.0, 5.0, 2, 2);

        Assert.Equal(K1.GapTo(other), other.GapTo(K1));
    }

    [Fact]
    public void GapTo_Overlapping_IsZeroBothWays()
    {
        Assert.Equal((0.0, 0.0), K1.GapTo(new Rect(2, 2.5, 1, 1)));
    }
}
