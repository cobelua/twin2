using Warehouse.Api.Data;
using Warehouse.Api.Models;
using Warehouse.Api.Services;
using Warehouse.Api.ViewModels;
using Warehouse.Tests.Fakes;

namespace Warehouse.Tests.Services;

// Phòng 10 m × 5 m, lưới 0,5 m, lối đi tối thiểu 1,0 m. Mọi toạ độ bằng mét.
// Kệ mẫu: 3 tầng × 3 ô, mỗi ô rộng 1,0 m → dài 3,0 m theo X, sâu 1,0 m theo Y. Có nóc nên 3 × 3 + 3 = 12 khung.
// Mọi thay đổi mặt bằng đi qua SaveLayout (lưu bản nháp) hoặc ValidateLayout (kiểm tra thử).
// Test trên store RAM: không cần PostgreSQL, mỗi test một kho sạch.
public class LayoutServiceTests
{
    private static RoomRequest RoomReq(double width = 10, double depth = 5, string name = "Kho A") => new()
    {
        Name = name, Width = width, Depth = depth, GridSize = 0.5, MinGap = 1.0, Margin = 0.05,
    };

    private static LayoutRackRequest Rack(string code, double x, double y, int rotation = 0, int? id = null, int levels = 3) => new()
    {
        Id = id, Code = code, X = x, Y = y, Rotation = rotation,
        Levels = levels, LevelHeight = 1.2, Bays = 3, BayWidth = 1.0, Depth = 1.0, HasTop = true, MaxWeight = 1000,
    };

    private static LayoutObstacleRequest Obstacle(string kind, double x, double y, double width = 0.4, double depth = 0.4, int? id = null) => new()
    {
        Id = id, Kind = kind, X = x, Y = y, Width = width, Depth = depth,
    };

    private static LayoutRequest Draft(int version, LayoutRackRequest[]? racks = null, LayoutObstacleRequest[]? obstacles = null,
                                       string name = "Kho A", double width = 10, double depth = 5, double minGap = 1.0) => new()
    {
        Name = name, Width = width, Depth = depth, GridSize = 0.5, MinGap = minGap, Margin = 0.05,
        Version = version, Racks = [.. racks ?? []], Obstacles = [.. obstacles ?? []],
    };

    // Kho đã có phòng trống.
    private static (LayoutService Service, IWarehouseStore Store, int RoomId) WithRoom()
    {
        var store = new InMemoryWarehouseStore();
        var service = new LayoutService(store);
        var created = service.CreateRoom(RoomReq());
        Assert.True(created.IsSuccess);
        return (service, store, created.Value!.Id);
    }

    // Lưu bản nháp trên phiên bản hiện tại của phòng (như người dùng vừa tải xong rồi lưu).
    private static ServiceResult<LayoutSavedViewModel> Save(LayoutService service, int roomId,
        LayoutRackRequest[]? racks = null, LayoutObstacleRequest[]? obstacles = null, string? name = null,
        double width = 10, double depth = 5, double minGap = 1.0)
    {
        // Không đổi tên thì giữ tên hiện tại của phòng (phòng thứ hai tên "Kho B" không bị đổi thành "Kho A").
        var current = service.GetLayout(roomId).Value!;
        return service.SaveLayout(roomId, Draft(current.Version, racks, obstacles, name ?? current.Name, width, depth, minGap));
    }

    private static int RackId(IWarehouseStore store, int roomId, string code)
        => store.GetRoom(roomId)!.Racks.Single(r => r.Code == code).Id;

    private static int SlotCount(IWarehouseStore store, int roomId, string code)
        => store.GetSlotsOfRacks([RackId(store, roomId, code)]).Count;

    private static void PutPalletOn(IWarehouseStore store, int roomId, string code)
    {
        var size = new PalletSize("A", 0.8, 0.6, 0.5, "#888");
        store.GetSlotsOfRacks([RackId(store, roomId, code)])[0].Place(new Pallet(1, size, "b1-P001"));
    }

    // ---- nhiều phòng ----

