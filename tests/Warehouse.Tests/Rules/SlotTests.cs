using Warehouse.Api.Models;

namespace Warehouse.Tests.Rules;

// Luật của một khung: CanHold, Place, Remove.
// Kệ mẫu: khung rộng 1,2 × sâu 0,9, cao tầng 1,3, tải trọng 1000 kg. Margin dùng 0,05.
public class SlotTests
{
    private const double Margin = 0.05;

    private static Rack MakeRack() => new(1, "K1", 0, 0, 0, 2, 1.3, 3, 1.2, 0.9, true, 1000);

    private static Slot FloorSlot() => new(1, "K1-T1-R1", 1, 1, isTop: false);

    private static Slot TopSlot() => new(1, "K1-N-R1", 3, 1, isTop: true);

    private static Pallet PalletOf(double length, double width, double height, double? weight = null, string code = "A")
        => new(1, new PalletSize(code, length, width, height, "#888", weight), "b1-P001");

    // ---- CanHold ----

    [Fact]
    public void CanHold_PalletFits_ReturnsNull()
    {
        Assert.Null(FloorSlot().CanHold(MakeRack(), PalletOf(1.1, 0.8, 1.0, 500), Margin));
    }

    [Fact]
    public void CanHold_PalletFitsOnlyWhenRotated90_ReturnsNull()
    {
        // dài 0,8 × rộng 1,2 vào khung rộng 1,2 × sâu 0,9: không xoay thì rộng 1,2 > sâu 0,9, xoay thì vừa
        Assert.Null(FloorSlot().CanHold(MakeRack(), PalletOf(0.8, 1.2, 1.0), Margin));
    }

    [Fact]
    public void CanHold_PalletExactlyAsBigAsSlotFloor_ReturnsNull()
    {
        Assert.Null(FloorSlot().CanHold(MakeRack(), PalletOf(1.2, 0.9, 1.0), Margin));
    }

    [Theory]
    [InlineData(1.3, 0.8)]   // dài hơn khung
    [InlineData(1.1, 1.0)]   // rộng hơn chiều sâu, xoay cũng không vừa
    [InlineData(1.3, 1.3)]
    public void CanHold_PalletWiderThanSlot_ReturnsReason(double length, double width)
    {
        Assert.Equal("Pallet rộng hơn khung.", FloorSlot().CanHold(MakeRack(), PalletOf(length, width, 1.0), Margin));
    }

    [Fact]
    public void CanHold_PalletTooTallForLevel_ReturnsReason()
    {
        Assert.Equal("Pallet cao hơn khung.", FloorSlot().CanHold(MakeRack(), PalletOf(1.1, 0.8, 3.0), Margin));
    }

    [Fact]
    public void CanHold_TallPalletOnTopSlot_ReturnsNull()
    {
        Assert.Null(TopSlot().CanHold(MakeRack(), PalletOf(1.1, 0.8, 3.0), Margin));
    }

    [Fact]
    public void CanHold_HeightMustLeaveMargin_ReturnsReason()
    {
        // chiều cao dùng được = 1,3 - 0,05 = 1,25; pallet cao 1,28 vượt
        Assert.Equal("Pallet cao hơn khung.", FloorSlot().CanHold(MakeRack(), PalletOf(1.1, 0.8, 1.28), Margin));
    }

    [Fact]
    public void CanHold_HeightExactlyEqualsUsableHeight_ReturnsNull()
    {
        Assert.Null(FloorSlot().CanHold(MakeRack(), PalletOf(1.1, 0.8, 1.25), Margin));
    }

    [Fact]
    public void CanHold_PalletHeavierThanSlot_ReturnsReason()
    {
        Assert.Equal("Pallet nặng hơn tải trọng khung.", FloorSlot().CanHold(MakeRack(), PalletOf(1.1, 0.8, 1.0, 1500), Margin));
    }

    [Fact]
    public void CanHold_WeightEqualsLimit_ReturnsNull()
    {
        Assert.Null(FloorSlot().CanHold(MakeRack(), PalletOf(1.1, 0.8, 1.0, 1000), Margin));
    }

    [Fact]
    public void CanHold_UnknownWeight_SkipsWeightCheck()
    {
        Assert.Null(FloorSlot().CanHold(MakeRack(), PalletOf(1.1, 0.8, 1.0, weight: null), Margin));
    }

    [Fact]
    public void CanHold_TooWideAndTooTall_ReportsFloorFirst()
    {
        Assert.Equal("Pallet rộng hơn khung.", FloorSlot().CanHold(MakeRack(), PalletOf(1.5, 1.5, 3.0), Margin));
    }

    [Fact]
    public void CanHold_NegativeMargin_Throws()
    {
        var ex = Assert.Throws<ArgumentException>(() => FloorSlot().CanHold(MakeRack(), PalletOf(1.1, 0.8, 1.0), -0.1));

        Assert.Equal("margin", ex.ParamName);
    }

    // ---- Place / Remove ----

    [Fact]
    public void Place_EmptySlot_SetsPalletAndLabelTogether()
    {
        var slot = FloorSlot();
        var pallet = PalletOf(1.1, 0.8, 1.0, code: "A");

        slot.Place(pallet);

        Assert.False(slot.IsEmpty);
        Assert.Equal(pallet.Id, slot.PalletId);
        Assert.Equal("A", slot.AssignedSize);
    }

    [Fact]
    public void Place_OccupiedSlot_Throws()
    {
        var slot = FloorSlot();
        slot.Place(PalletOf(1.1, 0.8, 1.0));

        Assert.Throws<InvalidOperationException>(() => slot.Place(PalletOf(1.0, 0.8, 1.0)));
    }

    [Fact]
    public void Remove_OccupiedSlot_ClearsPalletAndLabel()
    {
        var slot = FloorSlot();
        slot.Place(PalletOf(1.1, 0.8, 1.0));

        slot.Remove();

        Assert.True(slot.IsEmpty);
        Assert.Null(slot.PalletId);
        Assert.Null(slot.AssignedSize);
    }

    [Fact]
    public void Remove_EmptySlot_StaysEmpty()
    {
        var slot = FloorSlot();

        slot.Remove();

        Assert.True(slot.IsEmpty);
        Assert.Null(slot.AssignedSize);
    }

    [Fact]
    public void Slot_CanBeReusedAfterRemove()
    {
        var slot = FloorSlot();
        slot.Place(PalletOf(1.1, 0.8, 1.0, code: "A"));
        slot.Remove();

        slot.Place(PalletOf(1.0, 0.8, 1.2, code: "B"));

        Assert.Equal("B", slot.AssignedSize);
    }
}
