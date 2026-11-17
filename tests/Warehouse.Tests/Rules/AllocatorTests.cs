using Warehouse.Api.Models;
using Warehouse.Api.Rules;

namespace Warehouse.Tests.Rules;

// Khung rộng 1,2 × sâu 0,9; margin 0,05.
// Kệ thấp (cao tầng 1,3, dùng được 1,25): chỉ vừa pallet A (cao 1,0), không vừa B (cao 1,5).
// Kệ cao (cao tầng 1,8, dùng được 1,75): vừa cả A và B.
public class AllocatorTests
{
    private const double Margin = 0.05;

    private static Rack MakeRack(string code, int levels, int bays, double levelHeight,
                                 bool hasTop = false, int? productTypeId = null)
        => new(1, code, 0, 0, 0, levels, levelHeight, bays, 1.2, 0.9, hasTop, 1000, productTypeId);

    private static Rack LowRack(string code = "K1", int levels = 2, int bays = 3, bool hasTop = false, int? productTypeId = null)
        => MakeRack(code, levels, bays, 1.3, hasTop, productTypeId);

    private static Rack HighRack(string code = "K2", int levels = 2, int bays = 2, bool hasTop = false, int? productTypeId = null)
        => MakeRack(code, levels, bays, 1.8, hasTop, productTypeId);

    private static Pallet PalletOf(string code, double height = 1.0, double length = 1.0, double width = 0.8,
                                   int? productTypeId = null)
        => new(1, new PalletSize(height > 1.2 ? "B" : "A", length, width, height, "#888"), code, productTypeId);

    private static List<SlotCandidate> Candidates(params Rack[] racks)
        => racks.SelectMany(r => r.CreateSlots().Select(s => new SlotCandidate(r, s))).ToList();

    private static List<Pallet> Batch(string prefix, int count, double height = 1.0, int? productTypeId = null)
        => Enumerable.Range(1, count).Select(i => PalletOf($"{prefix}{i}", height, productTypeId: productTypeId)).ToList();

    [Fact]
    public void Allocate_SixAAndTwoB_AllPlaced_BNeverInLowRack()
    {
        // kệ cao (vừa B) liệt kê TRƯỚC: nếu xếp theo thứ tự đến, 6 pallet A sẽ chiếm hết chỗ của B
        var candidates = Candidates(HighRack("K2", levels: 2, bays: 2), LowRack("K1", levels: 2, bays: 3));
        var pallets = Batch("A", 6).Concat(Batch("B", 2, height: 1.5)).ToList();

        var result = Allocator.Allocate(pallets, candidates, Margin);

        Assert.Empty(result.Rejected);
        Assert.Equal(8, result.Placements.Count);
        Assert.All(
            result.Placements.Where(p => p.Pallet.Code.StartsWith("B")),
            p => Assert.Equal("K2", p.Target.Rack.Code));
    }

    [Fact]
    public void Allocate_EachSlotUsedByAtMostOnePallet()
    {
        var candidates = Candidates(HighRack(), LowRack());
        var pallets = Batch("A", 10);

        var result = Allocator.Allocate(pallets, candidates, Margin);

        Assert.Equal(10, result.Placements.Count);
        Assert.Equal(10, result.Placements.Select(p => p.Target.Slot.Code).Distinct().Count());
    }

    [Fact]
    public void Allocate_TallPalletGoesToTop_NormalPalletsDoNotTakeTopSlots()
    {
        // kệ 1 tầng × 2 ô có nóc: 2 khung thường + 2 khung nóc
        var candidates = Candidates(LowRack("K1", levels: 1, bays: 2, hasTop: true));
        var pallets = Batch("N", 2).Concat(new[] { PalletOf("TALL", height: 3.0) }).ToList();

        var result = Allocator.Allocate(pallets, candidates, Margin);

        Assert.Empty(result.Rejected);
        Assert.Single(result.ToTop);
        Assert.Equal("TALL", result.ToTop[0].Pallet.Code);
        Assert.All(result.Placements.Where(p => p.Pallet.Code.StartsWith("N")), p => Assert.False(p.IsTop));
    }

    [Fact]
    public void Allocate_TallPalletsBeyondTopSlots_AreRejectedAsFull()
    {
        var candidates = Candidates(LowRack("K1", levels: 1, bays: 2, hasTop: true));
        var pallets = Batch("TALL", 3, height: 3.0);

        var result = Allocator.Allocate(pallets, candidates, Margin);

        Assert.Equal(2, result.Placements.Count);
        var rejection = Assert.Single(result.Rejected);
        Assert.Equal(Allocator.FullReason, rejection.Reason);
    }

