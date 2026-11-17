using Warehouse.Api.Models;

namespace Warehouse.Tests.Models;

public class RackTests
{
    private static Rack Make(
        string code = "K1", int x = 2, int y = 2, int rotation = 0,
        int levels = 2, double levelHeight = 1.3, int bays = 3,
        double bayWidth = 1.35, double depth = 1.1, double maxWeight = 1000)
        => new(1, code, x, y, rotation, levels, levelHeight, bays, bayWidth, depth, false, maxWeight);

    [Fact]
    public void Constructor_ValidValues_KeepsValues()
    {
        var rack = Make(code: " K1 ");

        Assert.Equal("K1", rack.Code);
        Assert.Equal(2, rack.Levels);
        Assert.Equal(1.3, rack.LevelHeight);
        Assert.Equal(3, rack.Bays);
        Assert.Equal(1.35, rack.BayWidth);
        Assert.Equal(1.1, rack.Depth);
        Assert.False(rack.HasTop);
        Assert.Equal(1000, rack.MaxWeight);
    }

    [Fact]
    public void Constructor_Rotation90_IsAllowed()
    {
        Assert.Equal(90, Make(rotation: 90).Rotation);
    }

    [Fact]
    public void Constructor_EmptyCode_Throws()
    {
        Assert.Equal("code", Assert.Throws<ArgumentException>(() => Make(code: " ")).ParamName);
    }

    [Fact]
    public void Constructor_NegativePosition_Throws()
    {
        Assert.Equal("x", Assert.Throws<ArgumentException>(() => Make(x: -1)).ParamName);
        Assert.Equal("y", Assert.Throws<ArgumentException>(() => Make(y: -1)).ParamName);
    }

    [Fact]
    public void Constructor_RotationNot0Or90_Throws()
    {
        Assert.Equal("rotation", Assert.Throws<ArgumentException>(() => Make(rotation: 45)).ParamName);
    }

    [Fact]
    public void Constructor_InvalidConfig_Throws()
    {
        Assert.Equal("levels", Assert.Throws<ArgumentException>(() => Make(levels: 0)).ParamName);
        Assert.Equal("levelHeight", Assert.Throws<ArgumentException>(() => Make(levelHeight: 0)).ParamName);
        Assert.Equal("bays", Assert.Throws<ArgumentException>(() => Make(bays: 0)).ParamName);
        Assert.Equal("bayWidth", Assert.Throws<ArgumentException>(() => Make(bayWidth: -1)).ParamName);
        Assert.Equal("depth", Assert.Throws<ArgumentException>(() => Make(depth: 0)).ParamName);
        Assert.Equal("maxWeight", Assert.Throws<ArgumentException>(() => Make(maxWeight: 0)).ParamName);
    }
}
