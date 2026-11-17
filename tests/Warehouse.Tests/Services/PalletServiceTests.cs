using Warehouse.Api.Data;
using Warehouse.Api.Services;
using Warehouse.Api.ViewModels;
using Warehouse.Tests.Fakes;

namespace Warehouse.Tests.Services;

// Phòng 10 m × 5 m. Một kệ K1: 3 tầng × 3 ô (ô 1,0 × 1,0 m, cao tầng 1,2 m, khoảng hở đỉnh 0,05 m) + nóc = 12 khung.
// Pallet "thấp" 0,8 × 0,8 × 1,0 vào được mọi khung; pallet "cao" 0,8 × 0,8 × 2,0 chỉ vào được 3 khung nóc;
// pallet "rộng" 1,5 × 1,5 × 1,0 không vào khung nào.
public class PalletServiceTests
{
    private const double Low = 1.0;
    private const double Tall = 2.0;

    private static (LayoutService Layout, PalletService Pallets, IWarehouseStore Store, int RoomId) Setup(IWarehouseStore? store = null)
    {
        store ??= new InMemoryWarehouseStore();
        var layout = new LayoutService(store);
        var roomId = layout.CreateRoom(new RoomRequest { Name = "Kho A", Width = 10, Depth = 5, GridSize = 0.5, MinGap = 1.0, Margin = 0.05 }).Value!.Id;

        var request = new LayoutRequest { Name = "Kho A", Width = 10, Depth = 5, GridSize = 0.5, MinGap = 1.0, Margin = 0.05, Version = 0 };
        request.Racks.Add(new LayoutRackRequest
        {
            Code = "K1", X = 0, Y = 0, Rotation = 0, Levels = 3, LevelHeight = 1.2, Bays = 3, BayWidth = 1.0, Depth = 1.0,
            HasTop = true, MaxWeight = 1000,
        });
        Assert.True(layout.SaveLayout(roomId, request).IsSuccess);

        return (layout, new PalletService(store), store, roomId);
    }

    private static BatchRequest Lot(params (int Qty, double L, double W, double H)[] lines) => new()
    {
        Lines = [.. lines.Select(l => new BatchLineRequest { Quantity = l.Qty, Length = l.L, Width = l.W, Height = l.H })],
    };

    // Nhập lô rồi xếp, trả kết quả xếp.
    private static AllocationViewModel ReceiveAndAllocate(PalletService pallets, int roomId, BatchRequest lot)
    {
        var received = pallets.ReceiveBatch(lot);
        Assert.True(received.IsSuccess, received.Message);
        var allocated = pallets.Allocate(roomId, received.Value!.BatchId);
        Assert.True(allocated.IsSuccess, allocated.Message);
        return allocated.Value!;
    }

    // ---- loại hàng ----

    [Fact]
    public void CreateProductType_ListsItAndRejectsDuplicateCode()
    {
        var (_, pallets, _, _) = Setup();

        var created = pallets.CreateProductType(new ProductTypeRequest { Code = " OV ", Name = "Ốc vít" });
        var duplicate = pallets.CreateProductType(new ProductTypeRequest { Code = "ov", Name = "Khác" });

        Assert.True(created.IsSuccess);
        Assert.Equal("OV", created.Value!.Code);
        Assert.Equal(ServiceError.Conflict, duplicate.Error);
        Assert.Single(pallets.GetProductTypes().Value!);
    }

    // ---- CheckBatch (lập lô trước, kiểm tra mọi kho) ----

    // Thêm một kho nữa giống kho A (một kệ K1, 12 khung).
    private static int AddRoom(LayoutService layout, string name)
    {
        var roomId = layout.CreateRoom(new RoomRequest { Name = name, Width = 10, Depth = 5, GridSize = 0.5, MinGap = 1.0, Margin = 0.05 }).Value!.Id;
        var request = new LayoutRequest { Name = name, Width = 10, Depth = 5, GridSize = 0.5, MinGap = 1.0, Margin = 0.05, Version = 0 };
        request.Racks.Add(new LayoutRackRequest
        {
            Code = "K1", X = 0, Y = 0, Rotation = 0, Levels = 3, LevelHeight = 1.2, Bays = 3, BayWidth = 1.0, Depth = 1.0,
            HasTop = true, MaxWeight = 1000,
        });
        Assert.True(layout.SaveLayout(roomId, request).IsSuccess);
        return roomId;
    }

