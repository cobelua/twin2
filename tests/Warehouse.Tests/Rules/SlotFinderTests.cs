using Warehouse.Api.Models;
using Warehouse.Api.Rules;

namespace Warehouse.Tests.Rules;

// Kệ mẫu: khung rộng 1,2 × sâu 0,9, cao tầng 1,3, tải 1000 kg. Pallet mặc định 1,0 × 0,8 × 1,0.
public class SlotFinderTests
{
    private const double Margin = 0.05;

    private static Rack MakeRack(string code = "K1", int levels = 2, int bays = 3, bool hasTop = false, int? productTypeId = null)
        => new(1, code, 0, 0, 0, levels, 1.3, bays, 1.2, 0.9, hasTop, 1000, productTypeId);

    private static Pallet PalletOf(double length = 1.0, double width = 0.8, double height = 1.0,
                                   int? productTypeId = null, string code = "b1-P001")
        => new(1, new PalletSize("A", length, width, height, "#888"), code, productTypeId);

    private static List<SlotCandidate> Candidates(Rack rack)
        => rack.CreateSlots().Select(s => new SlotCandidate(rack, s)).ToList();

    [Fact]
    public void Find_AllSlotsFitAndEmpty_ReturnsAllAsFree()
    {
        var candidates = Candidates(MakeRack());

        var result = SlotFinder.Find(candidates, PalletOf(), Margin);

        Assert.Equal(6, result.FreeSlots.Count);
        Assert.Equal(6, result.FittingCount);
        Assert.Empty(result.RejectionReasons);
    }

    [Fact]
    public void Find_OccupiedSlots_AreFittingButNotFree()
    {
        var candidates = Candidates(MakeRack());
        candidates[0].Slot.Place(PalletOf(code: "b1-P900"));
        candidates[1].Slot.Place(PalletOf(code: "b1-P901"));

        var result = SlotFinder.Find(candidates, PalletOf(), Margin);

        Assert.Equal(4, result.FreeSlots.Count);
        Assert.Equal(6, result.FittingCount);
        Assert.DoesNotContain(result.FreeSlots, c => !c.Slot.IsEmpty);
    }

    [Fact]
    public void Find_FittingSlotsAllFull_HasFittingButNoFree()
    {
        var candidates = Candidates(MakeRack());
        foreach (var c in candidates)
            c.Slot.Place(PalletOf(code: "b1-P900"));

        var result = SlotFinder.Find(candidates, PalletOf(), Margin);

        Assert.True(result.HasAnyFittingSlot);
        Assert.Empty(result.FreeSlots);
        Assert.Equal(6, result.FittingCount);
    }

    [Fact]
    public void Find_PalletTooWide_NoFittingSlotAndReportsReason()
    {
        var result = SlotFinder.Find(Candidates(MakeRack()), PalletOf(length: 1.5, width: 1.5), Margin);

        Assert.False(result.HasAnyFittingSlot);
        Assert.Empty(result.FreeSlots);
        Assert.Equal(new[] { "Pallet rộng hơn khung." }, result.RejectionReasons);
    }

    [Fact]
    public void Find_TallPallet_OnlyTopSlotsFit()
    {
        var candidates = Candidates(MakeRack(levels: 2, bays: 3, hasTop: true));

        var result = SlotFinder.Find(candidates, PalletOf(height: 3.0), Margin);

        Assert.Equal(3, result.FreeSlots.Count);
        Assert.All(result.FreeSlots, c => Assert.True(c.Slot.IsTop));
        Assert.Equal(3, result.FittingCount);
        Assert.Contains("Pallet cao hơn khung.", result.RejectionReasons);
    }

    [Fact]
    public void Find_TallPalletWithoutTopSlots_NoFittingSlot()
    {
        var result = SlotFinder.Find(Candidates(MakeRack(hasTop: false)), PalletOf(height: 3.0), Margin);

        Assert.False(result.HasAnyFittingSlot);
        Assert.Equal(new[] { "Pallet cao hơn khung." }, result.RejectionReasons);
    }

    [Fact]
    public void Find_SpecializedRackOfOtherProductType_IsRejected()
    {
        var candidates = Candidates(MakeRack(productTypeId: 1));

        var result = SlotFinder.Find(candidates, PalletOf(productTypeId: 2), Margin);

        Assert.False(result.HasAnyFittingSlot);
        Assert.Equal(new[] { "Kệ chỉ dành cho loại hàng khác." }, result.RejectionReasons);
    }

    [Fact]
    public void Find_MixOfSpecializedAndGeneralRacks_RespectsProductType()
    {
        var screws = MakeRack("K1", productTypeId: 1);
        var general = MakeRack("K2", productTypeId: null);
        var candidates = Candidates(screws).Concat(Candidates(general)).ToList();

        var forScrews = SlotFinder.Find(candidates, PalletOf(productTypeId: 1), Margin);
        var forWheels = SlotFinder.Find(candidates, PalletOf(productTypeId: 2), Margin);

        Assert.Equal(12, forScrews.FreeSlots.Count);
        Assert.Equal(6, forWheels.FreeSlots.Count);
        Assert.All(forWheels.FreeSlots, c => Assert.Equal("K2", c.Rack.Code));
    }

    [Fact]
    public void Find_KeepsInputOrder()
    {
        var candidates = Candidates(MakeRack("K1", levels: 1, bays: 2))
            .Concat(Candidates(MakeRack("K2", levels: 1, bays: 2)))
            .ToList();

        var result = SlotFinder.Find(candidates, PalletOf(), Margin);

        Assert.Equal(
            new[] { "K1-T1-R1", "K1-T1-R2", "K2-T1-R1", "K2-T1-R2" },
            result.FreeSlots.Select(c => c.Slot.Code));
    }

    [Fact]
    public void Find_SameReasonFromManySlots_IsListedOnce()
    {
        var candidates = Candidates(MakeRack("K1")).Concat(Candidates(MakeRack("K2"))).ToList();

        var result = SlotFinder.Find(candidates, PalletOf(length: 1.5, width: 1.5), Margin);

        Assert.Single(result.RejectionReasons);
    }

    [Fact]
    public void Find_DoesNotChangeSlots()
    {
        var candidates = Candidates(MakeRack());

        SlotFinder.Find(candidates, PalletOf(), Margin);

        Assert.All(candidates, c => Assert.True(c.Slot.IsEmpty));
    }

    [Fact]
    public void Find_NoCandidates_ReturnsEmptyResult()
    {
        var result = SlotFinder.Find(new List<SlotCandidate>(), PalletOf(), Margin);

        Assert.Empty(result.FreeSlots);
        Assert.Equal(0, result.FittingCount);
        Assert.Empty(result.RejectionReasons);
    }

    [Fact]
    public void Find_NullPallet_Throws()
    {
        var ex = Assert.Throws<ArgumentNullException>(() => SlotFinder.Find(new List<SlotCandidate>(), null!, Margin));

        Assert.Equal("pallet", ex.ParamName);
    }
}