    [Fact]
    public void Allocate_PalletTooWide_RejectedWithReason()
    {
        var candidates = Candidates(LowRack());
        var tooWide = PalletOf("WIDE", length: 1.5, width: 1.5);

        var result = Allocator.Allocate(new[] { tooWide }, candidates, Margin);

        Assert.Empty(result.Placements);
        var rejection = Assert.Single(result.Rejected);
        Assert.Equal("WIDE", rejection.Pallet.Code);
        Assert.Equal("Pallet rộng hơn khung.", rejection.Reason);
    }

    [Fact]
    public void Allocate_MorePalletsThanSlots_RejectedCountEqualsShortage()
    {
        var candidates = Candidates(LowRack("K1", levels: 2, bays: 3)); // 6 khung
        var pallets = Batch("A", 9);

        var result = Allocator.Allocate(pallets, candidates, Margin);

        Assert.Equal(6, result.Placements.Count);
        Assert.Equal(3, result.Rejected.Count);
        Assert.All(result.Rejected, r => Assert.Equal(Allocator.FullReason, r.Reason));
    }

    [Fact]
    public void Allocate_RespectsProductType()
    {
        var screwsRack = LowRack("K1", productTypeId: 1);
        var generalRack = LowRack("K2", productTypeId: null);
        var candidates = Candidates(screwsRack, generalRack);
        var pallets = Batch("S", 2, productTypeId: 1).Concat(Batch("W", 2, productTypeId: 2)).ToList();

        var result = Allocator.Allocate(pallets, candidates, Margin);

        Assert.Empty(result.Rejected);
        Assert.All(
            result.Placements.Where(p => p.Pallet.ProductTypeId == 2),
            p => Assert.Equal("K2", p.Target.Rack.Code));
    }

    [Fact]
    public void Allocate_SameInputTwice_GivesSameResult()
    {
        var candidates = Candidates(HighRack(), LowRack());
        var pallets = Batch("A", 6).Concat(Batch("B", 2, height: 1.5)).ToList();

        var first = Allocator.Allocate(pallets, candidates, Margin);
        var second = Allocator.Allocate(pallets, candidates, Margin);

        Assert.Equal(
            first.Placements.Select(p => (p.Pallet.Code, p.Target.Slot.Code)),
            second.Placements.Select(p => (p.Pallet.Code, p.Target.Slot.Code)));
    }

    [Fact]
    public void Allocate_DoesNotChangeSlots()
    {
        var candidates = Candidates(HighRack(), LowRack());

        Allocator.Allocate(Batch("A", 6), candidates, Margin);

        Assert.All(candidates, c => Assert.True(c.Slot.IsEmpty));
    }

    [Fact]
    public void Allocate_NoPallets_ReturnsEmptyResult()
    {
        var result = Allocator.Allocate(new List<Pallet>(), Candidates(LowRack()), Margin);

        Assert.Empty(result.Placements);
        Assert.Empty(result.Rejected);
    }

    [Fact]
    public void Allocate_NoSlots_RejectsEveryPallet()
    {
        var result = Allocator.Allocate(Batch("A", 2), new List<SlotCandidate>(), Margin);

        Assert.Empty(result.Placements);
        Assert.Equal(2, result.Rejected.Count);
        Assert.All(result.Rejected, r => Assert.Equal(Allocator.NoSlotsReason, r.Reason));
    }

    [Fact]
    public void Allocate_ExistingOccupiedSlots_AreNotUsed()
    {
        var candidates = Candidates(LowRack("K1", levels: 1, bays: 2)); // 2 khung
        candidates[0].Slot.Place(PalletOf("OLD"));

        var result = Allocator.Allocate(Batch("A", 2), candidates, Margin);

        Assert.Single(result.Placements);
        Assert.Equal("K1-T1-R2", result.Placements[0].Target.Slot.Code);
        Assert.Single(result.Rejected);
    }

    // ---- xếp theo type: mỗi type một kệ, ngăn trống nguyên, phần dư nhét chỗ trống ----

    // Pallet có mã type và số đo tuỳ ý (PalletOf chỉ có hai type A/B).
    private static List<Pallet> Typed(string typeCode, int count, double length, double width, double height)
        => Enumerable.Range(1, count)
            .Select(i => new Pallet(1, new PalletSize(typeCode, length, width, height, "#888"), $"{typeCode}{i}"))
            .ToList();

    private static List<string> SlotsOf(AllocationResult result, string typePrefix)
        => result.Placements.Where(p => p.Pallet.Code.StartsWith(typePrefix)).Select(p => p.Target.Slot.Code).ToList();

