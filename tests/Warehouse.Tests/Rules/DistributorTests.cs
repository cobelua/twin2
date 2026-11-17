using Warehouse.Api.Models;
using Warehouse.Api.Rules;

namespace Warehouse.Tests.Rules;

// Mỗi kho có một kệ thấp (cao tầng 1,3) 1 tầng × N ô; pallet 1,0 × 0,8 × 1,0 vừa mọi khung.
public class DistributorTests
{
    private const double Margin = 0.05;

    private static RoomSlots Room(int id, int bays)
    {
        var rack = new Rack(id, $"K{id}", 0, 0, 0, 1, 1.3, bays, 1.2, 0.9, false, 1000, null);
        var candidates = rack.CreateSlots().Select(s => new SlotCandidate(rack, s)).ToList();
        return new RoomSlots(id, $"Kho {id}", candidates, Margin);
    }

    private static List<Pallet> Typed(string typeCode, int count, double height = 1.0)
        => Enumerable.Range(1, count)
            .Select(i => new Pallet(1, new PalletSize(typeCode, 1.0, 0.8, height, "#888"), $"{typeCode}{i}"))
            .ToList();

    private static int CountIn(DistributionResult result, int roomId)
        => result.Shares.SingleOrDefault(s => s.RoomId == roomId)?.Placements.Count ?? 0;

    [Fact]
    public void Distribute_TypeAlreadyInAnotherRoom_GoesThereFirst()
    {
        // Kho 1 (đang mở) trống; kho 2 đang có type D. Pallet D mới vào kho 2 dù kho 1 còn chỗ.
        var room1 = Room(1, 4);
        var room2 = Room(2, 4);
        room2.Candidates[0].Slot.Place(Typed("D", 1)[0]);

        var result = Distributor.Distribute(Typed("D", 2), new[] { room1, room2 }, preferredRoomId: 1);

        Assert.Empty(result.Rejected);
        Assert.Equal(2, CountIn(result, 2));
        Assert.Equal(0, CountIn(result, 1));
    }

    [Fact]
    public void Distribute_WhenTheOpenRoomIsTooSmall_OverflowGoesToAnotherRoom()
    {
        var result = Distributor.Distribute(Typed("A", 6), new[] { Room(1, 4), Room(2, 3) }, preferredRoomId: 1);

        Assert.Empty(result.Rejected);
        Assert.Equal(6, result.Shares.Sum(s => s.Placements.Count));
        Assert.Equal(4, CountIn(result, 1));
        Assert.Equal(2, CountIn(result, 2));
    }

    [Fact]
    public void Distribute_ARoomThatHoldsEverything_IsPreferredOverSplitting()
    {
        // Kho 1 (đang mở) 3 ô, kho 2 5 ô; lô 4 pallet type mới: kho 2 chứa hết nên không chia đôi.
        var result = Distributor.Distribute(Typed("A", 4), new[] { Room(1, 3), Room(2, 5) }, preferredRoomId: 1);

        Assert.Equal(4, CountIn(result, 2));
        Assert.Single(result.Shares);
    }

    [Fact]
    public void Distribute_TieBetweenRooms_PrefersTheOpenRoom()
    {
        var result = Distributor.Distribute(Typed("A", 2), new[] { Room(1, 4), Room(2, 4) }, preferredRoomId: 2);

        Assert.Equal(2, CountIn(result, 2));
    }

    [Fact]
    public void Distribute_NoSlotIsUsedTwice_AcrossBothPasses()
    {
        // Kho 1 có sẵn D: lượt 1 xếp D vào kho 1, lượt 2 xếp A vào phần còn lại. Không khung nào bị lấy hai lần.
        var room1 = Room(1, 4);
        room1.Candidates[0].Slot.Place(Typed("D", 1)[0]);
        var pallets = Typed("D", 2).Concat(Typed("A", 3)).ToList();

        var result = Distributor.Distribute(pallets, new[] { room1, Room(2, 2) }, preferredRoomId: 1);

        var all = result.Shares.SelectMany(s => s.Placements).ToList();
        Assert.Equal(5, all.Count);
        Assert.Equal(all.Count, all.Select(p => p.Target.Slot).Distinct().Count());
        Assert.All(all, p => Assert.True(p.Target.Slot.IsEmpty));   // hàm thuần: không gọi Place
    }

    [Fact]
    public void Distribute_NotEnoughRoomAnywhere_RejectsTheRestAsFull()
    {
        var result = Distributor.Distribute(Typed("A", 5), new[] { Room(1, 2), Room(2, 2) }, preferredRoomId: 1);

        Assert.Equal(4, result.Shares.Sum(s => s.Placements.Count));
        var rejection = Assert.Single(result.Rejected);
        Assert.Equal(Allocator.FullReason, rejection.Reason);
    }

    [Fact]
    public void Distribute_PalletThatFitsNoRoom_IsRejectedWithReason()
    {
        // Pallet cao 2 m, mọi kho chỉ có tầng cao 1,3 m và không nóc.
        var result = Distributor.Distribute(Typed("T", 1, height: 2.0), new[] { Room(1, 2), Room(2, 2) }, preferredRoomId: 1);

        Assert.Empty(result.Shares);
        Assert.Equal(Distributor.NoRoomFitsReason, Assert.Single(result.Rejected).Reason);
    }
}
