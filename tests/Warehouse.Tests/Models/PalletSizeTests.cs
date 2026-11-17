using Warehouse.Api.Models;

namespace Warehouse.Tests.Models;

public class PalletSizeTests
{
    [Fact]
    public void Constructor_ValidValues_KeepsValues()
    {
        var size = new PalletSize(" A ", 1.2, 1.0, 1.1, "#1D9E75", 500);

        Assert.Equal("A", size.Code);
        Assert.Equal(1.2, size.Length);
        Assert.Equal(1.0, size.Width);
        Assert.Equal(1.1, size.Height);
        Assert.Equal("#1D9E75", size.Color);
        Assert.Equal(500, size.Weight);
    }

    [Fact]
    public void Constructor_WithoutWeight_AllowsNull()
    {
        var size = new PalletSize("A", 1.2, 1.0, 1.1, "#1D9E75");

        Assert.Null(size.Weight);
    }

    [Theory]
    [InlineData("", 1.2, 1.0, 1.1, "#fff", 500, "code")]
    [InlineData("A", 0, 1.0, 1.1, "#fff", 500, "length")]
    [InlineData("A", 1.2, -1, 1.1, "#fff", 500, "width")]
    [InlineData("A", 1.2, 1.0, 0, "#fff", 500, "height")]
    [InlineData("A", 1.2, 1.0, 1.1, " ", 500, "color")]
    [InlineData("A", 1.2, 1.0, 1.1, "#fff", 0, "weight")]
    [InlineData("A", 1.2, 1.0, 1.1, "#fff", -5, "weight")]
    public void Constructor_InvalidValue_Throws(
        string code, double length, double width, double height, string color, double weight, string badParam)
    {
        var ex = Assert.Throws<ArgumentException>(
            () => new PalletSize(code, length, width, height, color, weight));

        Assert.Equal(badParam, ex.ParamName);
    }
}