    [Fact]
    public void Check_6LowAnd2Tall_RoomTakesAll_AndWritesNothing()
    {
        var (_, pallets, store, roomId) = Setup();

        var check = pallets.CheckBatch(Lot((6, 0.8, 0.8, Low), (2, 0.8, 0.8, Tall))).Value!;

        Assert.Equal(8, check.Total);
        Assert.Equal(("A", true), (check.Lines[0].TypeCode, check.Lines[0].IsNewType));
        Assert.Equal(("B", true), (check.Lines[1].TypeCode, check.Lines[1].IsNewType));
        var room = Assert.Single(check.Rooms);
        Assert.Equal((roomId, 8, 0), (room.RoomId, room.Placeable, room.Missing));
        Assert.Empty(room.Notes);
        Assert.Equal(8, check.Plan.Placed);
        Assert.Empty(store.GetPalletSizes());   // kiểm tra không lưu type
        Assert.Equal(0, store.CountBatches());
    }

    [Fact]
    public void Check_PalletWiderThanEverySlot_ReportsNoRackWithReason()
    {
        var (_, pallets, _, _) = Setup();

        var check = pallets.CheckBatch(Lot((1, 1.5, 1.5, Low))).Value!;

        var room = Assert.Single(check.Rooms);
        Assert.Equal(1, room.Missing);
        Assert.Contains(room.Notes, n => n.Contains("rộng hơn"));
        Assert.Equal(0, check.Plan.Placed);
    }

    [Fact]
    public void Check_MoreThanFreeSlots_ReportsHowManyAreMissing()
    {
        var (_, pallets, _, _) = Setup();

        var room = Assert.Single(pallets.CheckBatch(Lot((14, 0.8, 0.8, Low))).Value!.Rooms);

        Assert.Equal((12, 2), (room.Placeable, room.Missing));
        Assert.Contains(room.Notes, n => n.Contains("thiếu 2 ô"));
    }

    [Fact]
    public void Check_AfterRoomIsFull_ReportsFull()
    {
        var (_, pallets, _, roomId) = Setup();
        ReceiveAndAllocate(pallets, roomId, Lot((12, 0.8, 0.8, Low)));

        var check = pallets.CheckBatch(Lot((1, 0.8, 0.8, Low))).Value!;

        Assert.False(check.Lines[0].IsNewType);   // type A đã lưu từ lần nhập trước
        var room = Assert.Single(check.Rooms);
        Assert.Equal(0, room.Placeable);
        Assert.Contains(room.Notes, n => n.Contains("đã đầy"));
    }

    [Fact]
    public void Check_TwoLinesSameMeasurementsRotated_ShareOneType()
    {
        var (_, pallets, _, _) = Setup();

        var lines = pallets.CheckBatch(Lot((1, 0.8, 0.6, Low), (1, 0.6, 0.8, Low))).Value!.Lines;

        Assert.Equal(("A", true), (lines[0].TypeCode, lines[0].IsNewType));
        Assert.Equal(("A", false), (lines[1].TypeCode, lines[1].IsNewType));
    }

    [Fact]
    public void Check_NoRoomTakesAll_PlanSplitsAcrossRooms()
    {
        var (layout, pallets, _, roomA) = Setup();
        var roomB = AddRoom(layout, "Kho B");

        var check = pallets.CheckBatch(Lot((20, 0.8, 0.8, Low))).Value!;

        Assert.All(check.Rooms, r => Assert.Equal(8, r.Missing));   // mỗi kho chỉ 12 khung
        Assert.Equal(20, check.Plan.Placed);
        Assert.Equal(new[] { roomA, roomB }, check.Plan.Rooms.Select(r => r.RoomId).Order());
        Assert.Empty(check.Plan.Rooms.SelectMany(r => r.Placements));   // đề xuất không kèm danh sách khung
    }