    [Fact]
    public void Allocate_EachTypeGetsItsOwnRack_AndLeftoverFillsGapsOnlyWhenNoFreshRackIsLeft()
    {
        // 3 kệ, mỗi kệ 2 tầng × 3 ô = 6 khung. Lô: 4 pallet C (to nhất, xếp trước), 8 A, 5 D.
        var candidates = Candidates(LowRack("K1"), LowRack("K2"), LowRack("K3"));
        var pallets = Typed("A", 8, 1.0, 0.8, 1.0)
            .Concat(Typed("C", 4, 1.1, 0.85, 1.1))
            .Concat(Typed("D", 5, 0.6, 0.5, 0.5)).ToList();

        var result = Allocator.Allocate(pallets, candidates, Margin);

        Assert.Empty(result.Rejected);
        Assert.Equal(17, result.Placements.Count);
        // Duyệt trước mọi thứ tự type: mỗi type một kệ riêng (C K1, D K2, A K3); A có 8 pallet mà kệ chỉ 6 khung nên
        // 2 pallet A dư phải chen vào một tầng còn chỗ: chỉ đúng 1 tầng lẫn (thứ tự mặc định C, A, D cho 2 tầng lẫn).
        Assert.All(SlotsOf(result, "C"), c => Assert.StartsWith("K1-", c));
        Assert.All(SlotsOf(result, "D"), c => Assert.StartsWith("K2-", c));
        Assert.Equal(6, SlotsOf(result, "A").Count(c => c.StartsWith("K3-")));
        Assert.Equal(1, MixedLevels(candidates, result));
    }

    [Fact]
    public void Allocate_PrefersAWhollyEmptyLevelOverAGapInAnotherLevel()
    {
        // K1: 2 tầng × 3 ô. Tầng 1 đã có 1 pallet loại A (còn 2 chỗ lẻ), tầng 2 trống nguyên. Không còn kệ nào khác.
        // Pallet type D (khác A): theo thứ tự kệ → tầng → ô sẽ vào chỗ lẻ K1-T1-R2; luật mới ưu tiên ngăn trống nguyên K1-T2-R1.
        var candidates = Candidates(LowRack("K1"));
        candidates[0].Slot.Place(Typed("A", 1, 1.0, 0.8, 1.0)[0]);

        var result = Allocator.Allocate(Typed("D", 1, 0.6, 0.5, 0.5), candidates, Margin);

        Assert.Equal("K1-T2-R1", Assert.Single(result.Placements).Target.Slot.Code);
    }

    [Fact]
    public void Allocate_KeepsFillingARackThatAlreadyHoldsTheSameType_BeforeUsingAFreshRack()
    {
        var candidates = Candidates(LowRack("K1"), LowRack("K2"));
        candidates[0].Slot.Place(Typed("A", 1, 1.0, 0.8, 1.0)[0]);

        var result = Allocator.Allocate(Typed("A", 2, 1.0, 0.8, 1.0), candidates, Margin);

        Assert.All(result.Placements, p => Assert.Equal("K1", p.Target.Rack.Code));
    }

    [Fact]
    public void Allocate_TopSlotsOfAnyRackComeAfterNormalSlotsOfEveryRack()
    {
        // K1 (có nóc) liệt kê trước K2 (tầng cao). Pallet cao 1,5 m vừa nóc K1 và khung thường K2: phải vào K2.
        var candidates = Candidates(LowRack("K1", levels: 1, bays: 2, hasTop: true), HighRack("K2", levels: 1, bays: 2));

        var result = Allocator.Allocate(Batch("B", 1, height: 1.5), candidates, Margin);

        var placed = Assert.Single(result.Placements);
        Assert.Equal("K2", placed.Target.Rack.Code);
        Assert.False(placed.IsTop);
    }

    [Fact]
    public void Allocate_TypesAlreadyInTheWarehouseGoFirst_SoNewTypesCannotTakeTheirGaps()
    {
        // K1 (6 khung) đang giữ 4 pallet A, còn 2 chỗ trống; K2 đã đầy loại C. Lô mới: 2 pallet A (đã có trong kho) và 2 pallet D
        // (type mới, thể tích lớn hơn A nên nếu chỉ xếp theo kích cỡ thì D đi trước và chiếm mất 2 chỗ trống của K1).
        var k1 = LowRack("K1");
        var k2 = LowRack("K2");
        var candidates = Candidates(k1, k2);
        foreach (var c in candidates.Where(c => c.Rack == k1).Take(4))
            c.Slot.Place(Typed("A", 1, 1.0, 0.8, 1.0)[0]);
        foreach (var c in candidates.Where(c => c.Rack == k2))
            c.Slot.Place(Typed("C", 1, 1.0, 0.8, 1.0)[0]);
        var pallets = Typed("D", 2, 1.1, 0.85, 1.1).Concat(Typed("A", 2, 1.0, 0.8, 1.0)).ToList();

        var result = Allocator.Allocate(pallets, candidates, Margin);

        Assert.Equal(2, result.Placements.Count);
        Assert.All(result.Placements, p => Assert.StartsWith("A", p.Pallet.Code));
        Assert.All(result.Placements, p => Assert.Equal("K1", p.Target.Rack.Code));
        Assert.Equal(2, result.Rejected.Count(r => r.Pallet.Code.StartsWith("D")));
    }