    [Fact]
    public void GetRooms_Empty_ReturnsEmptyList()
    {
        Assert.Empty(new LayoutService(new InMemoryWarehouseStore()).GetRooms().Value!);
    }

    [Fact]
    public void GetRooms_ListsEveryRoomWithRackAndSlotCounts()
    {
        var (service, _, kho) = WithRoom();
        Save(service, kho, [Rack("K1", 0, 0)], [Obstacle("Column", 8, 4)]);
        service.CreateRoom(RoomReq(name: "Kho lạnh", width: 8, depth: 6));

        var rooms = service.GetRooms().Value!;

        Assert.Equal(new[] { "Kho A", "Kho lạnh" }, rooms.Select(r => r.Name));
        Assert.Equal((1, 1, 12), (rooms[0].RackCount, rooms[0].ObstacleCount, rooms[0].SlotCount));
        Assert.Equal((0, 0, 0), (rooms[1].RackCount, rooms[1].ObstacleCount, rooms[1].SlotCount));
        Assert.Equal(8, rooms[1].Width);
    }

    [Fact]
    public void CreateRoom_TrimsNameAndReturnsId()
    {
        var service = new LayoutService(new InMemoryWarehouseStore());

        var id = service.CreateRoom(RoomReq(name: "  Kho B ")).Value!.Id;

        Assert.NotEqual(0, id);
        Assert.Equal("Kho B", service.GetLayout(id).Value!.Name);
    }

    [Theory]
    [InlineData("Kho A")]
    [InlineData("kho a")]
    [InlineData("  Kho A  ")]
    public void CreateRoom_DuplicateName_ReturnsConflict(string name)
    {
        var (service, store, _) = WithRoom();

        var result = service.CreateRoom(RoomReq(name: name));

        Assert.Equal(ServiceError.Conflict, result.Error);
        Assert.Equal("Đã có phòng tên " + name.Trim() + ".", result.Message);
        Assert.Single(store.GetRooms());
    }

    [Theory]
    [InlineData("  ", 10)]   // tên rỗng
    [InlineData("Kho X", 0)]   // kích thước 0: gọi thẳng service nên bỏ qua [Range], constructor Room chặn
    public void CreateRoom_Invalid_ReturnsInvalidAndSavesNothing(string name, double width)
    {
        var store = new InMemoryWarehouseStore();

        var result = new LayoutService(store).CreateRoom(RoomReq(name: name, width: width));

        Assert.Equal(ServiceError.Invalid, result.Error);
        Assert.Empty(store.GetRooms());
    }

    [Fact]
    public void TwoRooms_SameRackCodeAndPosition_AreIndependent()
    {
        // Luật đặt kệ chỉ nhìn kệ trong CÙNG phòng: K1 ở phòng A không chặn K1 cùng chỗ ở phòng B.
        var (service, store, a) = WithRoom();
        var b = service.CreateRoom(RoomReq(name: "Kho B")).Value!.Id;

        Assert.True(Save(service, a, [Rack("K1", 0, 0)]).IsSuccess);
        Assert.True(Save(service, b, [Rack("K1", 0, 0)]).IsSuccess);

        Assert.Single(store.GetRoom(a)!.Racks);
        Assert.Single(store.GetRoom(b)!.Racks);
        Assert.Equal(12, SlotCount(store, b, "K1"));
    }

    [Fact]
    public void UnknownRoom_EveryCall_ReturnsNotFound()
    {
        var (service, _, _) = WithRoom();

        Assert.Equal(ServiceError.NotFound, service.GetLayout(99).Error);
        Assert.Equal("Không có phòng Id 99.", service.GetLayout(99).Message);
        Assert.Equal(ServiceError.NotFound, service.SaveLayout(99, Draft(0)).Error);
        Assert.Equal(ServiceError.NotFound, service.ValidateLayout(99, Draft(0)).Error);
    }

    // ---- GetLayout ----

