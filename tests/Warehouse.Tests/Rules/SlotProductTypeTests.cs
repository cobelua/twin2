using Warehouse.Api.Models;

namespace Warehouse.Tests.Rules;

// Luật loại hàng của CanHold. Kích thước pallet luôn vừa khung, để chỉ còn loại hàng quyết định kết quả.
public class SlotProductTypeTests
{
    private const double Margin = 0.05;
    private const int Screws = 1;
    private const int Wheels = 2;

    private static Rack MakeRack(int? productTypeId)
        => new(1, "K1", 0, 0, 0, 2, 1.3, 3, 1.2, 0.9, true, 1000, productTypeId);

    private static Slot FloorSlot() => new(1, "K1-T1-R1", 1, 1, isTop: false);

    private static Pallet PalletOf(int? productTypeId, double length = 1.0, double width = 0.8)
        => new(1, new PalletSize("A", length, width, 1.0, "#888"), "b1-P001", productTypeId);

    [Fact]
    public void GeneralRack_AcceptsAnyProductType()
    {
        Assert.Null(FloorSlot().CanHold(MakeRack(null), PalletOf(Screws), Margin));
        Assert.Null(FloorSlot().CanHold(MakeRack(null), PalletOf(Wheels), Margin));
    }

    [Fact]
    public void GeneralRack_AcceptsUnclassifiedPallet()
    {
        Assert.Null(FloorSlot().CanHold(MakeRack(null), PalletOf(null), Margin));
    }

    [Fact]
    public void SpecializedRack_AcceptsSameProductType()
    {
        Assert.Null(FloorSlot().CanHold(MakeRack(Screws), PalletOf(Screws), Margin));
    }

    [Fact]
    public void SpecializedRack_RejectsOtherProductType()
    {
        Assert.Equal("Kệ chỉ dành cho loại hàng khác.", FloorSlot().CanHold(MakeRack(Screws), PalletOf(Wheels), Margin));
    }

    [Fact]
    public void SpecializedRack_RejectsUnclassifiedPallet()
    {
        Assert.Equal("Kệ chỉ dành cho loại hàng khác.", FloorSlot().CanHold(MakeRack(Screws), PalletOf(null), Margin));
    }

    [Fact]
    public void WrongProductType_IsReportedBeforeSize()
    {
        // pallet vừa sai loại hàng vừa rộng hơn khung: báo loại hàng trước
        var tooWide = PalletOf(Wheels, length: 1.5, width: 1.5);

        Assert.Equal("Kệ chỉ dành cho loại hàng khác.", FloorSlot().CanHold(MakeRack(Screws), tooWide, Margin));
    }

    [Fact]
    public void RightProductType_StillChecksSize()
    {
        var tooWide = PalletOf(Screws, length: 1.5, width: 1.5);

        Assert.Equal("Pallet rộng hơn khung.", FloorSlot().CanHold(MakeRack(Screws), tooWide, Margin));
    }
}