    [Fact]
    public void Allocate_AMixedRackDoesNotAttractMoreOfItsTypes_WhileAnEmptyRackExists()
    {
        // K1 đã lẫn 2 loại E và D (còn 3 chỗ trống); K2 còn trống hẳn. Pallet D mới không được nhét tiếp vào K1 chỉ vì K1
        // đã có D (làm D và E tranh nhau một kệ): phải sang kệ trống K2.
        var k1 = LowRack("K1");
        var k2 = LowRack("K2");
        var candidates = Candidates(k1, k2);
        var inK1 = candidates.Where(c => c.Rack == k1).ToList();
        inK1[0].Slot.Place(Typed("E", 1, 1.0, 0.8, 1.0)[0]);
        inK1[1].Slot.Place(Typed("E", 1, 1.0, 0.8, 1.0)[0]);
        inK1[2].Slot.Place(Typed("D", 1, 1.0, 0.8, 1.0)[0]);

        var result = Allocator.Allocate(Typed("D", 2, 1.0, 0.8, 1.0), candidates, Margin);

        Assert.Equal(2, result.Placements.Count);
        Assert.All(result.Placements, p => Assert.Equal("K2", p.Target.Rack.Code));
    }

    // ---- bước 1 giữ chỗ cho chủ kệ, nóc không tính, kệ lẫn trước kệ sạch, ô sát bên ----

    private static void Fill(List<SlotCandidate> slotsOfRack, IEnumerable<int> indexes, string typeCode, double height = 1.0)
    {
        foreach (var i in indexes)
            slotsOfRack[i].Slot.Place(Typed(typeCode, 1, 1.0, 0.8, height)[0]);
    }

    [Fact]
    public void Allocate_SecondBatchIntoAFullishWarehouse_KeepsOwnRacksCleanAndMixesOnlyOneRack()
    {
        // Tái hiện ảnh lô b29: 3 kệ 3 tầng × 4 ô có nóc. Chỉ số khung: 0–3 tầng 1, 4–7 tầng 2, 8–11 tầng 3, 12–15 nóc.
        // K1: 11 A (trống T3-R4), nóc 4 B. K2: tầng 1 là E, nóc 4 B. K3: 6 D (tầng 1 + T2-R1, R2), nóc R1 là B.
        var k1 = LowRack("K1", levels: 3, bays: 4, hasTop: true);
        var k2 = LowRack("K2", levels: 3, bays: 4, hasTop: true);
        var k3 = LowRack("K3", levels: 3, bays: 4, hasTop: true);
        var candidates = Candidates(k1, k2, k3);
        var in1 = candidates.Where(c => c.Rack == k1).ToList();
        var in2 = candidates.Where(c => c.Rack == k2).ToList();
        var in3 = candidates.Where(c => c.Rack == k3).ToList();
        Fill(in1, Enumerable.Range(0, 11), "A");
        Fill(in1, Enumerable.Range(12, 4), "B", height: 3.0);
        Fill(in2, Enumerable.Range(0, 4), "E");
        Fill(in2, Enumerable.Range(12, 4), "B", height: 3.0);
        Fill(in3, Enumerable.Range(0, 6), "D");
        Fill(in3, new[] { 12 }, "B", height: 3.0);
        var pallets = Typed("A", 3, 1.0, 0.8, 1.0)
            .Concat(Typed("E", 9, 1.0, 0.8, 1.0))
            .Concat(Typed("D", 3, 1.0, 0.8, 1.0))
            .Concat(Typed("B", 3, 1.0, 0.8, 3.0)).ToList();

        var result = Allocator.Allocate(pallets, candidates, Margin);

        Assert.Empty(result.Rejected);
        // K2 nhận đủ 8 E (bước 1 giữ chỗ cho chủ kệ), A dư không chen vào K2 nữa.
        Assert.Equal(8, SlotsOf(result, "E").Count(c => c.StartsWith("K2-")));
        Assert.Equal("K1-T3-R4", Assert.Single(SlotsOf(result, "A"), c => c.StartsWith("K1-")));
        // Chỉ K3 phải lẫn: 2 A còn dư nằm sát nhau ở tầng 3, rồi 1 E còn dư.
        Assert.Equal(new[] { "K3-T3-R2", "K3-T3-R3" }, SlotsOf(result, "A").Where(c => c.StartsWith("K3-")));
        Assert.Equal("K3-T3-R4", Assert.Single(SlotsOf(result, "E"), c => c.StartsWith("K3-")));
        Assert.All(SlotsOf(result, "B"), c => Assert.StartsWith("K3-N-", c));
    }