    [Fact]
    public void GetLayout_AfterSave_ReturnsRoomRackFootprintSlotCountObstaclesAndVersion()
    {
        var (service, _, roomId) = WithRoom();
        Save(service, roomId, [Rack("K1", 0, 0)], [Obstacle("Column", 6.5, 2.0)]);

        var layout = service.GetLayout(roomId).Value!;

        Assert.Equal((10, 5, 0.5, 1), (layout.Width, layout.Depth, layout.GridSize, layout.Version));
        var rack = Assert.Single(layout.Racks);
        Assert.Equal(("K1", 3.0, 1.0, 12), (rack.Code, rack.FootprintWidth, rack.FootprintDepth, rack.SlotCount));
        var column = Assert.Single(layout.Obstacles);
        Assert.Equal(("Column", 6.5), (column.Kind, column.X));
    }

    // ---- SaveLayout: kệ mới ----

    [Fact]
    public void Save_NewRack_ReturnsIdsTrimsCodeCreatesSlotsAndBumpsVersion()
    {
        var (service, store, roomId) = WithRoom();

        var result = Save(service, roomId, [Rack("  K1 ", 2.25, 0.75)]);

        Assert.True(result.IsSuccess);
        var saved = result.Value!;
        Assert.Equal(1, saved.Version);
        var rack = Assert.Single(saved.Racks);
        Assert.Equal("K1", rack.Code);
        Assert.NotEqual(0, rack.Id);
        Assert.Equal(12, store.GetSlotsOfRacks([rack.Id]).Count);
        Assert.Equal((2.25, 0.75), (store.GetRoom(roomId)!.Racks[0].X, store.GetRoom(roomId)!.Racks[0].Y));   // mét, không làm tròn theo ô
    }

    [Fact]
    public void Save_TwoNewRacks_GetDifferentIdsAndOwnSlots()
    {
        var (service, store, roomId) = WithRoom();

        var saved = Save(service, roomId, [Rack("K1", 0, 0), Rack("K2", 0, 2.0)]).Value!;

        Assert.Equal(2, saved.Racks.Select(r => r.Id).Distinct().Count());
        Assert.Equal(24, store.GetAllSlots().Count);
    }

    [Fact]
    public void Save_RackOnColumn_ReturnsInvalidWithRackCodeAndSavesNothing()
    {
        var (service, store, roomId) = WithRoom();

        var result = Save(service, roomId, [Rack("K1", 0, 0)], [Obstacle("Column", 1.5, 0.3)]);

        Assert.Equal(ServiceError.Invalid, result.Error);
        Assert.StartsWith("K1: ", result.Message);
        Assert.Empty(store.GetRoom(roomId)!.Racks);
        Assert.Empty(store.GetRoom(roomId)!.Obstacles);
        Assert.Equal(0, store.GetRoom(roomId)!.Version);
    }

    [Fact]
    public void Save_RacksOverlapOrTooClose_ReturnsInvalid()
    {
        var (service, store, roomId) = WithRoom();

        Assert.Equal(ServiceError.Invalid, Save(service, roomId, [Rack("K1", 0, 0), Rack("K2", 1.5, 0.5)]).Error);   // đè
        Assert.Equal(ServiceError.Invalid, Save(service, roomId, [Rack("K1", 0, 0), Rack("K2", 0, 1.5)]).Error);    // lối đi 0,5 m < 1 m
        Assert.True(Save(service, roomId, [Rack("K1", 0, 0), Rack("K2", 0, 2.0)]).IsSuccess);                       // đúng 1,0 m thì được
        Assert.Equal(2, store.GetRoom(roomId)!.Racks.Count);
    }

    [Fact]
    public void Save_BadRackInput_ReturnsInvalidInsteadOfThrowing()
    {
        var (service, store, roomId) = WithRoom();

        var result = Save(service, roomId, [Rack("K1", 0, 0, rotation: 45)]);

        Assert.Equal(ServiceError.Invalid, result.Error);
        Assert.Empty(store.GetRoom(roomId)!.Racks);
    }

    [Fact]
    public void Save_SameCodeTwice_ReturnsConflict()
    {
        var (service, _, roomId) = WithRoom();

        var result = Save(service, roomId, [Rack("K1", 0, 0), Rack("k1", 0, 2.0)]);

        Assert.Equal(ServiceError.Conflict, result.Error);
    }

