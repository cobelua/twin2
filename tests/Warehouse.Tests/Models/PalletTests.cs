using Warehouse.Api.Models;

namespace Warehouse.Tests.Models;

public class PalletTests
{
    private static PalletSize SizeA() => new("A", 1.2, 1.0, 1.1, "#1D9E75", 500);

    [Fact]
    public void Constructor_ValidValues_KeepsValues()
    {
        var size = SizeA();

        var pallet = new Pallet(1, size, " b1-P001 ");

        Assert.Equal(1, pallet.BatchId);
        Assert.Same(size, pallet.Size);
        Assert.Equal("b1-P001", pallet.Code);
    }

    [Fact]
    public void Constructor_NullSize_Throws()
    {
        var ex = Assert.Throws<ArgumentNullException>(() => new Pallet(1, null!, "b1-P001"));

        Assert.Equal("size", ex.ParamName);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Constructor_EmptyCode_Throws(string code)
    {
        var ex = Assert.Throws<ArgumentException>(() => new Pallet(1, SizeA(), code));

        Assert.Equal("code", ex.ParamName);
    }
}