    [Fact]
    public void Allocate_PalletsOnTheTopSlot_DoNotMakeARackMixed()
    {
        // K1: thân có A, nóc có B. Trước đây K1 bị coi là lẫn {A, B} nên A mới chạy sang kệ trống K2.
        var k1 = LowRack("K1", levels: 1, bays: 2, hasTop: true);
        var candidates = Candidates(k1, LowRack("K2", levels: 1, bays: 2));
        var in1 = candidates.Where(c => c.Rack == k1).ToList();
        Fill(in1, new[] { 0 }, "A");
        Fill(in1, new[] { 2 }, "B", height: 3.0);

        var result = Allocator.Allocate(Typed("A", 1, 1.0, 0.8, 1.0), candidates, Margin);

        Assert.Equal("K1-T1-R2", Assert.Single(result.Placements).Target.Slot.Code);
    }

    [Fact]
    public void Allocate_WhenNoEmptyRackIsLeft_PrefersAnAlreadyMixedRackOverACleanRackOfAnotherType()
    {
        // K2 (liệt kê trước) chỉ có E; K1 đã lẫn A và D. Pallet C mới: nhét vào K1 (vốn đã lẫn), không làm bẩn K2.
        var k1 = LowRack("K1", levels: 1, bays: 3);
        var k2 = LowRack("K2", levels: 1, bays: 3);
        var candidates = Candidates(k2, k1);
        Fill(candidates.Where(c => c.Rack == k2).ToList(), new[] { 0 }, "E");
        var in1 = candidates.Where(c => c.Rack == k1).ToList();
        Fill(in1, new[] { 0 }, "A");
        Fill(in1, new[] { 1 }, "D");

        var result = Allocator.Allocate(Typed("C", 1, 1.0, 0.8, 1.0), candidates, Margin);

        Assert.Equal("K1-T1-R3", Assert.Single(result.Placements).Target.Slot.Code);
    }

    [Fact]
    public void Allocate_LeftoverGoesToAnEmptyLevel_NotIntoALevelOfAnotherType()
    {
        // Tái hiện lô b32: 3 kệ 3 tầng × 4 ô. K1 có 7 A (T1 đủ, T2 ba ô), K2 có E ở T1, K3 đầy D. Lô: 6 D.
        // D không chen vào ô K1-T2-R4 (tầng của A) mà vào tầng trống nguyên: K1-T3 rồi K2-T2.
        var k1 = LowRack("K1", levels: 3, bays: 4);
        var k2 = LowRack("K2", levels: 3, bays: 4);
        var k3 = LowRack("K3", levels: 3, bays: 4);
        var candidates = Candidates(k1, k2, k3);
        Fill(candidates.Where(c => c.Rack == k1).ToList(), Enumerable.Range(0, 7), "A");
        Fill(candidates.Where(c => c.Rack == k2).ToList(), Enumerable.Range(0, 4), "E");
        Fill(candidates.Where(c => c.Rack == k3).ToList(), Enumerable.Range(0, 12), "D");

        var result = Allocator.Allocate(Typed("D", 6, 1.0, 0.8, 1.0), candidates, Margin);

        Assert.Empty(result.Rejected);
        Assert.DoesNotContain("K1-T2-R4", SlotsOf(result, "D"));
        Assert.Equal(
            new[] { "K1-T3-R1", "K1-T3-R2", "K1-T3-R3", "K1-T3-R4", "K2-T2-R1", "K2-T2-R2" },
            SlotsOf(result, "D"));
    }

    [Fact]
    public void Allocate_ReservedSlots_AreTreatedAsOccupied()
    {
        // Khung đầu được lượt trước (Distributor) giữ cho type C: không xếp vào đó, và kệ coi như đã có C.
        var candidates = Candidates(LowRack("K1", levels: 1, bays: 3), LowRack("K2", levels: 1, bays: 3));
        var reserved = new Dictionary<Slot, string> { [candidates[0].Slot] = "C" };

        var result = Allocator.Allocate(Typed("A", 1, 1.0, 0.8, 1.0), candidates, Margin, reserved);

        Assert.Equal("K2", Assert.Single(result.Placements).Target.Rack.Code);   // K1 đã "có" C nên A sang kệ trống
    }