    // ---- SaveLayout: phòng và phiên bản ----

    [Fact]
    public void Save_StaleVersion_ReturnsConflictAndSavesNothing()
    {
        var (service, store, roomId) = WithRoom();
        Save(service, roomId, [Rack("K1", 0, 0)]);   // phòng lên version 1

        var result = service.SaveLayout(roomId, Draft(0, [Rack("K9", 0, 0)]));   // bản nháp tải từ version 0

        Assert.Equal(ServiceError.Conflict, result.Error);
        Assert.Equal("K1", store.GetRoom(roomId)!.Racks.Single().Code);
    }

    [Fact]
    public void Save_RenameRoom_WorksButOtherRoomsNameIsConflict()
    {
        var (service, store, roomId) = WithRoom();
        service.CreateRoom(RoomReq(name: "Kho B"));

        Assert.Equal(ServiceError.Conflict, Save(service, roomId, name: "KHO B").Error);
        Assert.Equal("Kho A", store.GetRoom(roomId)!.Name);

        Assert.True(Save(service, roomId, name: "Kho chính").IsSuccess);
        Assert.Equal("Kho chính", store.GetRoom(roomId)!.Name);
    }

    [Fact]
    public void Save_ChangeGridOnly_KeepsRacksWhereTheyWere()
    {
        var (service, store, roomId) = WithRoom();
        Save(service, roomId, [Rack("K1", 2.25, 0.75)]);
        var request = Draft(1, [Rack("K1", 2.25, 0.75, id: RackId(store, roomId, "K1"))]);
        request.GridSize = 2.0;

        var result = service.SaveLayout(roomId, request);

        Assert.True(result.IsSuccess);
        Assert.Equal(2.0, store.GetRoom(roomId)!.GridSize);
        Assert.Equal((2.25, 0.75), (store.GetRoom(roomId)!.Racks[0].X, store.GetRoom(roomId)!.Racks[0].Y));
    }

    [Fact]
    public void Save_ShrinkRoomPushesRackOutside_ReturnsInvalidAndKeepsOldSize()
    {
        var (service, store, roomId) = WithRoom();
        Save(service, roomId, [Rack("K1", 6, 0)]);
        var id = RackId(store, roomId, "K1");

        var result = service.SaveLayout(roomId, Draft(1, [Rack("K1", 6, 0, id: id)], width: 7));

        Assert.Equal(ServiceError.Invalid, result.Error);
        Assert.Equal(10, store.GetRoom(roomId)!.Width);
    }

    [Fact]
    public void Save_BiggerMinGap_RejectsWhenRacksTooClose()
    {
        var (service, _, roomId) = WithRoom();
        Save(service, roomId, [Rack("K1", 0, 0), Rack("K2", 0, 2.0)]);   // lối đi 1,0 m

        var result = Save(service, roomId, [Rack("K1", 0, 0, id: null), Rack("K2", 0, 2.0)], minGap: 1.5);

        Assert.Equal(ServiceError.Invalid, result.Error);
    }

    // ---- SaveLayout: sửa kệ đã có ----

    [Fact]
    public void Save_MoveExistingRack_KeepsIdAndSlots()
    {
        var (service, store, roomId) = WithRoom();
        Save(service, roomId, [Rack("K1", 0, 0)]);
        var id = RackId(store, roomId, "K1");
        var slotIds = store.GetSlotsOfRacks([id]).Select(s => s.Id).ToList();

        var result = Save(service, roomId, [Rack("K1", 1.0, 0, id: id)]);   // dời đè lên chỗ cũ của chính nó

        Assert.True(result.IsSuccess);
        Assert.Equal(id, store.GetRoom(roomId)!.Racks.Single().Id);
        Assert.Equal(1.0, store.GetRoom(roomId)!.Racks.Single().X);
        Assert.Equal(slotIds, store.GetSlotsOfRacks([id]).Select(s => s.Id).ToList());   // không sinh lại khung
    }