    [Fact]
    public void Check_BadInput_ReturnsErrors()
    {
        var (_, pallets, _, _) = Setup();
        var unknownType = Lot((1, 0.8, 0.8, Low));
        unknownType.Lines[0].ProductTypeId = 99;

        Assert.Equal(ServiceError.Invalid, pallets.CheckBatch(unknownType).Error);
        Assert.Equal(ServiceError.Invalid, pallets.CheckBatch(new BatchRequest()).Error);
        Assert.Equal(ServiceError.Invalid, pallets.CheckBatch(Lot((1500, 0.8, 0.8, Low), (600, 0.8, 0.8, Low))).Error);
        Assert.Equal(ServiceError.Invalid, pallets.CheckBatch(Lot((1, 0, 0.8, Low))).Error);   // gọi thẳng service nên bỏ qua [Range]
    }

    // ---- Distribute (nhập theo đề xuất) ----

    [Fact]
    public void Distribute_SameTypeGoesToTheRoomThatAlreadyHasIt_AndSecondCallPlacesNothing()
    {
        var (layout, pallets, _, roomA) = Setup();
        var roomB = AddRoom(layout, "Kho B");   // kho B trống, liệt kê sau
        ReceiveAndAllocate(pallets, roomB, Lot((1, 0.8, 0.8, Low)));   // kho B có type A

        var batchId = pallets.ReceiveBatch(Lot((3, 0.8, 0.8, Low))).Value!.BatchId;
        var first = pallets.Distribute(batchId).Value!;
        var second = pallets.Distribute(batchId).Value!;

        Assert.Equal(3, first.Placed);
        Assert.Equal(roomB, Assert.Single(first.Rooms).RoomId);
        Assert.DoesNotContain(first.Rooms, r => r.RoomId == roomA);
        Assert.Equal(3, first.Rooms[0].Placements.Count);
        Assert.Equal(0, second.Placed);
    }

    [Fact]
    public void Distribute_UnknownBatch_IsNotFound()
    {
        var (_, pallets, _, _) = Setup();

        Assert.Equal(ServiceError.NotFound, pallets.Distribute(999).Error);
    }

    // ---- ReceiveBatch ----

    [Fact]
    public void ReceiveBatch_SavesBatchPalletsCodesAndTypes_AndReusesTypesNextTime()
    {
        var (_, pallets, store, _) = Setup();

        var first = pallets.ReceiveBatch(Lot((6, 0.8, 0.8, Low), (2, 0.8, 0.8, Tall))).Value!;
        var second = pallets.ReceiveBatch(Lot((1, 0.8, 0.8, Low))).Value!;

        Assert.Equal(("b1", 8), (first.Code, first.PalletCount));
        Assert.Equal("b2", second.Code);
        var batch = store.GetBatch(first.BatchId)!;
        Assert.Equal("b1-P001", batch.Pallets[0].Code);
        Assert.Equal("b1-P008", batch.Pallets[7].Code);
        Assert.Equal(new[] { "A", "B" }, store.GetPalletSizes().Select(s => s.Code));   // lô 2 dùng lại type A
        Assert.All(batch.Pallets, p => Assert.NotEqual(0, p.SizeId));
    }

    [Fact]
    public void ReceiveBatch_Invalid_SavesNothing()
    {
        var (_, pallets, store, _) = Setup();
        var lot = Lot((1, 0.8, 0.8, Low), (1, 0.8, 0.8, Tall));
        lot.Lines[1].ProductTypeId = 99;

        var result = pallets.ReceiveBatch(lot);

        Assert.Equal(ServiceError.Invalid, result.Error);
        Assert.Empty(store.GetPalletSizes());   // dòng 1 hợp lệ nhưng không được lưu dở
        Assert.Equal(0, store.CountBatches());
    }

    // ---- Allocate ----