    // Số tầng (khung thường) có từ 2 type trở lên sau khi xếp, tính cả hàng đã có sẵn trong khung.
    private static int MixedLevels(List<SlotCandidate> candidates, AllocationResult result)
    {
        var typeOf = candidates.Where(c => c.Slot.AssignedSize is not null).ToDictionary(c => c.Slot, c => c.Slot.AssignedSize!);
        foreach (var p in result.Placements)
            typeOf[p.Target.Slot] = p.Pallet.Size.Code;
        return candidates
            .Where(c => !c.Slot.IsTop)
            .GroupBy(c => (c.Rack, c.Slot.Level))
            .Count(level => level.Where(c => typeOf.ContainsKey(c.Slot)).Select(c => typeOf[c.Slot]).Distinct().Count() > 1);
    }

    [Fact]
    public void Allocate_Room3Batch36_ProducesOnlyOneMixedLevel()
    {
        // Lô thật b36 (2026-11-12, người dùng chụp ảnh "Phòng 3"): kho trống, 2 kệ đều 4 ô × rộng 2,2 m × sâu 1 m,
        // cao tầng 1,2 m, có nóc. K1 3 tầng, K2 4 tầng: 28 khung thường + 8 khung nóc. Lô (thứ tự nhập như màn Nhập hàng):
        //   15 A 1,2 × 0,8 × 1,0 · 2 B 1,2 × 0,8 × 1,6 (chỉ lên nóc) · 5 E 1,0 × 0,8 × 0,9 · 8 D 0,8 × 0,6 × 0,7.
        // Thuật toán tham lam cũ xếp E trước D: E chiếm K2-T2 rồi mở cả tầng T3 cho 1 pallet lẻ, D phải chen vào T1 và T3
        // → 2 tầng lẫn. Tốt nhất có thể là 1 tầng lẫn: E có 5 pallet mà một tầng chỉ 4 ô, và mọi tầng trống khác cần cho D
        // (D chiếm trọn T3 + T4 hoặc T2 + T3, E lẻ một pallet vào T1-R4 cạnh A).
        var k1 = new Rack(1, "K1", 0, 0, 0, 3, 1.2, 4, 2.2, 1.0, true, 1000, null);
        var k2 = new Rack(1, "K2", 0, 0, 0, 4, 1.2, 4, 2.2, 1.0, true, 1000, null);
        var candidates = Candidates(k1, k2);
        var pallets = Typed("A", 15, 1.2, 0.8, 1.0)
            .Concat(Typed("B", 2, 1.2, 0.8, 1.6))
            .Concat(Typed("E", 5, 1.0, 0.8, 0.9))
            .Concat(Typed("D", 8, 0.8, 0.6, 0.7)).ToList();

        var result = Allocator.Allocate(pallets, candidates, Margin);

        Assert.Empty(result.Rejected);
        Assert.Equal(30, result.Placements.Count);
        Assert.All(SlotsOf(result, "B"), c => Assert.Contains("-N-", c));                 // B chỉ lên nóc
        Assert.Equal(12, SlotsOf(result, "A").Count(c => c.StartsWith("K1-")));           // A lấp kín K1
        Assert.Equal(1, MixedLevels(candidates, result));
    }

    // Số type nhiều nhất trên một tầng (khung thường) sau khi xếp, tính cả hàng đã có sẵn.
    private static int MaxTypesOnALevel(List<SlotCandidate> candidates, AllocationResult result)
    {
        var typeOf = candidates.Where(c => c.Slot.AssignedSize is not null).ToDictionary(c => c.Slot, c => c.Slot.AssignedSize!);
        foreach (var p in result.Placements)
            typeOf[p.Target.Slot] = p.Pallet.Size.Code;
        return candidates
            .Where(c => !c.Slot.IsTop)
            .GroupBy(c => (c.Rack, c.Slot.Level))
            .Max(level => level.Where(c => typeOf.ContainsKey(c.Slot)).Select(c => typeOf[c.Slot]).Distinct().Count());
    }