    [Fact]
    public void Save_MoveRackIntoSpotAnotherRackLeaves_IsAllowedRegardlessOfOrder()
    {
        // Kiểm tra trên TOÀN BỘ trạng thái mới: K1 sang chỗ K2 vừa nhường, K2 dời đi, vẫn hợp lệ.
        var (service, store, roomId) = WithRoom();
        Save(service, roomId, [Rack("K1", 0, 0), Rack("K2", 5, 0)]);
        var k1 = RackId(store, roomId, "K1");
        var k2 = RackId(store, roomId, "K2");

        var result = Save(service, roomId, [Rack("K1", 5, 0, id: k1), Rack("K2", 0, 0, id: k2)]);

        Assert.True(result.IsSuccess);
    }

    [Fact]
    public void Save_MoreLevels_RegeneratesSlots()
    {
        var (service, store, roomId) = WithRoom();
        Save(service, roomId, [Rack("K1", 0, 0)]);
        var id = RackId(store, roomId, "K1");

        var result = Save(service, roomId, [Rack("K1", 0, 0, id: id, levels: 4)]);

        Assert.True(result.IsSuccess);
        Assert.Equal(15, SlotCount(store, roomId, "K1"));   // 4 × 3 + 3 khung nóc
    }

    [Fact]
    public void Save_ChangeCodeOfExistingRack_ReturnsInvalid()
    {
        var (service, store, roomId) = WithRoom();
        Save(service, roomId, [Rack("K1", 0, 0)]);

        var result = Save(service, roomId, [Rack("K9", 0, 0, id: RackId(store, roomId, "K1"))]);

        Assert.Equal(ServiceError.Invalid, result.Error);
        Assert.Equal("K1", store.GetRoom(roomId)!.Racks.Single().Code);
    }

    [Fact]
    public void Save_UnknownRackId_OrRackOfAnotherRoom_ReturnsNotFound()
    {
        var (service, store, a) = WithRoom();
        var b = service.CreateRoom(RoomReq(name: "Kho B")).Value!.Id;
        Save(service, a, [Rack("K1", 0, 0)]);

        Assert.Equal(ServiceError.NotFound, Save(service, a, [Rack("K1", 0, 0, id: 99)]).Error);
        Assert.Equal(ServiceError.NotFound, Save(service, b, [Rack("K1", 0, 0, id: RackId(store, a, "K1"))]).Error);
    }

    // ---- SaveLayout: xoá kệ ----

    [Fact]
    public void Save_RemoveRack_RemovesRackAndItsSlotsOnly()
    {
        var (service, store, roomId) = WithRoom();
        Save(service, roomId, [Rack("K1", 0, 0), Rack("K2", 0, 2.0)]);
        var k1 = RackId(store, roomId, "K1");
        var k2 = RackId(store, roomId, "K2");

        var result = Save(service, roomId, [Rack("K2", 0, 2.0, id: k2)]);

        Assert.True(result.IsSuccess);
        Assert.Equal("K2", store.GetRoom(roomId)!.Racks.Single().Code);
        Assert.Empty(store.GetSlotsOfRacks([k1]));
        Assert.Equal(12, store.GetSlotsOfRacks([k2]).Count);
    }

    [Fact]
    public void Save_RemoveRackAndAddNewOneWithSameCodeAndSpot_IsAllowed()
    {
        var (service, store, roomId) = WithRoom();
        Save(service, roomId, [Rack("K1", 0, 0)]);

        var result = Save(service, roomId, [Rack("K1", 0, 0)]);   // id null: kệ mới, kệ cũ bị gỡ

        Assert.True(result.IsSuccess);
        Assert.Equal(12, SlotCount(store, roomId, "K1"));
        Assert.Equal(12, store.GetAllSlots().Count);   // không còn khung mồ côi của kệ cũ
    }

    // ---- SaveLayout: kệ đang có hàng ----

