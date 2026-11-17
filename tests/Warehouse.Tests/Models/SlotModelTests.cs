using Warehouse.Api.Models;

namespace Warehouse.Tests.Models;

// Chỉ kiểm tra dữ liệu và ràng buộc của model Slot.
// Luật CanHold/Place/Remove sẽ có test riêng trong Rules/SlotTests.cs.
public class SlotModelTests
{
    [Fact]
    public void Constructor_NewSlot_IsEmpty()
    {
        var slot = new Slot(1, " K1-T1-R1 ", 1, 1, false);

        Assert.Equal("K1-T1-R1", slot.Code);
        Assert.Equal(1, slot.Level);
        Assert.Equal(1, slot.Bay);
        Assert.False(slot.IsTop);
        Assert.Null(slot.AssignedSize);
        Assert.Null(slot.PalletId);
    }

    [Theory]
    [InlineData("", 1, 1, "code")]
    [InlineData("K1-T0-R1", 0, 1, "level")]
    [InlineData("K1-T1-R0", 1, 0, "bay")]
    public void Constructor_InvalidValue_Throws(string code, int level, int bay, string badParam)
    {
        var ex = Assert.Throws<ArgumentException>(() => new Slot(1, code, level, bay, false));

        Assert.Equal(badParam, ex.ParamName);
    }

    // Kệ: ô rộng bayWidth (dọc ô) × sâu depth.
    private static Rack RackWith(double bayWidth, double depth)
        => new(1, "K1", 0, 0, 0, 2, 1.5, 3, bayWidth, depth, false, 1000, null);

    [Fact]
    public void PalletFootprint_SquarePallet_KeepsItsRealSize()
    {
        // Pallet vuông 0,8 × 0,8 trong khung 1,2 × 1,0: vẽ đúng 0,8 × 0,8, không phải bằng cả khung.
        var footprint = Slot.PalletFootprint(RackWith(1.2, 1.0), new PalletSize("A", 0.8, 0.8, 1.0, "#888"));

        Assert.Equal((0.8, 0.8), footprint);
    }

    [Fact]
    public void PalletFootprint_FitsWithoutTurning_LengthRunsAlongTheBay()
    {
        var footprint = Slot.PalletFootprint(RackWith(1.2, 1.0), new PalletSize("A", 1.2, 0.8, 1.0, "#888"));

        Assert.Equal((1.2, 0.8), footprint);
    }

    [Fact]
    public void PalletFootprint_FitsOnlyTurned_IsRotated90()
    {
        // Khung 0,9 × 1,2: pallet 1,2 × 0,8 chỉ vừa khi xoay (giống CanHold): 0,8 dọc ô, 1,2 theo chiều sâu.
        var footprint = Slot.PalletFootprint(RackWith(0.9, 1.2), new PalletSize("A", 1.2, 0.8, 1.0, "#888"));

        Assert.Equal((0.8, 1.2), footprint);
    }
}
