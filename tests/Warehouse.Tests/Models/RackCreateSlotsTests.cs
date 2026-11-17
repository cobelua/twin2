using Warehouse.Api.Models;

namespace Warehouse.Tests.Models;

public class RackCreateSlotsTests
{
    private static Rack Make(int levels, int bays, bool hasTop, string code = "K1")
        => new(1, code, 2, 2, 0, levels, 1.3, bays, 1.35, 1.1, hasTop, 1000);

    [Fact]
    public void CreateSlots_3BaysX4LevelsWithTop_Returns15Slots()
    {
        var slots = Make(levels: 4, bays: 3, hasTop: true).CreateSlots();

        Assert.Equal(15, slots.Count);
        Assert.Equal("K1-T1-R1", slots[0].Code);
        Assert.Equal("K1-N-R3", slots[^1].Code);
    }

    [Fact]
    public void CreateSlots_WithoutTop_ReturnsLevelsTimesBaysAndNoTopSlot()
    {
        var slots = Make(levels: 2, bays: 3, hasTop: false).CreateSlots();

        Assert.Equal(6, slots.Count);
        Assert.DoesNotContain(slots, s => s.IsTop);
    }

    [Fact]
    public void CreateSlots_TopSlots_HaveLevelAboveLastLevel()
    {
        var slots = Make(levels: 4, bays: 3, hasTop: true).CreateSlots();

        var top = slots.Where(s => s.IsTop).ToList();

        Assert.Equal(3, top.Count);
        Assert.All(top, s => Assert.Equal(5, s.Level));
        Assert.Equal(new[] { 1, 2, 3 }, top.Select(s => s.Bay));
    }

    [Fact]
    public void CreateSlots_OrderIsLevelThenBay_TopLast()
    {
        var codes = Make(levels: 2, bays: 2, hasTop: true).CreateSlots().Select(s => s.Code);

        Assert.Equal(
            new[] { "K1-T1-R1", "K1-T1-R2", "K1-T2-R1", "K1-T2-R2", "K1-N-R1", "K1-N-R2" },
            codes);
    }

    [Fact]
    public void CreateSlots_CodesAreUnique()
    {
        var slots = Make(levels: 4, bays: 3, hasTop: true).CreateSlots();

        Assert.Equal(slots.Count, slots.Select(s => s.Code).Distinct().Count());
    }

    [Fact]
    public void CreateSlots_UsesRackCodeAsPrefix()
    {
        var slots = Make(levels: 1, bays: 1, hasTop: false, code: "K7").CreateSlots();

        Assert.Equal("K7-T1-R1", slots[0].Code);
    }

    [Fact]
    public void CreateSlots_AllSlotsStartEmpty()
    {
        var slots = Make(levels: 2, bays: 2, hasTop: true).CreateSlots();

        Assert.All(slots, s =>
        {
            Assert.Null(s.AssignedSize);
            Assert.Null(s.PalletId);
        });
    }
}