    [Fact]
    public void Save_RemoveRackWithPallet_ReturnsConflictAndKeepsRack()
    {
        var (service, store, roomId) = WithRoom();
        Save(service, roomId, [Rack("K1", 0, 0)]);
        PutPalletOn(store, roomId, "K1");

        var result = Save(service, roomId);

        Assert.Equal(ServiceError.Conflict, result.Error);
        Assert.Single(store.GetRoom(roomId)!.Racks);
        Assert.Equal(12, SlotCount(store, roomId, "K1"));
    }

    [Fact]
    public void Save_ReconfigureRackWithPallet_ReturnsConflictAndKeepsSlots()
    {
        var (service, store, roomId) = WithRoom();
        Save(service, roomId, [Rack("K1", 0, 0)]);
        PutPalletOn(store, roomId, "K1");

        var result = Save(service, roomId, [Rack("K1", 0, 0, id: RackId(store, roomId, "K1"), levels: 4)]);

        Assert.Equal(ServiceError.Conflict, result.Error);
        Assert.Equal(12, SlotCount(store, roomId, "K1"));
        Assert.Equal(3, store.GetRoom(roomId)!.Racks.Single().Levels);
    }

    [Fact]
    public void Save_MoveRackWithPallet_IsAllowedAndPalletStays()
    {
        var (service, store, roomId) = WithRoom();
        Save(service, roomId, [Rack("K1", 0, 0)]);
        PutPalletOn(store, roomId, "K1");
        var id = RackId(store, roomId, "K1");

        var result = Save(service, roomId, [Rack("K1", 5, 2, rotation: 90, id: id)]);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, store.GetSlotsOfRacks([id]).Count(s => s.PalletId is not null));
    }

    // ---- SaveLayout: tường, cột ----

    [Fact]
    public void Save_Obstacles_AddUpdateRemoveAndReturnIdsInRequestOrder()
    {
        var (service, store, roomId) = WithRoom();
        var first = Save(service, roomId, obstacles: [Obstacle("Column", 8, 4), Obstacle("Wall", 5, 0, 0.2, 3)]).Value!;
        Assert.Equal(2, first.ObstacleIds.Distinct().Count());
        Assert.All(first.ObstacleIds, id => Assert.NotEqual(0, id));

        // Giữ tường (đổi kích thước), bỏ cột, thêm cột mới.
        var wallId = first.ObstacleIds[1];
        var second = Save(service, roomId, obstacles: [Obstacle("Wall", 5, 0, 0.2, 4, id: wallId), Obstacle("Column", 1, 1)]).Value!;

        Assert.Equal(wallId, second.ObstacleIds[0]);
        var obstacles = store.GetRoom(roomId)!.Obstacles;
        Assert.Equal(2, obstacles.Count);
        Assert.Equal(4, obstacles.Single(o => o.Id == wallId).Depth);
        Assert.DoesNotContain(obstacles, o => o.Id == first.ObstacleIds[0]);
    }

    [Fact]
    public void Save_ObstacleOnRackOutsideRoomBadKindOrUnknownId_ReturnsErrorAndSavesNothing()
    {
        var (service, store, roomId) = WithRoom();

        Assert.Equal(ServiceError.Invalid, Save(service, roomId, [Rack("K1", 0, 0)], [Obstacle("Wall", 1, 0, 0.2, 5)]).Error);   // đè kệ
        Assert.Equal(ServiceError.Invalid, Save(service, roomId, obstacles: [Obstacle("Column", 9.9, 4.9)]).Error);             // ngoài phòng
        Assert.Equal(ServiceError.Invalid, Save(service, roomId, obstacles: [Obstacle("Door", 1, 1)]).Error);                    // loại lạ
        Assert.Equal(ServiceError.NotFound, Save(service, roomId, obstacles: [Obstacle("Column", 1, 1, id: 99)]).Error);         // Id lạ
        Assert.Empty(store.GetRoom(roomId)!.Obstacles);
    }

    [Fact]
    public void Save_ObstacleTouchingRack_IsAllowed()
    {
        var (service, _, roomId) = WithRoom();

        Assert.True(Save(service, roomId, [Rack("K1", 0, 0)], [Obstacle("Wall", 3.0, 0, 0.2, 1)]).IsSuccess);   // chạm cạnh không tính là đè
    }

    // ---- transaction ----

    [Fact]
    public void Save_WritesEverythingInsideTransaction()
    {
        // Store RAM không rollback nên chỉ nhìn dữ liệu thì không thấy được service có bọc transaction không;
        // store gián điệp ghi lại từng lần ghi nằm trong hay ngoài transaction.
        var store = new SpyWarehouseStore();
        var service = new LayoutService(store);
        var roomId = service.CreateRoom(RoomReq()).Value!.Id;
        store.Writes.Clear();

        service.SaveLayout(roomId, Draft(0, [Rack("K1", 0, 0)]));

        Assert.NotEmpty(store.Writes);
        Assert.All(store.Writes, w => Assert.EndsWith("(trong transaction)", w));
        Assert.Contains("AddSlots (trong transaction)", store.Writes);
    }

    [Fact]
    public void Save_Rejected_WritesNothing()
    {
        var store = new SpyWarehouseStore();
        var service = new LayoutService(store);
        var roomId = service.CreateRoom(RoomReq()).Value!.Id;
        store.Writes.Clear();

        service.SaveLayout(roomId, Draft(0, [Rack("K1", 0, 0), Rack("K2", 1.0, 0)]));   // K2 đè K1

        Assert.Empty(store.Writes);
    }

    // ---- ValidateLayout (kiểm tra thử, không lưu) ----

    [Fact]
    public void Validate_FreeSpot_IsValidWithFootprintPerRack()
    {
        var (service, store, roomId) = WithRoom();

        var check = service.ValidateLayout(roomId, Draft(0, [Rack("K1", 0, 0), Rack("K2", 0, 2.0, rotation: 90)])).Value!;

        Assert.True(check.IsValid);
        Assert.Null(check.Reason);
        Assert.Equal((3.0, 1.0), (check.Racks[0].FootprintWidth, check.Racks[0].FootprintDepth));
        Assert.Equal((1.0, 3.0), (check.Racks[1].FootprintWidth, check.Racks[1].FootprintDepth));   // xoay 90° đổi chỗ hai cạnh
        Assert.Empty(store.GetRoom(roomId)!.Racks);                                                  // không lưu gì
    }

    [Fact]
    public void Validate_OnWall_IsInvalidButStillSuccess()
    {
        var (service, _, roomId) = WithRoom();

        var result = service.ValidateLayout(roomId, Draft(0, [Rack("K1", 0, 0)], [Obstacle("Wall", 1.0, 0, 0.2, 5)]));

        Assert.True(result.IsSuccess);
        Assert.False(result.Value!.IsValid);
        Assert.StartsWith("K1: ", result.Value.Reason);
        Assert.False(result.Value.Racks[0].IsValid);
    }

    [Fact]
    public void Validate_UsesTheDraftNotTheSavedRacks()
    {
        // Đã lưu K1 ở (0, 0). Trong bản nháp K1 đã dời đi, nên K2 đặt vào chỗ cũ của K1 vẫn hợp lệ.
        var (service, store, roomId) = WithRoom();
        Save(service, roomId, [Rack("K1", 0, 0)]);
        var id = RackId(store, roomId, "K1");

        var check = service.ValidateLayout(roomId, Draft(1, [Rack("K1", 5, 0, id: id), Rack("K2", 0, 0)])).Value!;

        Assert.True(check.IsValid);
    }

    [Fact]
    public void Validate_StructuralError_IsInvalidWithoutPerRackResults()
    {
        var (service, _, roomId) = WithRoom();

        var check = service.ValidateLayout(roomId, Draft(0, [Rack("K1", 0, 0), Rack("K1", 0, 2.0)])).Value!;

        Assert.False(check.IsValid);
        Assert.Empty(check.Racks);
        Assert.Contains("K1", check.Reason);
    }

    [Fact]
    public void Validate_IgnoresVersion()
    {
        var (service, _, roomId) = WithRoom();

        Assert.True(service.ValidateLayout(roomId, Draft(42, [Rack("K1", 0, 0)])).Value!.IsValid);
    }
}
