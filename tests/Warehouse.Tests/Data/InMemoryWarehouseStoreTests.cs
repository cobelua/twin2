using Warehouse.Api.Data;
using Warehouse.Api.Models;

namespace Warehouse.Tests.Data;

public class InMemoryWarehouseStoreTests
{
    private static Room MakeRoom() => new("Kho A", 20, 10, 0.5, 1.0, 0.05);

    private static Rack MakeRack(string code, int x = 0, int y = 0)
        => new(1, code, x, y, 0, 2, 1.3, 2, 1.0, 1.0, false, 1000);

    // ---- phòng ----

    [Fact]
    public void GetRoom_NothingSaved_ReturnsNull()
    {
        Assert.Null(new InMemoryWarehouseStore().GetRoom(1));
        Assert.Empty(new InMemoryWarehouseStore().GetRooms());
    }

    [Fact]
    public void SaveRoom_TwoNewRooms_BothListedWithDifferentIds()
    {
        var store = new InMemoryWarehouseStore();
        var a = new Room("Kho A", 20, 10, 0.5, 1.0, 0.05);
        var b = new Room("Kho B", 10, 8, 0.5, 1.0, 0.05);

        store.SaveRoom(a);
        store.SaveRoom(b);

        Assert.NotEqual(a.Id, b.Id);
        Assert.Equal(new[] { "Kho A", "Kho B" }, store.GetRooms().Select(r => r.Name));
        Assert.Same(b, store.GetRoom(b.Id));
    }

    [Fact]
    public void SaveRoom_AssignsIdToRoomAndRacks()
    {
        var store = new InMemoryWarehouseStore();
        var room = MakeRoom();
        room.Racks.Add(MakeRack("K1"));
        room.Racks.Add(MakeRack("K2", x: 6));

        store.SaveRoom(room);

        Assert.NotEqual(0, room.Id);
        Assert.All(room.Racks, r => Assert.NotEqual(0, r.Id));
        Assert.Equal(2, room.Racks.Select(r => r.Id).Distinct().Count());
    }

    [Fact]
    public void GetRoom_AfterSave_ReturnsSavedRoomWithRacks()
    {
        var store = new InMemoryWarehouseStore();
        var room = MakeRoom();
        room.Racks.Add(MakeRack("K1"));
        store.SaveRoom(room);

        var loaded = store.GetRoom(room.Id);

        Assert.NotNull(loaded);
        Assert.Equal(room.Id, loaded!.Id);
        Assert.Single(loaded.Racks);
    }

    [Fact]
    public void SaveRoom_Twice_KeepsExistingIdsAndGivesNewRackNextId()
    {
        var store = new InMemoryWarehouseStore();
        var room = MakeRoom();
        var k1 = MakeRack("K1");
        room.Racks.Add(k1);
        store.SaveRoom(room);
        int roomId = room.Id;
        int k1Id = k1.Id;

        var k2 = MakeRack("K2", x: 6);
        room.Racks.Add(k2);
        store.SaveRoom(room);

        Assert.Equal(roomId, room.Id);
        Assert.Equal(k1Id, k1.Id);
        Assert.NotEqual(0, k2.Id);
        Assert.NotEqual(k1Id, k2.Id);
    }

    [Fact]
    public void SaveRoom_Null_Throws()
    {
        var ex = Assert.Throws<ArgumentNullException>(() => new InMemoryWarehouseStore().SaveRoom(null!));

        Assert.Equal("room", ex.ParamName);
    }

    // ---- khung ----

    [Fact]
    public void AddSlots_AssignsUniqueIds()
    {
        var store = new InMemoryWarehouseStore();
        var rack = MakeRack("K1");

        store.AddSlots(rack.CreateSlots());

        var slots = store.GetAllSlots();
        Assert.Equal(4, slots.Count);
        Assert.All(slots, s => Assert.NotEqual(0, s.Id));
        Assert.Equal(4, slots.Select(s => s.Id).Distinct().Count());
    }

    [Fact]
    public void GetSlotsOfRacks_ReturnsOnlyTheRequestedRacksSlots()
    {
        var store = new InMemoryWarehouseStore();
        var room = MakeRoom();
        var k1 = MakeRack("K1");
        var k2 = MakeRack("K2", x: 6);
        room.Racks.Add(k1);
        room.Racks.Add(k2);
        store.SaveRoom(room);

        // CreateSlots dùng Id của kệ cho RackId, nên phải lưu kệ trước rồi mới sinh khung
        store.AddSlots(k1.CreateSlots());
        store.AddSlots(k2.CreateSlots());

        var ofK1 = store.GetSlotsOfRacks([k1.Id]);

        Assert.Equal(4, ofK1.Count);
        Assert.All(ofK1, s => Assert.StartsWith("K1-", s.Code));
        Assert.Equal(8, store.GetAllSlots().Count);
    }

    [Fact]
    public void RemoveSlotsOfRack_RemovesOnlyThatRacksSlots()
    {
        var store = new InMemoryWarehouseStore();
        var room = MakeRoom();
        var k1 = MakeRack("K1");
        var k2 = MakeRack("K2", x: 6);
        room.Racks.Add(k1);
        room.Racks.Add(k2);
        store.SaveRoom(room);
        store.AddSlots(k1.CreateSlots());
        store.AddSlots(k2.CreateSlots());

        store.RemoveSlotsOfRack(k1.Id);

        Assert.Empty(store.GetSlotsOfRacks([k1.Id]));
        Assert.Equal(4, store.GetSlotsOfRacks([k2.Id]).Count);
    }

    [Fact]
    public void GetAllSlots_ReturnsACopy_SoCallerCannotChangeTheStoreList()
    {
        var store = new InMemoryWarehouseStore();
        store.AddSlots(MakeRack("K1").CreateSlots());

        // nếu store trả thẳng danh sách bên trong thì người gọi ép kiểu về List rồi Clear là mất dữ liệu của store
        if (store.GetAllSlots() is List<Slot> returned)
            returned.Clear();

        Assert.Equal(4, store.GetAllSlots().Count);
    }

    [Fact]
    public void AddSlots_Null_Throws()
    {
        var ex = Assert.Throws<ArgumentNullException>(() => new InMemoryWarehouseStore().AddSlots(null!));

        Assert.Equal("slots", ex.ParamName);
    }
}