    [Fact]
    public void Allocate_Room1Batch46_NoLevelHoldsThreeTypes()
    {
        // Lô thật b46 (2026-11-13, "Phòng 1" chụp ảnh): kho đã có lô b44, b45, chỉ còn 29 khung thường trống rải rác
        // mà lô có 30 pallet (15 A 1,2×0,8×1,0 · 2 B 1,2×0,8×1,6 · 5 E 1,0×0,8×0,9 · 8 D 0,8×0,6×0,7), nên đúng 1 pallet
        // phải lên nóc. Bản cũ (duyệt thứ tự type, chọn ô tham lam) cho K4 tầng 2 = B B A D: 3 type một tầng.
        // Tốt hơn: cái A dư lên nóc, K4 tầng 2 = B B D D. K3 cao tầng 1,0 m nên A (1,0 m) không vào được K3.
        Rack R(string code, int levels, double levelHeight, int bays, bool hasTop, double maxWeight = 1000)
            => new(1, code, 0, 0, 0, levels, levelHeight, bays, 1.2, 1.0, hasTop, maxWeight, null);
        var racks = new[]
        {
            R("K1", 2, 1.5, 4, true), R("K2", 3, 1.2, 4, true), R("K3", 4, 1.0, 4, false), R("K4", 2, 1.8, 4, true, 2000),
            R("K5", 3, 1.2, 4, false), R("K6", 3, 1.5, 4, true), R("K8", 3, 1.2, 3, true), R("K9", 3, 1.2, 4, true),
        };
        // Như PalletService.PlacementOrder: khung thường của mọi kệ trước, nóc của mọi kệ sau.
        var candidates = Candidates(racks).OrderBy(c => c.Slot.IsTop).ToList();
        List<SlotCandidate> Of(string code) => candidates.Where(c => c.Rack.Code == code && !c.Slot.IsTop).ToList();
        void Put(string rack, string type, double l, double w, double h, params int[] indexes)
        {
            var slots = Of(rack);
            foreach (var i in indexes)
                slots[i].Slot.Place(Typed(type, 1, l, w, h)[0]);
        }
        // Trạng thái trước lô b46 (lô b44, b45). Chỉ số = (tầng - 1) × số ô + (ô - 1).
        Put("K1", "A", 1.2, 0.8, 1.0, Enumerable.Range(0, 8).ToArray());
        Put("K2", "A", 1.2, 0.8, 1.0, Enumerable.Range(0, 12).ToArray());
        Put("K3", "E", 1.0, 0.8, 0.9, Enumerable.Range(0, 10).ToArray());     // T1, T2 đủ; T3 R1, R2
        Put("K4", "B", 1.2, 0.8, 1.6, 0, 1, 2, 3);                            // T1
        Put("K5", "D", 0.8, 0.6, 0.7, Enumerable.Range(0, 12).ToArray());
        Put("K6", "A", 1.2, 0.8, 1.0, Enumerable.Range(0, 10).ToArray());     // T1, T2 đủ; T3 R1, R2
        Put("K8", "D", 0.8, 0.6, 0.7, 0, 1, 2, 3);                            // T1 đủ; T2 R1
        var pallets = Typed("A", 15, 1.2, 0.8, 1.0)
            .Concat(Typed("B", 2, 1.2, 0.8, 1.6))
            .Concat(Typed("E", 5, 1.0, 0.8, 0.9))
            .Concat(Typed("D", 8, 0.8, 0.6, 0.7)).ToList();

        var result = Allocator.Allocate(pallets, candidates, Margin);

        Assert.Empty(result.Rejected);
        Assert.Equal(30, result.Placements.Count);
        Assert.Single(result.ToTop);                                   // 29 khung thường cho 30 pallet: đúng 1 lên nóc
        Assert.Equal(2, MaxTypesOnALevel(candidates, result));         // không tầng nào 3 type
        Assert.Equal(2, MixedLevels(candidates, result));              // K3 T4 (E, D) bắt buộc lẫn; K4 T2 (B, D)
    }

    // "Phòng 3" ngay trước lô b77 (2026-11-13): 3 kệ có nóc, ô rộng 2,2 m (K1, K2) và 1,2 m (K3), cao tầng 1,2 m.
    // Còn 12 khung thường (K1 T2 ba ô, K1 T3, K2 T4 một ô, K3 T3) + 10 khung nóc (K1 hai ô, K2, K3).
    private static List<SlotCandidate> Room3BeforeBatch77()
    {
        Rack R(string code, int levels, double bayWidth) => new(1, code, 0, 0, 0, levels, 1.2, 4, bayWidth, 1.0, true, 1000, null);
        var candidates = Candidates(R("K1", 3, 2.2), R("K2", 4, 2.2), R("K3", 3, 1.2))
            .OrderBy(c => c.Slot.IsTop).ToList();   // như PalletService.PlacementOrder
        void Put(string rack, bool top, string type, double l, double w, double h, params int[] indexes)
        {
            var slots = candidates.Where(c => c.Rack.Code == rack && c.Slot.IsTop == top).ToList();
            foreach (var i in indexes)
                slots[i].Slot.Place(Typed(type, 1, l, w, h)[0]);
        }
        // Lô b76. Chỉ số khung thường = (tầng - 1) × 4 + (ô - 1); nóc 0..3.
        Put("K1", false, "E", 1.0, 0.8, 0.9, 0, 1, 2, 3, 4);                    // T1 đủ, T2 R1
        Put("K1", true, "B", 1.2, 0.8, 1.6, 0, 1);                              // nóc R1, R2
        Put("K2", false, "A", 1.2, 0.8, 1.0, Enumerable.Range(0, 15).ToArray()); // T1–T3 đủ, T4 R1–R3
        Put("K3", false, "D", 0.8, 0.6, 0.7, Enumerable.Range(0, 8).ToArray());  // T1, T2
        return candidates;
    }

