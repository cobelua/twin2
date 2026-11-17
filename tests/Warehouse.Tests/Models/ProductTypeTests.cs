using Warehouse.Api.Models;

namespace Warehouse.Tests.Models;

public class ProductTypeTests
{
    [Fact]
    public void Constructor_ValidValues_KeepsValues()
    {
        var type = new ProductType(" SCREW ", " Ốc vít ");

        Assert.Equal("SCREW", type.Code);
        Assert.Equal("Ốc vít", type.Name);
    }

    [Theory]
    [InlineData("", "Ốc vít", "code")]
    [InlineData("  ", "Ốc vít", "code")]
    [InlineData("SCREW", "", "name")]
    [InlineData("SCREW", "  ", "name")]
    public void Constructor_InvalidValue_Throws(string code, string name, string badParam)
    {
        var ex = Assert.Throws<ArgumentException>(() => new ProductType(code, name));

        Assert.Equal(badParam, ex.ParamName);
    }

    [Fact]
    public void Rack_WithoutProductType_IsGeneralRack()
    {
        var rack = new Rack(1, "K1", 0, 0, 0, 2, 1.3, 3, 1.2, 0.9, false, 1000);

        Assert.Null(rack.ProductTypeId);
    }

    [Fact]
    public void Rack_WithProductType_KeepsIt()
    {
        var rack = new Rack(1, "K1", 0, 0, 0, 2, 1.3, 3, 1.2, 0.9, false, 1000, productTypeId: 7);

        Assert.Equal(7, rack.ProductTypeId);
    }

    [Fact]
    public void Pallet_WithoutProductType_IsUnclassified()
    {
        var pallet = new Pallet(1, new PalletSize("A", 1.2, 1.0, 1.1, "#888"), "b1-P001");

        Assert.Null(pallet.ProductTypeId);
    }

    [Fact]
    public void Pallet_WithProductType_KeepsIt()
    {
        var pallet = new Pallet(1, new PalletSize("A", 1.2, 1.0, 1.1, "#888"), "b1-P001", productTypeId: 3);

        Assert.Equal(3, pallet.ProductTypeId);
    }
}