    [Fact]
    public void Allocate_6LowAnd2Tall_PlacesAllAndTallOnesGoOnTop()
    {
        var (_, pallets, store, roomId) = Setup();

        var result = ReceiveAndAllocate(pallets, roomId, Lot((6, 0.8, 0.8, Low), (2, 0.8, 0.8, Tall)));

        Assert.Equal(8, result.Placements.Count);
        Assert.Empty(result.Rejected);
        Assert.Equal(0, result.AlreadyPlaced);
        var onTop = result.Placements.Where(p => p.IsTop).ToList();
        Assert.Equal(2, onTop.Count);
        Assert.All(onTop, p => Assert.Equal("B", p.TypeCode));
        Assert.Equal(8, store.GetAllSlots().Count(s => s.PalletId is not null));
        Assert.Equal(8, result.Placements.Select(p => p.SlotCode).Distinct().Count());   // không hai pallet chung khung
    }

    [Fact]
    public void Allocate_TopSlotsOfEarlierRackAreNotTakenBeforeNormalSlotsOfLaterRack()
    {
        // K1 (có nóc, tầng cao 1,2 m) liệt kê trước K2 (tầng cao 2,0 m, không nóc). Pallet cao 1,6 m vừa khung thường của K2
        // và cũng vừa nóc K1. Nóc là chỗ cuối cùng, nên pallet phải vào K2, không chiếm nóc K1 chỉ vì K1 đứng trước.
        var (layout, pallets, store, roomId) = Setup();
        var k1 = store.GetRoom(roomId)!.Racks[0].Id;
        var request = new LayoutRequest { Name = "Kho A", Width = 10, Depth = 5, GridSize = 0.5, MinGap = 1.0, Margin = 0.05, Version = 1 };
        request.Racks.Add(new LayoutRackRequest
        {
            Id = k1, Code = "K1", X = 0, Y = 0, Rotation = 0, Levels = 3, LevelHeight = 1.2, Bays = 3, BayWidth = 1.0, Depth = 1.0,
            HasTop = true, MaxWeight = 1000,
        });
        request.Racks.Add(new LayoutRackRequest
        {
            Code = "K2", X = 0, Y = 3, Rotation = 0, Levels = 2, LevelHeight = 2.0, Bays = 3, BayWidth = 1.0, Depth = 1.0,
            HasTop = false, MaxWeight = 1000,
        });
        Assert.True(layout.SaveLayout(roomId, request).IsSuccess);

        var result = ReceiveAndAllocate(pallets, roomId, Lot((2, 0.8, 0.8, 1.6)));

        Assert.All(result.Placements, p => Assert.StartsWith("K2-T", p.SlotCode));
        Assert.All(result.Placements, p => Assert.False(p.IsTop));
    }

    [Fact]
    public void Allocate_Twice_DoesNotPlaceAnythingAgain()
    {
        var (_, pallets, store, roomId) = Setup();
        var batchId = pallets.ReceiveBatch(Lot((8, 0.8, 0.8, Low))).Value!.BatchId;
        pallets.Allocate(roomId, batchId);

        var again = pallets.Allocate(roomId, batchId).Value!;

        Assert.Empty(again.Placements);
        Assert.Empty(again.Rejected);
        Assert.Equal(8, again.AlreadyPlaced);
        Assert.Equal(8, store.GetAllSlots().Count(s => s.PalletId is not null));
    }

    [Fact]
    public void Allocate_PalletThatFitsNowhere_IsRejectedAndKeepsNoSlot()
    {
        var (_, pallets, store, roomId) = Setup();

        var result = ReceiveAndAllocate(pallets, roomId, Lot((2, 0.8, 0.8, Low), (1, 1.5, 1.5, Low)));

        Assert.Equal(2, result.Placements.Count);
        var rejected = Assert.Single(result.Rejected);
        Assert.Equal("b1-P003", rejected.PalletCode);
        Assert.Contains("rộng hơn", rejected.Reason);
        Assert.Equal(2, store.GetAllSlots().Count(s => s.PalletId is not null));
    }

    [Fact]
    public void Allocate_UnknownBatchOrRoom_ReturnsNotFound()
    {
        var (_, pallets, _, roomId) = Setup();
        var batchId = pallets.ReceiveBatch(Lot((1, 0.8, 0.8, Low))).Value!.BatchId;

        Assert.Equal(ServiceError.NotFound, pallets.Allocate(roomId, 99).Error);
        Assert.Equal(ServiceError.NotFound, pallets.Allocate(99, batchId).Error);
    }