    // Số hàng nóc (của từng kệ) có từ 2 type trở lên sau khi xếp, tính cả hàng đã có sẵn.
    private static int MixedTopRows(List<SlotCandidate> candidates, AllocationResult result)
    {
        var typeOf = candidates.Where(c => c.Slot.AssignedSize is not null).ToDictionary(c => c.Slot, c => c.Slot.AssignedSize!);
        foreach (var p in result.Placements)
            typeOf[p.Target.Slot] = p.Pallet.Size.Code;
        return candidates
            .Where(c => c.Slot.IsTop)
            .GroupBy(c => c.Rack)
            .Count(row => row.Where(c => typeOf.ContainsKey(c.Slot)).Select(c => typeOf[c.Slot]).Distinct().Count() > 1);
    }

    [Fact]
    public void Allocate_Room3Batch77_FullLot_LeavesTheLoneEBehindSoNoRoofIsMixed()
    {
        // Lô b77 thật: 30 pallet (14 A, 7 B 1,6 m chỉ vừa nóc, 4 E, 5 D) mà kho chỉ còn 22 chỗ: 8 pallet phải ở lại lô.
        // Chọn để lại pallet nào cho kho gọn nhất: khung thường không lẫn tầng nào, và để lại cái E lẻ (thay vì một
        // cái A) thì không hàng nóc nào lẫn (nóc K1 = B, nóc K2 = B, nóc K3 = A).
        var candidates = Room3BeforeBatch77();
        var pallets = Typed("A", 14, 1.2, 0.8, 1.0)
            .Concat(Typed("B", 7, 1.2, 0.8, 1.6))
            .Concat(Typed("E", 4, 1.0, 0.8, 0.9))
            .Concat(Typed("D", 5, 0.8, 0.6, 0.7)).ToList();

        var result = Allocator.Allocate(pallets, candidates, Margin);

        Assert.Equal(22, result.Placements.Count);
        Assert.Equal(8, result.Rejected.Count);
        Assert.All(result.Rejected, r => Assert.Equal(Allocator.FullReason, r.Reason));
        Assert.Equal(10, result.ToTop.Count);
        Assert.Equal(0, MixedLevels(candidates, result));
        Assert.Equal(0, MixedTopRows(candidates, result));
    }

    [Fact]
    public void Allocate_Room3Batch77_LoneTopPalletGoesOnTheRoofOfItsOwnTypesRack()
    {
        // Chỉ 22 pallet đã xếp được của lô b77 (14 A, 4 E, 4 D): vừa đủ 12 khung thường + 10 nóc, đúng 10 lên nóc.
        // Khung thường xếp không lẫn tầng nào; E còn 1 cái phải lên nóc. Bản cũ chấm điểm bỏ qua nóc nên E lên nóc K2
        // (giữa các A); đúng ra phải lên nóc K1, ngay trên các E của nó.
        var candidates = Room3BeforeBatch77();
        var pallets = Typed("A", 14, 1.2, 0.8, 1.0)
            .Concat(Typed("E", 4, 1.0, 0.8, 0.9))
            .Concat(Typed("D", 4, 0.8, 0.6, 0.7)).ToList();

        var result = Allocator.Allocate(pallets, candidates, Margin);

        Assert.Empty(result.Rejected);
        Assert.Equal(22, result.Placements.Count);
        Assert.Equal(10, result.ToTop.Count);
        Assert.Equal(0, MixedLevels(candidates, result));                       // khung thường: không tầng nào lẫn
        var eOnTop = Assert.Single(result.ToTop, p => p.Pallet.Size.Code == "E");
        Assert.Equal("K1", eOnTop.Target.Rack.Code);                            // E lẻ lên nóc kệ của E
        Assert.All(result.ToTop.Where(p => p.Target.Rack.Code != "K1"), p => Assert.Equal("A", p.Pallet.Size.Code));
    }

    [Fact]
    public void Allocate_InAMixedRack_PicksTheEmptySlotRightNextToTheSameType()
    {
        // K1 tầng 1: [trống][D][A][trống], tầng 2 trống nguyên. Pallet A mới vào ô sát A (T1-R4), không vào R1 hay tầng 2.
        var candidates = Candidates(LowRack("K1", levels: 2, bays: 4));
        Fill(candidates, new[] { 1 }, "D");
        Fill(candidates, new[] { 2 }, "A");

        var result = Allocator.Allocate(Typed("A", 1, 1.0, 0.8, 1.0), candidates, Margin);

        Assert.Equal("K1-T1-R4", Assert.Single(result.Placements).Target.Slot.Code);
    }
}