    [Fact]
    public void Allocate_SameLotTwice_GivesSameSlotsInSameOrder()
    {
        // Allocator tất định: hai kho giống hệt nhau, cùng lô → cùng thứ tự và cùng khung.
        var lot = () => Lot((6, 0.8, 0.8, Low), (2, 0.8, 0.8, Tall));
        var (_, p1, _, r1) = Setup();
        var (_, p2, _, r2) = Setup();

        var a = ReceiveAndAllocate(p1, r1, lot());
        var b = ReceiveAndAllocate(p2, r2, lot());

        Assert.Equal(a.Placements.Select(p => (p.PalletCode, p.SlotCode)), b.Placements.Select(p => (p.PalletCode, p.SlotCode)));
    }

    [Fact]
    public void Allocate_WritesInsideTransaction()
    {
        var spy = new SpyWarehouseStore();
        var (_, pallets, _, roomId) = Setup(spy);
        var batchId = pallets.ReceiveBatch(Lot((3, 0.8, 0.8, Low))).Value!.BatchId;
        spy.Writes.Clear();

        pallets.Allocate(roomId, batchId);

        Assert.Equal(new[] { "UpdateSlots (trong transaction)" }, spy.Writes);
    }

    [Fact]
    public void ReceiveBatch_WritesInsideTransaction()
    {
        var spy = new SpyWarehouseStore();
        var (_, pallets, _, _) = Setup(spy);
        spy.Writes.Clear();

        pallets.ReceiveBatch(Lot((1, 0.8, 0.8, Low)));

        Assert.Equal(new[] { "AddPalletSize (trong transaction)", "AddBatch (trong transaction)" }, spy.Writes);
    }

    // ---- đọc khung, đặt lại ----

    [Fact]
    public void GetSlots_ReturnsEverySlotWithPalletTypeAndColorWhenOccupied()
    {
        var (_, pallets, _, roomId) = Setup();
        ReceiveAndAllocate(pallets, roomId, Lot((1, 0.8, 0.8, Low)));

        var slots = pallets.GetSlots(roomId).Value!;

        Assert.Equal(12, slots.Count);
        Assert.Equal("K1-T1-R1", slots[0].Code);
        Assert.Equal("K1-N-R3", slots[^1].Code);
        var full = Assert.Single(slots, s => s.PalletId is not null);
        Assert.Equal(("b1-P001", "A", "K1"), (full.PalletCode, full.TypeCode, full.RackCode));
        Assert.NotNull(full.Color);
        Assert.All(slots.Where(s => s.PalletId is null), s => Assert.Null(s.Color));
        Assert.Equal(ServiceError.NotFound, pallets.GetSlots(99).Error);
    }

    [Fact]
    public void ResetPlacements_EmptiesSlots_AndLotCanBeAllocatedAgain()
    {
        var (_, pallets, store, roomId) = Setup();
        var batchId = pallets.ReceiveBatch(Lot((5, 0.8, 0.8, Low))).Value!.BatchId;
        pallets.Allocate(roomId, batchId);

        var reset = pallets.ResetPlacements(roomId).Value!;
        var again = pallets.Allocate(roomId, batchId).Value!;

        Assert.Equal(5, reset.Cleared);
        Assert.Equal(5, again.Placements.Count);
        Assert.Equal(5, store.GetAllSlots().Count(s => s.PalletId is not null));
        Assert.Equal(ServiceError.NotFound, pallets.ResetPlacements(99).Error);
    }

    // ---- ghép với mặt bằng ----

    [Fact]
    public void SaveLayout_AfterPalletsPlaced_CannotRemoveTheRack()
    {
        var (layout, pallets, store, roomId) = Setup();
        ReceiveAndAllocate(pallets, roomId, Lot((1, 0.8, 0.8, Low)));
        var room = layout.GetLayout(roomId).Value!;

        var result = layout.SaveLayout(roomId, new LayoutRequest
        {
            Name = room.Name, Width = room.Width, Depth = room.Depth, GridSize = room.GridSize,
            MinGap = room.MinGap, Margin = room.Margin, Version = room.Version,
        });

        Assert.Equal(ServiceError.Conflict, result.Error);
        Assert.Single(store.GetRoom(roomId)!.Racks);
    }
}
